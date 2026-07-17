"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type ConsultationSaveState = "idle" | "pending" | "saving" | "saved" | "error";

export type ConsultationSaveSnapshot = {
  state: ConsultationSaveState;
  pending: number;
  failed: number;
};

type SaveOperation = () => Promise<void>;

export class NonRetryableSaveError extends Error {
  readonly retryable = false;
}

type CoordinatorOptions = {
  debounceMs?: number;
  retryCount?: number;
  onStateChange?: (snapshot: ConsultationSaveSnapshot) => void;
};

/**
 * Serializes all writes from a consultation screen. A newer edit to the same
 * field replaces the older queued value, while writes to different fields are
 * executed in order. `flush()` is the transition boundary used before finalizing.
 */
export class ConsultationSaveCoordinator {
  private readonly debounceMs: number;
  private readonly retryCount: number;
  private readonly onStateChange?: CoordinatorOptions["onStateChange"];
  private readonly pending = new Map<string, SaveOperation>();
  private readonly failed = new Map<string, SaveOperation>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;
  private disposed = false;

  constructor(options: CoordinatorOptions = {}) {
    this.debounceMs = options.debounceMs ?? 500;
    this.retryCount = options.retryCount ?? 2;
    this.onStateChange = options.onStateChange;
  }

  schedule(key: string, operation: SaveOperation) {
    if (this.disposed) return;
    this.pending.set(key, operation);
    this.failed.delete(key);
    this.emit("pending");
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush().catch(() => undefined), this.debounceMs);
  }

  async flush() {
    if (this.disposed) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.running) return this.running;

    this.running = this.drain();
    try {
      await this.running;
    } finally {
      this.running = null;
    }
  }

  async retry() {
    for (const [key, operation] of this.failed) this.pending.set(key, operation);
    this.failed.clear();
    if (this.pending.size) this.emit("pending");
    await this.flush();
  }

  hasUnsavedChanges() {
    return this.pending.size > 0 || this.failed.size > 0 || Boolean(this.running);
  }

  dispose() {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private async drain() {
    while (this.pending.size > 0) {
      const next = this.pending.entries().next().value as [string, SaveOperation] | undefined;
      if (!next) break;
      const [key, operation] = next;
      this.pending.delete(key);
      this.emit("saving");

      let lastError: unknown;
      for (let attempt = 0; attempt <= this.retryCount; attempt += 1) {
        try {
          await operation();
          lastError = undefined;
          break;
        } catch (error) {
          lastError = error;
          if (error instanceof NonRetryableSaveError) break;
          if (attempt < this.retryCount) {
            await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
          }
        }
      }

      if (lastError) {
        if (!(lastError instanceof NonRetryableSaveError)) this.failed.set(key, operation);
        this.emit("error");
        throw lastError;
      }
    }

    this.emit(this.failed.size ? "error" : "saved");
  }

  private emit(state: ConsultationSaveState) {
    this.onStateChange?.({ state, pending: this.pending.size, failed: this.failed.size });
  }
}

type TabLease = { tabId: string; updatedAt: number };

/**
 * One tab owns the editable consultation lease. A second tab is read-only until
 * the practitioner explicitly takes over, avoiding two silent autosave streams.
 */
export function useConsultationTabGuard(consultationId: string) {
  const storageKey = `medchina:consultation-editor:${consultationId}`;
  const tabId = useMemo(
    () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    [],
  );
  const [isPrimary, setIsPrimary] = useState(false);
  const primaryRef = useRef(false);

  const writeLease = useCallback(() => {
    const lease: TabLease = { tabId, updatedAt: Date.now() };
    localStorage.setItem(storageKey, JSON.stringify(lease));
    primaryRef.current = true;
    setIsPrimary(true);
  }, [storageKey, tabId]);

  useEffect(() => {
    const readLease = (): TabLease | null => {
      try {
        return JSON.parse(localStorage.getItem(storageKey) ?? "null") as TabLease | null;
      } catch {
        return null;
      }
    };

    const evaluate = () => {
      const lease = readLease();
      const available = !lease || lease.tabId === tabId || Date.now() - lease.updatedAt > 15_000;
      if (available) writeLease();
      else {
        primaryRef.current = false;
        setIsPrimary(false);
      }
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key !== storageKey) return;
      const lease = readLease();
      const ownsLease = lease?.tabId === tabId;
      primaryRef.current = ownsLease;
      setIsPrimary(ownsLease);
    };

    evaluate();
    const heartbeat = window.setInterval(() => {
      if (primaryRef.current) writeLease();
      else evaluate();
    }, 5_000);
    window.addEventListener("storage", onStorage);

    return () => {
      window.clearInterval(heartbeat);
      window.removeEventListener("storage", onStorage);
      const lease = readLease();
      if (lease?.tabId === tabId) localStorage.removeItem(storageKey);
    };
  }, [storageKey, tabId, writeLease]);

  return { isPrimary, takeOver: writeLease };
}
