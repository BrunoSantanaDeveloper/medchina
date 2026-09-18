"use client";

import { useTransition } from "react";

import type { HomeCopy } from "@/components/marketing/home-copy";
import { acknowledgeDetectedLocale, setClientLocale } from "@/i18n/locale";
import { ArrowRight, Translate, X } from "@phosphor-icons/react";

/**
 * "We picked this language for you" — shown ONLY when the site switched the
 * visitor's language on its own (browser language or IP country), never when
 * she chose it.
 *
 * Why it exists: an automatic switch with no way back is how someone whose
 * browser is set to another language than she reads ends up on a page she
 * cannot navigate, with no visible cause. The strip states the reason and
 * offers the default language in one click. It is written in the DETECTED
 * language, which is the only language the reader is assumed to understand
 * here — the copy lives in the language's own file.
 */
export default function HomeLanguageNotice({
  copy,
  defaultLocaleName,
}: {
  copy: HomeCopy["language"];
  /** Portuguese, named in the visitor's language (copy.names["pt-BR"]). */
  defaultLocaleName: string;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <aside className="lang-notice" aria-live="polite" aria-busy={isPending}>
      <Translate size={17} weight="duotone" aria-hidden="true" />
      <p>{copy.notice.message}</p>
      <button
        className="lang-notice-switch"
        type="button"
        lang="pt-BR"
        onClick={() => startTransition(() => setClientLocale("pt-BR"))}
        disabled={isPending}
      >
        {copy.notice.switchToDefault}
        <ArrowRight size={14} weight="bold" aria-hidden="true" />
      </button>
      <button
        className="lang-notice-dismiss"
        type="button"
        aria-label={copy.notice.dismiss}
        title={copy.notice.dismiss}
        onClick={() => startTransition(() => acknowledgeDetectedLocale())}
        disabled={isPending}
      >
        <X size={15} weight="bold" aria-hidden="true" />
      </button>
      {/* The name of the default language, for anyone using a screen reader on
          a button label that is a verb phrase in her own language. */}
      <span className="lang-notice-sr">{defaultLocaleName}</span>
    </aside>
  );
}
