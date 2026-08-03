export interface ChunkOptions {
  /** Target chunk size in characters. */
  maxChars?: number;
  /** Characters repeated from the end of one chunk into the next. */
  overlap?: number;
}

/**
 * Paragraph-aware splitter: packs whole paragraphs up to maxChars and
 * falls back to a hard split (with overlap) for oversized paragraphs.
 */
export function chunkText(text: string, options: ChunkOptions = {}): string[] {
  const maxChars = options.maxChars ?? 1600;
  const overlap = options.overlap ?? 200;

  const paragraphs = text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = "";
  /** The last paragraph of the chunk just closed, repeated into the next one. */
  let carry = "";

  const flush = () => {
    if (!current.trim()) {
      current = "";
      return;
    }
    chunks.push(current.trim());
    // The documented overlap only ever existed for oversized paragraphs: a
    // packed chunk closed and the next one started cold, so an answer spanning
    // the boundary was retrievable from neither half. Carry the last paragraph
    // forward when it is small enough to be context rather than duplication.
    const paragraphs = current.trim().split(/\n{2,}/);
    const tail = paragraphs[paragraphs.length - 1] ?? "";
    carry = tail.length > 0 && tail.length <= overlap ? tail : tail.slice(-overlap);
    current = "";
  };

  for (const paragraph of paragraphs) {
    if (paragraph.length > maxChars) {
      flush();
      carry = "";
      for (let start = 0; start < paragraph.length; start += maxChars - overlap) {
        chunks.push(paragraph.slice(start, start + maxChars).trim());
        if (start + maxChars >= paragraph.length) break;
      }
      continue;
    }
    if (current.length + paragraph.length + 2 > maxChars) {
      flush();
      if (carry) current = carry;
    }
    current = current ? `${current}\n\n${paragraph}` : paragraph;
  }
  flush();

  return chunks;
}
