import { assembleChunks, CHUNK_FLUSH_BYTES, CHUNK_FLUSH_MS, ChunkBatcher } from "./recording-buffer";
import { describe, expect, it } from "vitest";

const blob = (size: number) => new Blob([new Uint8Array(size)]);

describe("batching a capture while it is still running", () => {
  it("holds timeslices until the batch is worth writing", () => {
    const batcher = new ChunkBatcher();
    batcher.add(blob(4_000), 0);
    batcher.add(blob(4_000), 1_000);
    expect(batcher.ready(2_000)).toBe(false);
    expect(batcher.pendingBytes).toBe(8_000);
  });

  it("writes once the batch has been open long enough", () => {
    const batcher = new ChunkBatcher();
    batcher.add(blob(4_000), 0);
    expect(batcher.ready(CHUNK_FLUSH_MS - 1)).toBe(false);
    expect(batcher.ready(CHUNK_FLUSH_MS)).toBe(true);
  });

  it("writes early when a batch grows large, whatever the clock says", () => {
    const batcher = new ChunkBatcher();
    batcher.add(blob(CHUNK_FLUSH_BYTES), 0);
    expect(batcher.ready(1)).toBe(true);
  });

  it("numbers batches in strict order", () => {
    const batcher = new ChunkBatcher();
    batcher.add(blob(10), 0);
    expect(batcher.take()?.seq).toBe(0);
    batcher.add(blob(10), 1);
    expect(batcher.take()?.seq).toBe(1);
    batcher.add(blob(10), 2);
    expect(batcher.take()?.seq).toBe(2);
  });

  it("never emits an empty batch, so the sequence has no holes", () => {
    // stop() flushes unconditionally; on an already-drained buffer that must
    // be a no-op, not a numbered batch carrying nothing.
    const batcher = new ChunkBatcher();
    expect(batcher.take()).toBeNull();
    batcher.add(blob(10), 0);
    expect(batcher.take()).not.toBeNull();
    expect(batcher.take()).toBeNull();
    expect(batcher.nextSeq).toBe(1);
  });

  it("ignores a zero-length timeslice", () => {
    const batcher = new ChunkBatcher();
    batcher.add(blob(0), 0);
    expect(batcher.ready(CHUNK_FLUSH_MS * 10)).toBe(false);
    expect(batcher.take()).toBeNull();
  });

  it("restarts the clock for each batch", () => {
    const batcher = new ChunkBatcher();
    batcher.add(blob(10), 0);
    batcher.take();
    batcher.add(blob(10), 100_000);
    expect(batcher.ready(100_001)).toBe(false);
    expect(batcher.ready(100_000 + CHUNK_FLUSH_MS)).toBe(true);
  });
});

describe("putting a recovered capture back together", () => {
  const chunk = (seq: number) => ({ seq, data: new Uint8Array([seq]).buffer });

  it("concatenates the batches in order, whatever order they came back in", () => {
    const parts = assembleChunks([chunk(2), chunk(0), chunk(1)]);
    expect(parts).not.toBeNull();
    expect(parts!.map((part) => new Uint8Array(part)[0])).toEqual([0, 1, 2]);
  });

  it("refuses a sequence with no first batch", () => {
    // seq 0 carries the container header (EBML for WebM). Concatenating the
    // rest without it produces bytes that decode to nothing — handing her that
    // as "recovered audio" would be worse than admitting the loss.
    expect(assembleChunks([chunk(1), chunk(2)])).toBeNull();
  });

  it("refuses a sequence with a hole in the middle", () => {
    expect(assembleChunks([chunk(0), chunk(1), chunk(3)])).toBeNull();
  });

  it("has nothing to recover from an empty store", () => {
    expect(assembleChunks([])).toBeNull();
  });
});
