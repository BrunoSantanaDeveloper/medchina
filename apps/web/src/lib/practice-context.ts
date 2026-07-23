export const COMMON_TIMEZONES = [
  "America/Sao_Paulo",
  "America/Bahia",
  "America/Belem",
  "America/Boa_Vista",
  "America/Cuiaba",
  "America/Fortaleza",
  "America/Manaus",
  "America/Porto_Velho",
  "America/Recife",
  "Europe/Lisbon",
  "UTC",
] as const;

export const PRACTICE_MODALITIES = ["acupuncture", "diet", "moxibustion", "auriculotherapy", "cupping"] as const;

export type PracticeModality = (typeof PRACTICE_MODALITIES)[number];

export function isValidTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
