/**
 * Depoimentos reais de profissionais que usam o MedChina.
 *
 * COMO PUBLICAR UM DEPOIMENTO REAL (é o único caminho):
 *
 *  1. troque `quote`, `name` e `role` pelo texto e pela identificação que a
 *     pessoa autorizou — palavras dela, não uma versão "melhorada";
 *  2. preencha `consentAt` com a data em que ela autorizou o uso público;
 *  3. só então mude `approved` para `true`.
 *
 * Enquanto `approved` for `false`, a entrada NÃO vai ao ar em produção: a
 * seção inteira desaparece se nenhuma entrada estiver aprovada. Em
 * desenvolvimento ela aparece com um aviso visível, para você conferir o
 * layout antes de ter os textos definitivos.
 *
 * Isto não é excesso de zelo: depoimento inventado é proibido em toda página
 * pública deste projeto (HOME-SPEC §33.5, docs/FUNIL.md) e, em anúncio pago,
 * é também um problema de política de plataforma e de código de defesa do
 * consumidor. O interruptor existe para que um texto provisório não vire prova
 * social por esquecimento.
 *
 * Duas regras de conteúdo valem mesmo para o texto definitivo:
 *
 *  - nenhum número que não possa ser comprovado ("economizo 40% do tempo" só
 *    entra se houver como sustentar);
 *  - nenhuma promessa clínica ("acertei o diagnóstico"): a plataforma prepara
 *    hipóteses para revisão, e um depoimento não pode dizer o contrário do que
 *    o produto faz.
 */
export type Testimonial = {
  /** Palavras da pessoa, entre 200 e 320 caracteres — o que cabe num cartão. */
  quote: string;
  name: string;
  /** Formação e cidade: é o que faz a leitora se reconhecer. */
  role: string;
  /** Data em que a pessoa autorizou o uso público, em ISO. */
  consentAt: string | null;
  /** O interruptor. `false` = rascunho, invisível em produção. */
  approved: boolean;
};

/**
 * TEXTOS PROVISÓRIOS — escritos como marcação de layout, não como prova.
 *
 * Foram redigidos na voz da leitora (a mesma dos cartões de "Você reconhece?")
 * e no tamanho que o cartão comporta, para que a troca pelo depoimento real
 * não mude o desenho da página.
 */
export const TESTIMONIALS: Testimonial[] = [
  {
    quote:
      "[PROVISÓRIO] Eu passava a consulta dividida entre ouvir e anotar. Hoje eu escuto, e o registro chega pronto para eu revisar. A parte que mudou mesmo foi o fim do dia: não levo mais prontuário para casa.",
    name: "[Nome da profissional]",
    role: "[Acupunturista · Cidade/UF]",
    consentAt: null,
    approved: false,
  },
  {
    quote:
      "[PROVISÓRIO] O que me convenceu foi ver língua, pulso e padrão no lugar certo, sem ter que improvisar num campo de observações. Pela primeira vez o prontuário acompanha o raciocínio que eu já uso.",
    name: "[Nome da profissional]",
    role: "[Terapeuta de MTC · Cidade/UF]",
    consentAt: null,
    approved: false,
  },
  {
    quote:
      "[PROVISÓRIO] Eu tinha receio de usar IA em consulta. O que me tranquilizou foi que nada é finalizado sem mim, e cada campo mostra de onde veio no áudio. O que a paciente não falou continua em branco.",
    name: "[Nome da profissional]",
    role: "[Acupunturista · Cidade/UF]",
    consentAt: null,
    approved: false,
  },
];

/** Os depoimentos que podem ir ao ar. Vazio = a seção não é renderizada. */
export const APPROVED_TESTIMONIALS = TESTIMONIALS.filter((entry) => entry.approved);

/**
 * O que a página deve renderizar.
 *
 * Em produção, só o que foi aprovado. Em desenvolvimento, os rascunhos também
 * — sinalizados por `draft`, para que a página imprima o aviso e ninguém
 * confunda marcação de layout com prova social.
 */
export function testimonialsToRender(): { entries: Testimonial[]; draft: boolean } {
  if (APPROVED_TESTIMONIALS.length > 0) return { entries: APPROVED_TESTIMONIALS, draft: false };
  if (process.env.NODE_ENV === "production") return { entries: [], draft: false };
  return { entries: TESTIMONIALS, draft: true };
}
