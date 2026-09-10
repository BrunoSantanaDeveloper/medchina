import {
  type ColumnMapping,
  HISTORY_FIELDS,
  type HistoryFieldKey,
  type ImportKind,
  PATIENT_FIELDS,
  type PatientFieldKey,
  SCHEDULE_FIELDS,
  type ScheduleFieldKey,
} from "./types";

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

// A header that names an EVENT is not the patient's identity. Found by a real
// incident: an attendance export imported as a patients sheet mapped "ID
// Atendimento" onto `external_ref`, which is unique per workspace, is the
// first and authoritative matching rule of every later import, is fill-only in
// the writer and appears on no screen. One visit id became one patient's
// identity, so a woman with twelve sessions became twelve charts — and no
// future import could ever correct the key.
const NOT_THE_PATIENT_RECORD = [
  "atendimento",
  "consulta",
  "sessao",
  "agendamento",
  "procedimento",
  "exame",
  "fatura",
  "pagamento",
  "recibo",
  "lancamento",
];

// Where she lives is not who she is: "Cidade do Paciente" contains "paciente"
// and would otherwise win the name field before the real "Paciente" column,
// because the first matching header wins.
// Substrings for the long words, whole words for the short ones: as a
// substring "cep" sits inside "recepcao", and "Nome do Paciente (Recepção)"
// lost its name column.
const NOT_A_NAME = ["cidade", "municipio", "bairro", "endereco", "logradouro"];
const NOT_A_NAME_WORDS = ["cep", "estado", "uf"];

/**
 * Names an identifier rather than content. "Nº" normalizes to a lone "n", so
 * "Nº Atendimento" is caught as a word. "no" is deliberately NOT a marker: it
 * is also the preposition in "Relato no atendimento", which is text.
 */
const isIdentifierHeader = (header: string) =>
  ["id", "cod", "n", "num", "nro", "seq"].some((term) => word(header, term)) || has(header, "codigo", "numero");

const MATCHERS: Record<PatientFieldKey, (header: string) => boolean> = {
  // An identifier is never her name: "Cód. Paciente" contains "paciente" and,
  // as the first column of a classic export, became every chart's NAME —
  // "1024", "1025" — while the real "Nome" column was discarded.
  full_name: (header) =>
    !has(header, ...NOT_THE_PATIENT) &&
    !has(header, ...NOT_A_NAME) &&
    !NOT_A_NAME_WORDS.some((term) => word(header, term)) &&
    !isIdentifierHeader(header) &&
    !has(header, "sobrenome", "usuario", "social") &&
    has(header, "nome", "paciente", "name"),
  // "data" alone is refused on purpose: in a patient export it is as likely to
  // be the registration date, and a registration date silently imported as a
  // birth date is exactly the kind of wrong this engine exists to avoid.
  birth_date: (header) =>
    !has(header, ...NOT_THE_PATIENT) &&
    !has(header, "cadastro", "atendimento", "consulta") &&
    has(header, "nasc", "dob", "birth"),
  // "rg" and "doc" match as WHOLE WORDS, never as substrings. As substrings
  // they captured "Alergias", "Cirurgias" and "Urgencia" — and the document is
  // the only field in this engine that merges two charts automatically, so a
  // column of allergies became an identity: forty patients answering "Nenhuma"
  // collapsed into one key.
  document: (header) =>
    !has(header, ...NOT_THE_PATIENT) &&
    (has(header, "cpf", "cnpj", "document", "identidade", "docto", "registro geral") ||
      word(header, "rg") ||
      word(header, "doc")),
  phone: (header) =>
    !has(header, ...NOT_THE_PATIENT) &&
    !has(header, "nome") &&
    has(header, "telefone", "celular", "whatsapp", "fone", "tel", "contato"),
  email: (header) => !has(header, ...NOT_THE_PATIENT) && has(header, "email", "e mail"),
  external_ref: (header) =>
    !has(header, ...NOT_THE_PATIENT) &&
    !has(header, ...NOT_THE_PATIENT_RECORD) &&
    // "Registro Geral" is the RG — a document, not the old system's id.
    !has(header, "registro geral") &&
    (word(header, "id") ||
      word(header, "cod") ||
      has(header, "codigo", "prontuario", "registro", "matricula", "ficha")),
  notes: (header) => has(header, "obs", "anotac", "nota", "comentario", "descricao"),
};

