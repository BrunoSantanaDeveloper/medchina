/**
 * Nothing gets clipped — on stage or on paper.
 *
 * A slide is composed against a fixed canvas, but the same slide carries
 * Portuguese and Chinese, and Portuguese runs roughly a third longer — the
 * hypotheses slide overflowed in pt-BR and lost the bottom of the ethical
 * disclaimer, which is the one line on it that must be read. Rather than
 * hand-tuning each slide for the longer language, the frame measures the
 * composed block and shrinks only what does not fit.
 *
 * The floor is 0.72: below that the slide is genuinely overloaded and should
 * lose content, not legibility.
 *
 * Shared by the stage (one slide at a time) and the exporter (every slide at
 * once), so a PDF page and the projected slide can never be fitted by two
 * different rules.
 */
export const FIT_FLOOR = 0.72;

/** Measure one `.deck-slide` and set its `--fit`. Safe to call repeatedly. */
export function fitSlide(section: HTMLElement) {
  const inner = section.querySelector<HTMLElement>(".deck-slide-inner");
  if (!inner) return;

  // `offsetHeight` ignores transforms, so the current `--fit` does not skew
  // the measurement and the call is idempotent.
  const style = getComputedStyle(section);
  const available = section.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
  const needed = inner.offsetHeight;
  const fit = needed > available ? Math.max(FIT_FLOOR, available / needed) : 1;
  section.style.setProperty("--fit", String(fit));
}
