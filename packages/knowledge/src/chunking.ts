export interface ChunkOptions {
  /** Target chunk size in characters. */
  maxChars?: number;
  /** Characters repeated from the end of one chunk into the next. */
  overlap?: number;
}

/** Cut a slice back to the nearest word boundary, never mid-word. */
function trimToWordStart(slice: string): string {
  const cut = slice.replace(/^\S*\s+/, "");
  return cut || slice;
}

function trimToWordEnd(slice: string): string {
  const cut = slice.replace(/\s+\S*$/, "");
  return cut || slice;
}

/**
 * Paragraph-aware splitter: packs whole paragraphs up to maxChars and
 * falls back to a hard split (with overlap) for oversized paragraphs.
 *
 * Line endings are normalised FIRST, and that is load-bearing rather than
 * tidiness. Paragraphs are found with `\n{2,}`, which does not match `\r\n\r\n`
 * — the two newlines are not adjacent. A CRLF document therefore looks like ONE
 * enormous paragraph, drops straight into the hard-split path, and is sliced at
 * fixed character offsets in the middle of words. The corpus is fine today
 * because nothing feeds this function CRLF, but "fine because of where the text
 * happened to come from" is not a property worth relying on: a Windows-authored
 * import, a file read with `core.autocrlf`, or a paste path that preserves CRLF
 * would silently shred the whole library, and the only symptom would be
 * retrieval quietly getting worse.
 */
export function chunkText(text: string, options: ChunkOptions = {}): string[] {
  const maxChars = options.maxChars ?? 1600;
  const overlap = options.overlap ?? 200;

  const paragraphs = text
    .replace(/\r\n?/g, "\n")
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
    // Whole words only: slicing the carry at a fixed offset opens the next
    // chunk on a word fragment, which is the same corruption the hard split is
    // criticised for — just quieter, because it hides in the overlap.
    carry = tail.length > 0 && tail.length <= overlap ? tail : trimToWordStart(tail.slice(-overlap));
    current = "";
  };

  for (const paragraph of paragraphs) {
    if (paragraph.length > maxChars) {
      flush();
      carry = "";
      for (let start = 0; start < paragraph.length; start += maxChars - overlap) {
        const end = start + maxChars;
        const slice = paragraph.slice(start, end);
        // Only the interior cuts need repairing: the first slice starts where
        // the paragraph does, and the last one ends where it ends.
        const head = start === 0 ? slice : trimToWordStart(slice);
        chunks.push((end >= paragraph.length ? head : trimToWordEnd(head)).trim());
        if (end >= paragraph.length) break;
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