const isSurname = (header: string) => has(header, "sobrenome", "ultimo nome", "last name", "surname");

/**
 * A history sheet is one line per past consultation. Its columns answer a
 * different question — WHO, WHEN, and the text itself — so the patient here is
 * a reference to an existing chart, never a new one.
 */
const HISTORY_MATCHERS: Record<HistoryFieldKey, (header: string) => boolean> = {
  patient_ref: (header) =>
    has(header, "prontuario", "matricula") ||
    (has(header, "paciente") && has(header, "codigo", "id", "cod", "ref", "numero")),
  patient_name: (header) => !has(header, ...NOT_THE_PATIENT) && has(header, "paciente", "nome", "name"),
  // Unlike a patients sheet, a bare "data" here IS the record's date: that is
  // what a history export is about.
  // "dt" stays a SUBSTRING: legacy exports glue it on ("DtAtendimento"), and
  // as a whole word the date went unmapped while the body took the column.
  date: (header) => has(header, "data", "date", "dt") && !has(header, "nasc"),
  // "atendimento" is a legitimate term for the text ("Descrição do
  // Atendimento") and also the name of its id ("ID Atendimento"). An id offered
  // as the BODY is the worse failure: history rows are written finalized and
  // frozen, so a chart whose entire content is the number 10234 cannot be
  // edited afterwards — and that is the path someone takes to FIX a wrong
  // import.
  body: (header) =>
    !isIdentifierHeader(header) &&
    has(header, "evolucao", "descricao", "texto", "anotac", "obs", "relato", "conduta", "historico", "atendimento"),
  // The visit id IS this record's external ref — and it is what makes a
  // second import of the same history update instead of duplicating, so it has
  // to know every way a Brazilian export writes "número".
  external_ref: (header) => isIdentifierHeader(header) || has(header, "registro"),
  source: (header) => has(header, "sistema", "origem", "fonte"),
};

/**
 * An agenda sheet shares most of its vocabulary with a history sheet — who and
 * when — and adds the two things an appointment needs: a clock time and how
 * long it lasts.
 */
const SCHEDULE_MATCHERS: Record<ScheduleFieldKey, (header: string) => boolean> = {
  patient_ref: HISTORY_MATCHERS.patient_ref,
  patient_name: HISTORY_MATCHERS.patient_name,
  date: (header) => (has(header, "data", "date") || word(header, "dia")) && !has(header, "nasc", "semana"),
  time: (header) => has(header, "hora", "horario", "time", "hr"),
  duration: (header) => has(header, "duracao", "duration", "minutos", "tempo"),
  note: (header) => has(header, "obs", "anotac", "nota", "descricao", "motivo", "procedimento"),
  // The visit id IS this record's external ref — and it is what makes a
  // second import of the same history update instead of duplicating, so it has
  // to know every way a Brazilian export writes "número".
  external_ref: (header) => isIdentifierHeader(header) || has(header, "registro"),
};

export function guessColumnMapping(headers: string[], kind: ImportKind = "patients"): MappingGuess {
  const normalized = headers.map(normalizeHeader);
  const taken = new Set<number>();
  const mapping: ColumnMapping = {};

  if (kind === "schedule") {
    for (const field of SCHEDULE_FIELDS) {
      const matches = SCHEDULE_MATCHERS[field];
      const index = normalized.findIndex(
        (header, position) => !taken.has(position) && header !== "" && matches(header),
      );
      if (index >= 0) {
        mapping[field] = index;
        taken.add(index);
      }
    }
    return { mapping };
  }

  if (kind === "history") {
    for (const field of HISTORY_FIELDS) {
      const matches = HISTORY_MATCHERS[field];
      const index = normalized.findIndex(
        (header, position) => !taken.has(position) && header !== "" && matches(header),
      );
      if (index >= 0) {
        mapping[field] = index;
        taken.add(index);
      }
    }
    return { mapping };
  }

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
