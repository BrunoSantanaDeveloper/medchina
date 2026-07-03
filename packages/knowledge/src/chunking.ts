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

  const flush = () => {
    if (current.trim()) chunks.push(current.trim());
    current = "";
  };

  for (const paragraph of paragraphs) {
    if (paragraph.length > maxChars) {
      flush();
      for (let start = 0; start < paragraph.length; start += maxChars - overlap) {
        chunks.push(paragraph.slice(start, start + maxChars).trim());
        if (start + maxChars >= paragraph.length) break;
      }
      continue;
    }
    if (current.length + paragraph.length + 2 > maxChars) flush();
    current = current ? `${current}\n\n${paragraph}` : paragraph;
  }
  flush();

  return chunks;
}
