import { type ColumnMapping, PATIENT_FIELDS, type PatientFieldKey } from "./types";

/**
 * Header -> field, guessed. Always a SUGGESTION: the wizard shows it next to
 * five real rows and she confirms or overrides. A wrong guess she can see is
 * fine; a wrong guess applied silently is how a phone number ends up in the
 * document field.
 */

export type MappingGuess = {
  mapping: ColumnMapping;
  /**
   * Exports that split the name in two ("Nome" + "Sobrenome") are common
   * enough that refusing them would send her back to Excel to concatenate.
   */
  surnameColumn?: number;
};

const COMBINING_START = 0x0300;
const COMBINING_END = 0x036f;

/**
 * Accent- and punctuation-insensitive header key. Written as an explicit code
 * point range rather than a regex over combining characters: those are
 * invisible in source and survive an editor round-trip badly.
 */
export function normalizeHeader(header: string): string {
  let stripped = "";
  for (const char of header.normalize("NFD")) {
    const code = char.codePointAt(0) ?? 0;
    if (code >= COMBINING_START && code <= COMBINING_END) continue;
    stripped += char;
  }
  return stripped
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const has = (header: string, ...terms: string[]) => terms.some((term) => header.includes(term));
const word = (header: string, term: string) => header === term || header.split(" ").includes(term);

// A header that names somebody else's data must never win the patient's own
// field: "nome da mãe" is not the patient, and neither is "telefone do
// responsável".
const NOT_THE_PATIENT = ["mae", "pai", "responsavel", "conjuge", "indicacao", "convenio", "profissional"];

const MATCHERS: Record<PatientFieldKey, (header: string) => boolean> = {
  full_name: (header) =>
    !has(header, ...NOT_THE_PATIENT) &&
    !has(header, "sobrenome", "usuario", "social") &&
    has(header, "nome", "paciente", "name"),
  // "data" alone is refused on purpose: in a patient export it is as likely to
  // be the registration date, and a registration date silently imported as a
  // birth date is exactly the kind of wrong this engine exists to avoid.
  birth_date: (header) =>
    !has(header, ...NOT_THE_PATIENT) &&
    !has(header, "cadastro", "atendimento", "consulta") &&
    has(header, "nasc", "dob", "birth"),
  document: (header) =>
    !has(header, ...NOT_THE_PATIENT) && has(header, "cpf", "cnpj", "documento", "doc", "rg", "identidade"),
  phone: (header) =>
    !has(header, ...NOT_THE_PATIENT) &&
    !has(header, "nome") &&
    has(header, "telefone", "celular", "whatsapp", "fone", "tel", "contato"),
  email: (header) => !has(header, ...NOT_THE_PATIENT) && has(header, "email", "e mail"),
  external_ref: (header) =>
    word(header, "id") || word(header, "cod") || has(header, "codigo", "prontuario", "registro", "matricula", "ficha"),
  notes: (header) => has(header, "obs", "anotac", "nota", "comentario", "descricao"),
};

const isSurname = (header: string) => has(header, "sobrenome", "ultimo nome", "last name", "surname");

export function guessColumnMapping(headers: string[]): MappingGuess {
  const normalized = headers.map(normalizeHeader);
  const taken = new Set<number>();
  const mapping: ColumnMapping = {};

  // Field order (PATIENT_FIELDS) is the priority: the fields an import is
  // useless without claim their column before the optional ones do.
  for (const field of PATIENT_FIELDS) {
    const matches = MATCHERS[field];
    const index = normalized.findIndex((header, position) => !taken.has(position) && header !== "" && matches(header));
    if (index >= 0) {
      mapping[field] = index;
      taken.add(index);
    }
  }

  let surnameColumn: number | undefined;
  if (mapping.full_name !== undefined) {
    const index = normalized.findIndex((header, position) => !taken.has(position) && isSurname(header));
    if (index >= 0) {
      surnameColumn = index;
      taken.add(index);
    }
  }

  return surnameColumn === undefined ? { mapping } : { mapping, surnameColumn };
}
