"use client";

import { registerForLiveEvent, type SignupState } from "../lei-15345/actions";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { useActionState, useEffect, useRef, useState } from "react";

import { track } from "@/lib/analytics";
import { formatMobileBrInput } from "@flyee/fields";
import { ArrowRight, CheckCircle, UsersThree, WhatsappLogo } from "@phosphor-icons/react";

export type EventTermText = { title: string; body: string };

type Props = {
  /** Distinguishes the two forms on the page (hero and closing) for label ids. */
  idPrefix: string;
  /** "3 de outubro, às 20h (horário de Brasília)" — or null while undated. */
  startsLabel: string | null;
  contactTerm: EventTermText | null;
  marketingTerm: EventTermText | null;
  /** The signed-in professional's own name/e-mail, to save typing. */
  prefill: { name: string | null; email: string | null };
  /** This page's own campaign parameters (this registration's last touch). */
  touch: Record<string, string>;
  /** The server already recognized this browser (cookie). */
  registered: boolean;
  /** Her personal link, rebuilt from the cookie — the QR and "guarde este link" after a reload. */
  registeredLink: string | null;
  /** The live is over: the sign-up is the short capture for the recording (§11). */
  afterEvent: boolean;
  hasGroup: boolean;
  hasOwnerPhone: boolean;
  submitLabel: string;
};

const INITIAL: SignupState = { status: "idle" };

/**
 * The sign-up block of the live-event page (docs/PAGINA-EVENTO.md §5, §6):
 * name + WhatsApp, e-mail optional, one step, and the confirmation in the same
 * place. A native `<form action>` bound to a server action, so it also works
 * without JavaScript; with it, the block swaps in place and the page refreshes
 * underneath (the other form on the page, and the room on the day, then see the
 * registration through the cookie).
 */
export default function EventSignupForm(props: Props) {
  const [state, formAction, pending] = useActionState(registerForLiveEvent, INITIAL);
  const router = useRouter();
  const leadSent = useRef(false);

  useEffect(() => {
    if (state.status !== "confirmed" || !state.registrationId) return;
    // One `Lead` per NEW registration, browser-side only (docs/TRACKING.md):
    // the eventID is the registration id, so a future server-side event can
    // deduplicate against it. A repeat of an existing number fires nothing.
    if (state.created && !leadSent.current) {
      leadSent.current = true;
      track("Lead", { content_name: "lei-15345" }, { eventId: state.registrationId, ga4Name: "generate_lead" });
    }
    router.refresh();
  }, [state, router]);

  if (state.status === "confirmed") {
    return (
      <Confirmation
        firstName={state.firstName}
        startsLabel={props.startsLabel}
        personalLink={state.personalLink}
        hasGroup={props.hasGroup}
        hasOwnerPhone={props.hasOwnerPhone}
        afterEvent={props.afterEvent}
      />
    );
  }
  if (props.registered) {
    return (
      <Confirmation
        firstName={null}
        startsLabel={props.startsLabel}
        personalLink={props.registeredLink}
        hasGroup={props.hasGroup}
        hasOwnerPhone={props.hasOwnerPhone}
        afterEvent={props.afterEvent}
      />
    );
  }

  const error = state.status === "error" ? state : null;
  const values = error?.values ?? {
    name: props.prefill.name ?? "",
    phone: "",
    email: props.prefill.email ?? "",
    marketing: false,
  };

  // Remounted after each failed submit, so the typed values come back as the
  // fields' defaults (React resets a form after its action runs).
  return (
    <form key={error?.attempt ?? 0} action={formAction} className="event-form" noValidate>
      <Field id={`${props.idPrefix}-name`} label="Seu nome" error={error?.field === "name" ? error.message : null}>
        <input
          id={`${props.idPrefix}-name`}
          name="name"
          type="text"
          autoComplete="name"
          defaultValue={values.name}
          maxLength={120}
          required
          aria-invalid={error?.field === "name" || undefined}
          aria-describedby={error?.field === "name" ? `${props.idPrefix}-name-error` : undefined}
        />
      </Field>

      <PhoneField
        id={`${props.idPrefix}-phone`}
        defaultValue={values.phone}
        error={error?.field === "phone" ? error.message : null}
      />

      <Field
        id={`${props.idPrefix}-email`}
        label="E-mail (opcional)"
        hint={
          props.afterEvent ? "Para receber a gravação também por e-mail." : "Para receber o link também por e-mail."
        }
        error={error?.field === "email" ? error.message : null}
      >
        <input
          id={`${props.idPrefix}-email`}
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          defaultValue={values.email}
          maxLength={254}
          aria-invalid={error?.field === "email" || undefined}
          aria-describedby={error?.field === "email" ? `${props.idPrefix}-email-error` : undefined}
        />
      </Field>

      {/* Invisible to people (off-screen, out of the tab order, hidden from
          assistive technology); bots fill every field. */}
      <div className="event-honeypot" aria-hidden="true">
        <label htmlFor={`${props.idPrefix}-site`}>Não preencha este campo</label>
        <input id={`${props.idPrefix}-site`} name="site" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      {Object.entries(props.touch).map(([key, value]) => (
        <input key={key} type="hidden" name={`t_${key}`} value={value} />
      ))}

      <label className="event-optin" htmlFor={`${props.idPrefix}-marketing`}>
        <input id={`${props.idPrefix}-marketing`} name="marketing" type="checkbox" defaultChecked={values.marketing} />
        <span>
          Quero receber novidades e condições do MedChina por WhatsApp e e-mail, e autorizo o uso do meu contato em
          anúncios do MedChina nas redes sociais. Posso sair quando quiser.
        </span>
      </label>
      {props.marketingTerm ? (
        <details className="event-term">
          <summary>Ler o termo de novidades</summary>
          <p>{props.marketingTerm.body}</p>
        </details>
      ) : null}
      <p className="event-note">Sem essa opção marcada, seu contato serve só para este evento.</p>

      {error && !error.field ? (
        <p className="event-error" role="alert">
          {error.message}
        </p>
      ) : null}

      <button className="button event-submit" type="submit" disabled={pending}>
        {pending ? "Enviando…" : props.submitLabel} {pending ? null : <ArrowRight size={18} />}
      </button>

      <p className="event-consent">
        Ao se inscrever, você autoriza o MedChina a enviar o link, os lembretes e a gravação deste evento pelo WhatsApp
        e, se informou, por e-mail. O grupo de avisos só recebe mensagens da equipe e não mostra o seu número aos outros
        participantes.
      </p>
      {props.contactTerm ? (
        <details className="event-term">
          <summary>Ler o termo completo</summary>
          <p>{props.contactTerm.body}</p>
        </details>
      ) : null}
    </form>
  );
}

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className={`event-field ${error ? "event-field--error" : ""}`}>
      <label htmlFor={id}>{label}</label>
      {children}
      {error ? (
        <p className="event-field-error" id={`${id}-error`} role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="event-field-hint">{hint}</p>
      ) : null}
    </div>
  );
}

