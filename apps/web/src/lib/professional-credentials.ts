/**
 * Who signed the document, in the lines that go under the signature rule.
 *
 * Every PDF the product issues — atestado, receituário, plano terapêutico,
 * orientações — was signed with the professional's name and a generic
 * "Profissional responsável". A clinical document that reaches the patient, an
 * insurer or another practitioner has to carry the CREDENTIAL: the registration
 * and the title she practises under. She was writing that by hand on the print.
 *
 * Shared by the four renderers so the signature block cannot drift between the
 * certificate and the prescription — the same person must read the same way on
 * every piece of paper that leaves the practice.
 */
export interface ProfessionalCredentials {
  registration?: string | null;
  title?: string | null;
}

/**
 * The lines to print, in order, already trimmed and free of empties.
 *
 * `fallbackTitle` is the generic label used when she has not filled a title —
 * the block never collapses to a bare name, and never prints an empty line.
 * A registration is prefixed by the caller's own label so the number never
 * stands alone as an unexplained code on a signed document.
 */
export function credentialLines(
  credentials: ProfessionalCredentials,
  labels: { fallbackTitle: string; registration: (value: string) => string },
): string[] {
  const title = (credentials.title ?? "").trim();
  const registration = (credentials.registration ?? "").trim();
  return [title || labels.fallbackTitle, registration ? labels.registration(registration) : ""].filter(
    (line) => line !== "",
  );
}
