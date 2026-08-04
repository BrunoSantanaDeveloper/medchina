import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { chunkText } from "./chunking.ts";

/**
 * The chunk is what gets embedded, so a defect here degrades every retrieval in
 * the product and raises no error anywhere. Two failure modes are pinned:
 *
 *  1. CRLF input. `\n{2,}` does not match `\r\n\r\n`, so a Windows-authored
 *     document used to arrive as ONE paragraph, fall into the hard-split path,
 *     and be sliced mid-word at fixed offsets. The seeded corpus is LF today —
 *     this makes that a guarantee instead of a coincidence.
 *  2. Word fragments at chunk edges, from either the hard split or the overlap
 *     carried between packed chunks.
 */
const CARD = [
  "IG4 — Hegu",
  "Localização: no dorso da mão, entre o primeiro e o segundo metacarpos.",
  "Indicações: cefaleia, odontalgia, febre, dor facial.",
  "Técnica: agulhamento perpendicular. Contraindicado em gestantes.",
];

/**
 * "Starts with a lowercase letter" is NOT the test: a chunk that opens on the
 * carried overlap legitimately begins mid-paragraph. The only honest check is
 * whether the edge tokens are WHOLE words of the source vocabulary.
 */
const edgeTokens = (chunk: string) => {
  const tokens = chunk.split(/\s+/).filter(Boolean);
  return [tokens[0], tokens[tokens.length - 1]];
};

describe("chunkText", () => {
  it("finds the same paragraphs whether the document uses LF or CRLF", () => {
    assert.deepEqual(chunkText(CARD.join("\r\n\r\n")), chunkText(CARD.join("\n\n")));
  });

  it("treats a lone CR as a line break too", () => {
    assert.deepEqual(chunkText(CARD.join("\r\r")), chunkText(CARD.join("\n\n")));
  });

  it("keeps a short document as one chunk under either line ending", () => {
    assert.equal(chunkText(CARD.join("\r\n\r\n")).length, 1);
  });

  it("never opens a chunk on a word fragment when packing paragraphs", () => {
    // A closed vocabulary, so any fragment produced by the overlap carry is
    // immediately visible as a token that is not a real word.
    const vocabulary = new Set(["conteudo", "clinico", "relevante"]);
    const paragraphs = Array.from({ length: 12 }, () => "conteudo clinico relevante ".repeat(12).trim());
    const chunks = chunkText(paragraphs.join("\n\n"));
    assert.ok(chunks.length > 1, "expected the document to span several chunks");
    for (const [index, chunk] of chunks.entries()) {
      for (const token of edgeTokens(chunk)) {
        assert.ok(vocabulary.has(token), `chunk ${index} has the fragment ${JSON.stringify(token)} at an edge`);
      }
    }
  });

  it("never cuts a word when hard-splitting one oversized paragraph", () => {
    // No blank lines at all: the whole thing is a single paragraph, which is
    // exactly the shape a CRLF document used to collapse into.
    const chunks = chunkText("palavra ".repeat(900).trim());
    assert.ok(chunks.length > 1, "expected the paragraph to be split");
    for (const chunk of chunks) {
      assert.ok(chunk.startsWith("palavra"), `chunk opens mid-word: ${JSON.stringify(chunk.slice(0, 20))}`);
      assert.ok(chunk.endsWith("palavra"), `chunk closes mid-word: ${JSON.stringify(chunk.slice(-20))}`);
    }
  });

  it("keeps every chunk within the size budget and loses no vocabulary", () => {
    const chunks = chunkText("alfa bravo charlie delta echo foxtrot ".repeat(150).trim());
    const rejoined = chunks.join(" ");
    for (const word of ["alfa", "bravo", "charlie", "delta", "echo", "foxtrot"]) {
      assert.ok(rejoined.includes(word), `lost ${word}`);
    }
    assert.ok(
      chunks.every((chunk) => chunk.length <= 1600),
      "a chunk exceeded maxChars",
    );
  });
});
