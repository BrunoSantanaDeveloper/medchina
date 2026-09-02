/**
 * Batching policy for persisting a capture WHILE it happens.
 *
 * A consultation used to live entirely in memory until the moment it stopped:
 * `ondataavailable` pushed into an array and the only write to IndexedDB
 * happened inside `upload()`, after the take had ended. A crashed tab, a
 * browser update or a confirmed "leave this page" during a 60–90 minute
 * appointment took the whole recording with it — the most expensive failure
 * this product has.
 *
 * The tension is that writing every timeslice is also wrong: the recorder emits
 * one blob per second, so a 90-minute session would mean 5.400 encrypted
 * transactions. Grouping them into ~10-second batches costs roughly 540 writes
 * of ~40 KB each (32 kbps mono ≈ 4 KB/s) and bounds what a crash can destroy to
 * the last few seconds.
 *
 * The policy lives here, apart from React and IndexedDB, because the two rules
 * that actually protect the audio are pure and worth pinning in tests: batches
 * are numbered in strict order, and `seq = 0` must survive — it carries the
 * container header (EBML for WebM), without which the concatenation of every
 * other byte decodes to nothing.
 */

/** How long a batch may accumulate before it is written. */
export const CHUNK_FLUSH_MS = 10_000;
/** …or how large, whichever comes first. Bounds the loss on a crash. */
export const CHUNK_FLUSH_BYTES = 256 * 1024;

export interface ChunkBatch {
  seq: number;
  parts: Blob[];
  bytes: number;
}

/**
 * Accumulates timeslices and hands them over in numbered batches.
 *
 * Deliberately not time-driven on its own: the caller decides WHEN to ask
 * (on each timeslice, and once more at stop), so there is no timer to leak and
 * no write racing the final assembly.
 */
export class ChunkBatcher {
  private pending: Blob[] = [];
  private bytes = 0;
  private openedAt: number | null = null;
  private seq = 0;

  /** Timeslices held but not yet written. */
  get pendingBytes(): number {
    return this.bytes;
  }

  /** The number the NEXT batch will carry. */
  get nextSeq(): number {
    return this.seq;
  }

  add(part: Blob, now: number): void {
    if (part.size === 0) return;
    if (this.openedAt === null) this.openedAt = now;
    this.pending.push(part);
    this.bytes += part.size;
  }

  /** Whether the open batch has met either threshold. */
  ready(now: number): boolean {
    if (this.pending.length === 0) return false;
    if (this.bytes >= CHUNK_FLUSH_BYTES) return true;
    return this.openedAt !== null && now - this.openedAt >= CHUNK_FLUSH_MS;
  }

  /**
   * Hand over everything held, numbered. Returns null when there is nothing —
   * so a `stop()` flush on an already-drained buffer is a no-op rather than an
   * empty batch that would leave a hole in the sequence.
   */
  take(): ChunkBatch | null {
    if (this.pending.length === 0) return null;
    const batch: ChunkBatch = { seq: this.seq, parts: this.pending, bytes: this.bytes };
    this.seq += 1;
    this.pending = [];
    this.bytes = 0;
    this.openedAt = null;
    return batch;
  }
}

export interface StoredChunk {
  seq: number;
  data: ArrayBuffer;
}

/**
 * Put the batches back together, in order.
 *
 * Returns null rather than a broken blob when the sequence cannot produce a
 * playable file. Two ways that happens, and both must fail loudly instead of
 * handing the professional an "audio" that decodes to silence:
 *  - `seq = 0` is missing: it holds the container header;
 *  - a batch in the middle never landed, so the stream has a hole.
 */
export function assembleChunks(rows: StoredChunk[]): ArrayBuffer[] | null {
  if (rows.length === 0) return null;
  const ordered = [...rows].sort((left, right) => left.seq - right.seq);
  if (ordered[0].seq !== 0) return null;
  for (let index = 0; index < ordered.length; index += 1) {
    if (ordered[index].seq !== index) return null;
  }
  return ordered.map((row) => row.data);
}
