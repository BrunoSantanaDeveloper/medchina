/**
 * The hero of the campaign landing page, chosen by the ad that produced the
 * click.
 *
 * Message match (docs/FUNIL.md, the marketing-page skill): a visitor who
 * clicked "quantas vezes você olhou para a tela?" has to find that promise in
 * the first line of the page, not a generic product headline. One page with a
 * variable hero, rather than one page per angle, because everything below the
 * fold — price, guarantee, steps, FAQ — is identical and would otherwise be
 * maintained five times.
 *
 * The selector is the ad name, which the Meta URL parameter `utm_content`
 * already carries into the query string and which the middleware stores as
 * first-touch attribution: name each ad `<angle>-<format>-<hook>-v1` and the
 * page resolves the prefix. An unknown value falls back to `presenca` rather
 * than failing, and only the slugs below are ever read — the parameter is
 * attacker-controlled.
 *
 * Copy rules that apply to every line here (docs/DESIGN.md, HOME-SPEC §6.3):
 * the AI never diagnoses or decides, absence is never negation, no fabricated
 * number, feminine voice.
 */
export type AngleSlug = "presenca" | "memoria" | "confianca" | "mtc" | "plano";

export type OfferAngle = {
  eyebrow: string;
  /** The headline, split so the Landing DS can colour the closing phrase. */
  title: string;
  accent: string;
  lead: string;
};

/**
 * The hero ART does not change with the angle.
 *
 * The Landing DS stage is a teal bleed tuned for this portrait composite
 * (`.hero-composite img` sits at 85% width, offset above the fold). A square
 * white screenshot dropped into it reads as a floating tile — verified on the
 * first render of this page. Per-angle product evidence lives in the "Como
 * funciona" section instead, where the layout was built for screenshots.
 */
export const HERO_IMAGE = {
  src: "/images/medchina-hero-product-composite.webp",
  alt: "Profissional de Medicina Tradicional Chinesa usando o MedChina no computador e no celular",
  width: 1024,
  height: 1536,
} as const;

export const OFFER_ANGLES: Record<AngleSlug, OfferAngle> = {
  presenca: {
    eyebrow: "Prontuário inteligente para Medicina Tradicional Chinesa",
    title: "Atenda olhando para a paciente.",
    accent: "O MedChina organiza o restante.",
    lead: "Grave a consulta com a autorização da paciente e receba a anamnese preenchida, na estrutura da MTC, pronta para a sua revisão. Você conduz a consulta; a plataforma prepara o registro.",
  },
  memoria: {
    eyebrow: "A consulta inteira no prontuário",
    title: "O que ela contou às 14h",
    accent: "não se perde até você registrar.",
    lead: "A conversa vira anamnese estruturada, e cada campo mostra o trecho que o originou. O que não foi dito fica em branco: ausência nunca vira negação.",
  },
  confianca: {
    eyebrow: "Você revisa, você decide",
    title: "O que a paciente não disse fica em branco.",
    accent: "Você revisa e valida.",
    lead: "A inteligência artificial organiza o que foi relatado, aponta lacunas e prepara hipóteses para a sua revisão. Nada é finalizado sem você, e cada campo mostra de onde veio no áudio.",
  },
  mtc: {
    eyebrow: "Feito para MTC, não adaptado",
    title: "Um prontuário que fala a sua língua:",
    accent: "Zang-Fu, língua e pulso.",
    lead: "Queixa, sono, digestão, emoções, língua, pulso, pontos e meridianos, técnica por sessão e evolução — organizados como você raciocina, e não como um formulário de clínica geral.",
  },
  plano: {
    eyebrow: "Do relato à conduta",
    title: "Do relato ao plano terapêutico,",
    accent: "sem recomeçar do zero.",
    lead: "A plataforma organiza o que foi relatado e prepara sugestões de pontos e protocolos para a sua revisão. Você edita, valida e assina — e a próxima consulta já começa sabendo o que mudou.",
  },
};

export const DEFAULT_ANGLE: AngleSlug = "presenca";

/**
 * Resolves the angle from `utm_content` (the ad name).
 *
 * Matches the prefix before the first separator, so `memoria-reels-19h-v2`
 * selects `memoria` and the full ad name still reaches the attribution cookie
 * unchanged.
 */
export function resolveAngle(raw: string | string[] | undefined): AngleSlug {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return DEFAULT_ANGLE;
  const slug = value
    .toLowerCase()
    .replace(/[^a-z-]/g, "")
    .split("-")[0];
  return slug in OFFER_ANGLES ? (slug as AngleSlug) : DEFAULT_ANGLE;
}
