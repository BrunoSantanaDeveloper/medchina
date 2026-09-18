import type { ReactNode } from "react";

/**
 * The home's headlines are not plain strings: the Landing DS puts the accent
 * phrase in <em>, the line breaks are a typographic decision, and the evidence
 * quote highlights the extracted terms with <mark>. Copy that has to exist in
 * six languages cannot carry JSX — a translator would have to edit the
 * component — so the copy files use a tiny inline syntax instead and this
 * renders it.
 *
 *   **accent**  -> <em>      the direction's accent phrase
 *   __strong__  -> <strong>  the emphasized lead of a principle line
 *   ==term==    -> <mark>    a term the AI extracted from the transcript
 *   \n          -> <br />    a deliberate break (each language breaks in its
 *                            own place; never inherit the Portuguese ones)
 *
 * Nesting is deliberately unsupported: every use on this page is one level.
 */
const TOKENS = /(\*\*[^*]+\*\*|__[^_]+__|==[^=]+==|\n)/g;

export function rich(text: string): ReactNode {
  const parts = text.split(TOKENS).filter((part) => part !== "");

  return parts.map((part, index) => {
    if (part === "\n") return <br key={index} />;
    if (part.startsWith("**") && part.endsWith("**")) return <em key={index}>{part.slice(2, -2)}</em>;
    if (part.startsWith("__") && part.endsWith("__")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("==") && part.endsWith("==")) return <mark key={index}>{part.slice(2, -2)}</mark>;
    return part;
  });
}

/** The same copy with every marker stripped — for `alt`, `aria-label`, `title`. */
export function plain(text: string): string {
  return text.replace(/\*\*|__|==/g, "").replace(/\n/g, " ");
}