/** Controlled so the mask follows the typing (and a pasted +55 is dropped). */
function PhoneField({ id, defaultValue, error }: { id: string; defaultValue: string; error: string | null }) {
  const [value, setValue] = useState(() => formatMobileBrInput(defaultValue));
  return (
    <Field id={id} label="Seu WhatsApp" error={error}>
      <input
        id={id}
        name="phone"
        type="tel"
        inputMode="numeric"
        autoComplete="tel"
        placeholder="(00) 00000-0000"
        value={value}
        onChange={(event) => setValue(formatMobileBrInput(event.target.value))}
        maxLength={16}
        required
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={error ? `${id}-error` : undefined}
      />
    </Field>
  );
}

/**
 * Where attendance is decided (§6). The group button is the one call to action;
 * the WhatsApp button lets her start the conversation herself (proof the number
 * is hers, and the team's reply is then a reply, not an unsolicited message).
 */
function Confirmation({
  firstName,
  startsLabel,
  personalLink,
  hasGroup,
  hasOwnerPhone,
  afterEvent,
}: {
  firstName: string | null;
  startsLabel: string | null;
  personalLink: string | null;
  hasGroup: boolean;
  hasOwnerPhone: boolean;
  /** After the live the promise is the recording, not a seat on a date that has passed. */
  afterEvent: boolean;
}) {
  const [qr, setQr] = useState<string | null>(null);
  // The QR is scanned by the PHONE, which does not have this browser's cookie:
  // it carries the personal token, so the group opens already recognized.
  const groupWithToken = personalLink
    ? personalLink.replace("/api/public/evento/entrar?", "/api/public/evento/grupo?")
    : null;

  useEffect(() => {
    if (!hasGroup || !groupWithToken) return;
    QRCode.toDataURL(groupWithToken, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 360,
      color: { dark: "#086761ff", light: "#ffffffff" },
    })
      .then(setQr)
      .catch(() => setQr(null));
  }, [groupWithToken, hasGroup]);

  return (
    <div className="event-confirm" role="status">
      <p className="event-confirm-title">
        <CheckCircle size={22} weight="fill" aria-hidden="true" />
        {afterEvent
          ? firstName
            ? `Pronto, ${firstName}. Você vai receber a gravação.`
            : "Você vai receber a gravação."
          : firstName
            ? `Pronto, ${firstName}. Seu lugar está garantido.`
            : "Você está inscrita."}
      </p>
      {startsLabel && !afterEvent ? <p className="event-confirm-date">{startsLabel}</p> : null}

      {hasGroup ? (
        <div className="event-confirm-group">
          <div>
            <a className="button event-confirm-primary" href="/api/public/evento/grupo">
              <UsersThree size={20} weight="fill" aria-hidden="true" /> Entrar no grupo de avisos
            </a>
            <p className="event-note">
              {afterEvent
                ? "É pelo grupo que a gravação e os próximos avisos chegam."
                : "É no grupo que você recebe os lembretes e o aviso de que a sala abriu."}
            </p>
          </div>
          {qr ? (
            <figure className="event-confirm-qr">
              <img src={qr} alt="QR code para entrar no grupo de avisos pelo celular" width={180} height={180} />
              <figcaption>No computador? Aponte a câmera do celular.</figcaption>
            </figure>
          ) : null}
        </div>
      ) : null}

      {hasOwnerPhone ? (
        <a className="button button--secondary event-confirm-secondary" href="/api/public/evento/whatsapp">
          <WhatsappLogo size={19} weight="fill" aria-hidden="true" />{" "}
          {afterEvent ? "Receber a gravação no meu WhatsApp" : "Receber o link no meu WhatsApp"}
        </a>
      ) : null}

      <p className="event-confirm-day">
        {afterEvent
          ? "A gravação também fica nesta página, é só voltar aqui."
          : "No dia, a sala abre nesta mesma página. O aviso sai no grupo."}
      </p>

      {personalLink ? (
        <div className="event-confirm-link">
          <p>
            {afterEvent
              ? "Guarde este link. Ele abre a gravação em qualquer celular:"
              : "Guarde este link. Ele abre a sala em qualquer celular:"}
          </p>
          <a href={personalLink}>{personalLink}</a>
        </div>
      ) : null}
    </div>
  );
}
