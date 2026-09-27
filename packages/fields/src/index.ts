/**
 * @flyee/fields — pure logic for semantic form fields.
 *
 * Everything here is dependency-free and framework-free on purpose: the same
 * validators/formatters serve web (MUI fields in components/product/fields)
 * and mobile (RN Paper inputs). UI components live in the apps; only the
 * rules live here.
 *
 * Persistence rule: ALWAYS store the unformatted digits (`onlyDigits`), never
 * the masked string — masks are presentation.
 */

/** Strip everything that is not a digit. Store THIS, not the masked value. */
export function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

// ---------------------------------------------------------------------------
// CPF / CNPJ (Brazilian person/company registries — check-digit validated)
// ---------------------------------------------------------------------------

function checkDigit(digits: string, weights: number[]): number {
  const sum = weights.reduce((acc, weight, i) => acc + Number(digits[i]) * weight, 0);
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

/** True check-digit validation (rejects known-invalid repeated sequences). */
export function isValidCpf(value: string): boolean {
  const cpf = onlyDigits(value);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const d1 = checkDigit(cpf, [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = checkDigit(cpf, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  return cpf[9] === String(d1) && cpf[10] === String(d2);
}

export function isValidCnpj(value: string): boolean {
  const cnpj = onlyDigits(value);
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;
  const d1 = checkDigit(cnpj, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = checkDigit(cnpj, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return cnpj[12] === String(d1) && cnpj[13] === String(d2);
}

/** Accepts either document — validates by length. */
export function isValidCpfCnpj(value: string): boolean {
  const digits = onlyDigits(value);
  return digits.length <= 11 ? isValidCpf(digits) : isValidCnpj(digits);
}

export function formatCpf(value: string): string {
  const d = onlyDigits(value).slice(0, 11);
  return d
    .replace(/^(\d{3})(\d)/, "$1.$2")
    .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1-$2");
}

export function formatCnpj(value: string): string {
  const d = onlyDigits(value).slice(0, 14);
  return d
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}

export function formatCpfCnpj(value: string): string {
  return onlyDigits(value).length <= 11 ? formatCpf(value) : formatCnpj(value);
}

// IMask-style mask expressions (0 = digit) for the web inputs.
export const CPF_MASK = "000.000.000-00";
export const CNPJ_MASK = "00.000.000/0000-00";

// ---------------------------------------------------------------------------
// Phone (BR: 10 digits landline / 11 digits mobile with leading 9)
// ---------------------------------------------------------------------------

export function isValidPhoneBr(value: string): boolean {
  const d = onlyDigits(value);
  if (d.length !== 10 && d.length !== 11) return false;
  if (d[0] === "0") return false; // area codes are 11–99
  return d.length === 10 || d[2] === "9"; // 11-digit numbers are mobile (9xxxx)
}

export function formatPhoneBr(value: string): string {
  const d = onlyDigits(value).slice(0, 11);
  if (d.length <= 10) return d.replace(/^(\d{2})(\d)/, "($1) $2").replace(/(\d{4})(\d{1,4})$/, "$1-$2");
  return d.replace(/^(\d{2})(\d)/, "($1) $2").replace(/(\d{5})(\d{1,4})$/, "$1-$2");
}

export const PHONE_BR_MASKS = ["(00) 0000-0000", "(00) 00000-0000"];

// ---------------------------------------------------------------------------
// Mobile (BR) — a number that can receive WhatsApp
// ---------------------------------------------------------------------------

export type MobileBrResult =
  | { ok: true; digits: string }
  | { ok: false; reason: "empty" | "short" | "long" | "landline" | "invalid" };

/**
 * Strips what people actually paste: WhatsApp copies "+55 62 99999-9999", which
 * is 13 digits and would fail `isValidPhoneBr`; a trunk zero ("062…") is common
 * too. The country code and the zero go, the rest is judged as typed.
 */
function stripBrPrefixes(value: string): string {
  let d = onlyDigits(value);
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) d = d.slice(2);
  if (d.length === 12 && d.startsWith("0")) d = d.slice(1);
  return d;
}

/**
 * Normalizes a Brazilian MOBILE number to 11 bare digits (DDD + 9 + 8 digits),
 * or says in plain terms why it is not one. Unlike `isValidPhoneBr`, it refuses
 * landlines: this is for channels that need WhatsApp.
 *
 * A 10-digit number whose first local digit is 6–9 is almost always a mobile
 * written without the leading 9 (the pre-2016 format), so it reads as "short",
 * not as a landline — "one digit is missing" is the message that helps.
 */
export function normalizeMobileBr(value: string): MobileBrResult {
  const d = stripBrPrefixes(value);
  if (!d) return { ok: false, reason: "empty" };
  if (d[0] === "0") return { ok: false, reason: "invalid" };
  if (d.length < 10) return { ok: false, reason: "short" };
  if (d.length > 11) return { ok: false, reason: "long" };
  if (d.length === 10) return { ok: false, reason: /[6-9]/.test(d[2]) ? "short" : "landline" };
  if (d[2] !== "9") return { ok: false, reason: "invalid" };
  return { ok: true, digits: d };
}

/** The input mask for a mobile field: tolerant of a pasted +55 before masking. */
export function formatMobileBrInput(value: string): string {
  return formatPhoneBr(stripBrPrefixes(value));
}

// ---------------------------------------------------------------------------
// CEP / postal code + address lookup (provider interface, flyee pattern)
// ---------------------------------------------------------------------------

export function isValidCep(value: string): boolean {
  return onlyDigits(value).length === 8;
}

export function formatCep(value: string): string {
  return onlyDigits(value).slice(0, 8).replace(/^(\d{5})(\d)/, "$1-$2");
}

export const CEP_MASK = "00000-000";

export interface PostalAddress {
  postalCode: string;
  street: string;
  complement?: string;
  district: string;
  city: string;
  /** State/region code (BR: UF). */
  state: string;
}

/**
 * Address lookup behind an interface — same pattern as billing/whatsapp
 * providers. Implementations MUST resolve `null` on any failure (bad code,
 * network, provider down) and never throw: an unavailable lookup degrades to
 * manual address entry, it never blocks the form.
 */
export interface AddressLookupProvider {
  lookup(postalCode: string): Promise<PostalAddress | null>;
}

/** ViaCEP (https://viacep.com.br) — free BR provider, no API key. */
export const viaCep: AddressLookupProvider = {
  async lookup(postalCode) {
    const cep = onlyDigits(postalCode);
    if (cep.length !== 8) return null;
    try {
      const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      if (!response.ok) return null;
      const data = (await response.json()) as {
        erro?: boolean;
        cep?: string;
        logradouro?: string;
        complemento?: string;
        bairro?: string;
        localidade?: string;
        uf?: string;
      };
      if (data.erro) return null;
      return {
        postalCode: onlyDigits(data.cep ?? cep),
        street: data.logradouro ?? "",
        complement: data.complemento || undefined,
        district: data.bairro ?? "",
        city: data.localidade ?? "",
        state: data.uf ?? "",
      };
    } catch {
      return null;
    }
  },
};
