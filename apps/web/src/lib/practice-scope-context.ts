import { PRACTICE_MODALITIES, type PracticeModality } from "@/lib/practice-context";

/**
 * The scope-of-practice block injected into the library assistant's prompt.
 *
 * The study assistant used to answer every professional identically: someone
 * who only practises auriculotherapy asked for "points for insomnia" and got
 * systemic points, with nothing in the answer acknowledging what she actually
 * does. Her declared scope (`profiles.practice_modalities`) already bounds the
 * therapeutic plan; here it becomes CONTEXT.
 *
 * Two rules make this different from the plan's use of the same data, and both
 * are deliberate:
 *
 *  - **It prioritises, it never forbids.** The plan is restrictive for a real
 *    reason — a validated plan is signed into a document under her professional
 *    responsibility, so proposing a modality she does not practise is a
 *    scope-of-practice problem. This is a STUDY assistant: refusing to discuss
 *    an approach she is learning would make the library worse, not safer.
 *  - **An empty declaration injects NOTHING.** In the plan, empty means "all
 *    modalities" so a skipped onboarding step can never produce an empty plan.
 *    Here there is nothing to prioritise, and a block announcing "she practises
 *    all five" would be noise the model has to reason around.
 *
 * Written in pt-BR because it joins a prompt whose base instructions are in
 * pt-BR (seeded assistant `biblioteca-mtc`, migration 0042).
 */

const MODALITY_LABELS: Record<PracticeModality, string> = {
  acupuncture: "acupuntura",
  diet: "dietoterapia chinesa",
  moxibustion: "moxabustão",
  auriculotherapy: "auriculoterapia",
  cupping: "ventosaterapia",
};

/** Keeps only the known slugs, in the canonical order of PRACTICE_MODALITIES. */
export function normalizeScope(declared: readonly string[] | null | undefined): PracticeModality[] {
  if (!declared || declared.length === 0) return [];
  return PRACTICE_MODALITIES.filter((slug) => declared.includes(slug));
}

export function buildPracticeScopeContext(declared: readonly string[] | null | undefined): string {
  const scope = normalizeScope(declared);
  if (scope.length === 0) return "";
  // Declaring every modality is the same as declaring none: there is nothing
  // to put first, so the block would only add tokens.
  if (scope.length === PRACTICE_MODALITIES.length) return "";

  const labels = scope.map((slug) => MODALITY_LABELS[slug]).join(", ");
  return [
    "\n\n## Escopo de prática desta profissional",
    `Ela atende com: ${labels}.`,
    "Ao responder, PRIORIZE essas abordagens e traga primeiro o que é aplicável a elas.",
    "Isto NÃO é uma restrição: se a pergunta pedir outra abordagem, ou se a melhor resposta vier de outra,",
    "responda normalmente e diga a qual abordagem o conteúdo pertence.",
  ].join("\n");
}
