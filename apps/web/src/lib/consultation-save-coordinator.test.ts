import { ConsultationSaveCoordinator, NonRetryableSaveError } from "./consultation-save-coordinator";
import { describe, expect, it, vi } from "vitest";

describe("ConsultationSaveCoordinator", () => {
  it("keeps only the newest queued value per field and writes sequentially", async () => {
    const order: string[] = [];
    const coordinator = new ConsultationSaveCoordinator({ debounceMs: 60_000, retryCount: 0 });

    coordinator.schedule("field-a", async () => {
      order.push("stale");
    });
    coordinator.schedule("field-a", async () => {
      order.push("latest-a");
    });
    coordinator.schedule("field-b", async () => {
      order.push("b");
    });

    await coordinator.flush();
    expect(order).toEqual(["latest-a", "b"]);
    expect(coordinator.hasUnsavedChanges()).toBe(false);
    coordinator.dispose();
  });

  it("retains a failed write until an explicit retry succeeds", async () => {
    let shouldFail = true;
    const states = vi.fn();
    const coordinator = new ConsultationSaveCoordinator({
      debounceMs: 60_000,
      retryCount: 0,
      onStateChange: states,
    });
    coordinator.schedule("field", async () => {
      if (shouldFail) throw new Error("offline");
    });

    await expect(coordinator.flush()).rejects.toThrow("offline");
    expect(coordinator.hasUnsavedChanges()).toBe(true);

    shouldFail = false;
    await coordinator.retry();
    expect(coordinator.hasUnsavedChanges()).toBe(false);
    expect(states).toHaveBeenLastCalledWith({ state: "saved", pending: 0, failed: 0 });
    coordinator.dispose();
  });

  it("does not replay an optimistic conflict as an implicit overwrite", async () => {
    const operation = vi.fn(async () => {
      throw new NonRetryableSaveError("revision_conflict");
    });
    const coordinator = new ConsultationSaveCoordinator({ debounceMs: 60_000, retryCount: 2 });
    coordinator.schedule("field", operation);

    await expect(coordinator.flush()).rejects.toThrow("revision_conflict");
    expect(operation).toHaveBeenCalledTimes(1);
    expect(coordinator.hasUnsavedChanges()).toBe(false);

    await coordinator.retry();
    expect(operation).toHaveBeenCalledTimes(1);
    coordinator.dispose();
  });
});
