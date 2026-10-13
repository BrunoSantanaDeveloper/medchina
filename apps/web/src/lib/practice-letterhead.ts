import { formatCep, formatCpfCnpj, formatPhoneBr, onlyDigits } from "@flyee/fields";

/**
 * The clinic's identification, in the lines that go under its name on an issued
 * document.
 *
 * Every PDF the product issues — atestado, receituário, plano terapêutico,
 * orientações — carried the practice NAME and nothing else. A sheet that leaves
 * with the patient, or reaches an insurer or another practitioner, has to say
 * WHICH practice: the document it operates under, where it is, and how to reach
 * it. She was writing that by hand on the print, or stamping it.
 *
 * Shared by the four renderers, for the same reason `credentialLines` is: the
 * same practice must read the same way on every piece of paper that leaves it.
 *
 * The data is optional by construction (migration 0121 made every column
 * nullable so accounts older than the screen keep working), so EVERY line here
 * collapses on its own. A practice that filled nothing prints exactly what it
 * printed before — its name — and never an empty line, a stray comma or a
 * dangling separator.
 */
export interface PracticeLetterhead {
  document?: string | null;
  phone?: string | null;
  email?: string | null;
  postalCode?: string | null;
  street?: string | null;
  number?: string | null;
  complement?: string | null;
  district?: string | null;
  city?: string | null;
  state?: string | null;
}

/**
 * The columns the letterhead needs, as a PostgREST select fragment.
 *
 * Here rather than in each issue route: four routes copying the same ten column
 * names is four chances for one of them to miss the next field and print a
 * letterhead that is quietly shorter than the others.
 */
export const PRACTICE_LETTERHEAD_COLUMNS =
  "practice_document, practice_phone, practice_email, practice_postal_code, " +
  "practice_street, practice_number, practice_complement, practice_district, practice_city, practice_state";

/** Maps the selected row onto the letterhead shape. A missing row prints nothing. */
export function toPracticeLetterhead(row: Record<string, unknown> | null | undefined): PracticeLetterhead {
  const read = (key: string) => (typeof row?.[key] === "string" ? (row[key] as string) : null);
  return {
    document: read("practice_document"),
    phone: read("practice_phone"),
    email: read("practice_email"),
    postalCode: read("practice_postal_code"),
    street: read("practice_street"),
    number: read("practice_number"),
    complement: read("practice_complement"),
    district: read("practice_district"),
    city: read("practice_city"),
    state: read("practice_state"),
  };
}

export interface LetterheadLabels {
  /** "CPF" / "CNPJ" — chosen by length, because the stored value is digits. */
  cpf: string;
  cnpj: string;
}

const clean = (value: string | null | undefined): string => (value ?? "").trim();

/** Joins the parts that exist, so a missing middle never leaves "A ·  · C". */
const join = (separator: string, ...parts: (string | null | undefined)[]): string =>
  parts.map(clean).filter(Boolean).join(separator);

/**
 * The lines to print under the practice name, in order, already formatted for
 * reading — the columns store digits, a letterhead shows the mask.
 */
export function letterheadLines(practice: PracticeLetterhead, labels: LetterheadLabels): string[] {
  const document = onlyDigits(clean(practice.document));
  // 14 digits is a CNPJ, 11 a CPF. Anything else was never valid (the CHECK in
  // 0121 refuses it) and is dropped rather than printed under a wrong label.
  const documentLine =
    document.length === 14
      ? `${labels.cnpj} ${formatCpfCnpj(document)}`
      : document.length === 11
        ? `${labels.cpf} ${formatCpfCnpj(document)}`
        : "";

  // "Rua das Flores, 120 — Sala 3". The number hangs off the street: without one
  // it is dropped rather than printed as a bare numeral on its own line.
  const street = clean(practice.street);
  const streetLine = join(" — ", street ? join(", ", street, practice.number) : "", practice.complement);

  const cityState = join("/", practice.city, practice.state);
  const postalCode = onlyDigits(clean(practice.postalCode));
  const localityLine = join(" · ", practice.district, cityState, postalCode.length === 8 ? formatCep(postalCode) : "");

  const phone = onlyDigits(clean(practice.phone));
  const contactLine = join(" · ", phone ? formatPhoneBr(phone) : "", practice.email);

  return [documentLine, streetLine, localityLine, contactLine].map((line) => line.trim()).filter(Boolean);
}
