import "./lei-15345.css";

import EventSignupForm from "../components/event-signup-form";
import LiveRoom, { LiveStateWatcher } from "../components/live-room";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import TrackEvent from "@/components/consent/track-event";
import { getSellableCampaign } from "@/lib/campaign-offer-server";
import {
  getEventTerms,
  getLiveEvent,
  getLiveEventViewer,
  getRegistrationFromCookie,
  youtubeIdFrom,
} from "@/lib/live-event";
import { cleanText, formatEventStart, LIVE_EVENT_SLUG, personalEventLink } from "@/lib/live-event-shared";
import {
  ArrowRight,
  Broadcast,
  CalendarBlank,
  CheckCircle,
  Eye,
  PresentationChart,
  Scales,
  UserCircle,
} from "@phosphor-icons/react/dist/ssr";

/**
 * The live event (docs/PAGINA-EVENTO.md).
 *
 * One route, four states read at request time from `live_events` — the page is
 * the invitation, the room and, afterwards, the recording, so every message
 * about the event points at the same URL:
 *
 *  - `rascunho`   → 404 for everyone except a superadmin (preview banner);
 *  - `inscricoes` → the invitation and the sign-up;
 *  - `ao_vivo`    → the room: the stream, with the subscribe CTA beside it;
 *  - `encerrado`  → the recording, the CTA, and a short capture.
 *
 * Built in the Landing DS inside the (funil) group: no site menu, noindex, out
 * of the sitemap (decision D10). Hardcoded pt-BR, in Debora's first person —
 * the page is hers.
 *
 * The marketing hooks do NOT run on (funil): docs/PAGINA-EVENTO.md §15 is the
 * checklist this page was built against.
 */
export const dynamic = "force-dynamic";

const PAGE_TITLE = "Ao vivo: o que muda depois da Lei 15.345";
const PAGE_DESCRIPTION =
  "Debora Giovanella, fundadora do MedChina, conta ao vivo o que muda para o acupunturista brasileiro depois da Lei 15.345 e o que viu no Congresso de MTC em Xinjiang, na China.";

export const metadata: Metadata = {
  title: { absolute: `${PAGE_TITLE} · MedChina` },
  description: PAGE_DESCRIPTION,
  // A dated campaign page: out of the index and the sitemap (FUNIL.md D10).
  // Open Graph is a separate decision — the link travels by WhatsApp.
  robots: { index: false, follow: false },
  alternates: { canonical: "/lei-15345" },
  openGraph: {
    title: `${PAGE_TITLE} · MedChina`,
    description: PAGE_DESCRIPTION,
    type: "website",
    locale: "pt_BR",
    siteName: "MedChina",
    url: "/lei-15345",
  },
  twitter: { card: "summary_large_image", title: `${PAGE_TITLE} · MedChina`, description: PAGE_DESCRIPTION },
};

const TOUCH_KEYS = ["origem", "utm_source", "utm_medium", "utm_campaign", "utm_content"] as const;

/** This page's own campaign parameters — allowlisted, trimmed, bounded. */
function pageTouch(params: Record<string, string | string[] | undefined>): Record<string, string> {
  const touch: Record<string, string> = {};
  for (const key of TOUCH_KEYS) {
    const raw = params[key];
    const value = cleanText(Array.isArray(raw) ? raw[0] : raw, 64);
    if (value) touch[key] = value;
  }
  return touch;
}

const POSTER = "/images/medchina-presence-consultation.webp";

export default async function LiveEventPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [params, event, viewer, terms] = await Promise.all([
    searchParams,
    getLiveEvent(LIVE_EVENT_SLUG),
    getLiveEventViewer(),
    getEventTerms(),
  ]);

  if (!event) notFound();
  const preview = event.state === "rascunho";
  if (preview && !viewer.isSuperadmin) notFound();

  const registration = await getRegistrationFromCookie(event.id);
  const registered = Boolean(registration);
  const starts = event.starts_at ? formatEventStart(event.starts_at) : null;
  const touch = pageTouch(params);

  // Someone who already pays never gets a purchase button: /assinar would take
  // her straight to a checkout that REPLACES her plan with no credit for the
  // days paid (lib/live-event.ts, BILLING-AUDIT A1).
  const paying = viewer.plan === "paying";
  const sellable = paying ? null : await getSellableCampaign();
  const medium = event.state === "encerrado" ? "gravacao" : "ao-vivo";
  const ctaHref = sellable
    ? `/assinar?origem=lei-15345&utm_source=lei-15345&utm_medium=${medium}&utm_campaign=lei-15345&utm_content=china-lei15345-${
        medium === "gravacao" ? "gravacao" : "aovivo"
      }-v1`
    : "/planos";

  const liveId = event.state === "ao_vivo" ? youtubeIdFrom(event.stream_url) : null;
  const recordingId = event.state === "encerrado" ? youtubeIdFrom(event.recording_url) : null;

  const afterEvent = event.state === "encerrado";
  const formProps = {
    // After the live, the date is history: the capture promises the recording.
    startsLabel: afterEvent ? null : (starts?.label ?? null),
    afterEvent,
    contactTerm: terms.contact ? { title: terms.contact.title, body: terms.contact.body } : null,
    marketingTerm: terms.marketing ? { title: terms.marketing.title, body: terms.marketing.body } : null,
    prefill: { name: viewer.name, email: viewer.email },
    touch,
    registered,
    registeredLink: registration ? personalEventLink(registration.token) : null,
    hasGroup: Boolean(event.group_invite_url),
    hasOwnerPhone: Boolean(event.owner_phone),
  };

  const cta = paying ? (
    <p className="event-member">
      <CheckCircle size={20} weight="fill" aria-hidden="true" /> Você já é assinante. Obrigada por estar aqui.
    </p>
  ) : (
    <a className="button" href={ctaHref}>
      Assinar o MedChina <ArrowRight size={18} />
    </a>
  );

  const heading = (
    <>
      <h1 id="evento-title">
        O que muda para o acupunturista brasileiro depois da Lei 15.345 <em>e o que eu vi na China.</em>
      </h1>
      <p className="event-signature">
        <UserCircle size={20} weight="duotone" aria-hidden="true" /> com Debora Giovanella, fundadora do MedChina
      </p>
    </>
  );

  // The room (ao_vivo, registered) and the recording (encerrado) take the hero.
  const showRoom = event.state === "ao_vivo" && registered && liveId;
  const showRecording = event.state === "encerrado" && recordingId;

  return (
    <main className="clinical-source-home offer-page event-page">
      <TrackEvent event="ViewContent" props={{ content_name: "lei-15345", content_category: "event" }} />

      {preview ? (
        <p className="event-preview" role="status">
          Prévia — esta página ainda não está publicada. Só superadmins a veem.
        </p>
      ) : null}

      {showRoom || showRecording ? (
        <section className="event-room" aria-labelledby="evento-title">
          <div className="event-room-inner">
            <p className="eyebrow">
              {showRoom ? (
                <>
                  <Broadcast size={16} weight="fill" aria-hidden="true" /> Ao vivo agora
                </>
              ) : (
                "A gravação está aqui"
              )}
            </p>
            {heading}
            <div className="event-room-grid">
              <LiveRoom
                videoId={(showRoom ? liveId : recordingId) as string}
                live={Boolean(showRoom)}
                title={event.title}
                poster={POSTER}
                // Presence is attendance at the live; the recording is not counted.
                trackPresence={registered && Boolean(showRoom)}
              />
              <aside className="event-room-side">
                <p className="event-room-side-title">Quer levar isso para o seu consultório?</p>
                <p>
                  O MedChina grava a consulta com a autorização da paciente e devolve a anamnese preenchida na estrutura
                  da MTC, pronta para a sua revisão. Você revisa, valida e assina.
                </p>
                {cta}
              </aside>
            </div>
            {/* Rendered for a registered visitor too: the refresh after a sign-up
                recognizes her, and a block that disappeared would take her
                confirmation (group button, personal link) with it. */}
            {showRecording ? (
              <div className="event-room-capture">
                <p className="event-room-side-title">
                  {registered ? "Sua inscrição" : "Receba a gravação no seu WhatsApp"}
                </p>
                <EventSignupForm
                  {...formProps}
                  idPrefix="gravacao"
                  startsLabel={null}
                  submitLabel="Receber a gravação no meu WhatsApp"
                />
              </div>
            ) : null}
          </div>
        </section>
      ) : (
        <section className="hero event-hero" aria-labelledby="evento-title">
          {/* Three grid areas, not two columns: on a phone the order becomes
              title → form → details, so the form starts on the first screen
              (§5) while the desktop keeps the copy beside the card. */}
          <div className="event-hero-inner">
            <div className="event-hero-copy">
              <p className="eyebrow">
                {event.state === "ao_vivo"
                  ? "Ao vivo agora · inscreva-se para entrar"
                  : afterEvent
                    ? starts
                      ? `Foi ao vivo em ${starts.date}`
                      : "Foi ao vivo"
                    : starts
                      ? `Ao vivo · ${starts.date}, às ${starts.time} (horário de Brasília)`
                      : "Ao vivo · data a confirmar"}
              </p>
              {heading}
            </div>
            <div className="event-hero-details">
              <p className="hero-lead">
                Em janeiro, a acupuntura virou profissão regulamentada no Brasil. Em setembro, eu levei o MedChina ao
                Congresso de MTC em Xinjiang, na China.{" "}
                {afterEvent
                  ? "No ao vivo eu contei as duas coisas, e o que elas mudam no seu consultório."
                  : "Nesta noite eu conto as duas coisas, e o que elas mudam no seu consultório."}
              </p>
              {starts && !afterEvent ? (
                <p className="event-when">
                  <CalendarBlank size={20} weight="duotone" aria-hidden="true" />
                  <span>
                    <strong>
                      {starts.weekday}, {starts.date}
                    </strong>
                    <small>às {starts.time}, horário de Brasília · online, nesta página</small>
                  </span>
                </p>
              ) : null}
            </div>
            <div className="event-card" id="inscricao">
              {event.state === "encerrado" ? (
                <p className="event-card-title">A gravação chega em breve nesta página.</p>
              ) : (
                <p className="event-card-title">{registered ? "Sua inscrição" : "Garanta seu lugar"}</p>
              )}
              <EventSignupForm
                {...formProps}
                idPrefix="topo"
                submitLabel={event.state === "encerrado" ? "Receber a gravação no meu WhatsApp" : "Quero participar"}
              />
            </div>
          </div>
          {event.state === "inscricoes" && event.starts_at ? (
            <LiveStateWatcher slug={event.slug} startsAt={event.starts_at} />
          ) : null}
        </section>
      )}

      {/* What you will see — three lines, not a syllabus. Precision (§4): the
          law defines who may practise and creates no record-keeping duty; the
          congress is never "oficial" or "internacional"; the demo is simulated
          with a fictitious patient (PRODUCT.md §7.4). */}
      <section className="section offer-section--tinted" aria-labelledby="ver-title">
        <div className="section-heading section-heading--center">
          <p className="eyebrow">{afterEvent ? "O que está na gravação" : "O que você vai ver"}</p>
          <h2 id="ver-title">
            Uma noite, <em>três assuntos.</em>
          </h2>
        </div>
        <div className="offer-includes">
          <article>
            <Scales size={30} weight="duotone" aria-hidden="true" />
            <h3>
              Quem pode exercer a acupuntura segundo a Lei 15.345, e o que muda na prática do consultório depois dela
            </h3>
          </article>
          <article>
            <PresentationChart size={30} weight="duotone" aria-hidden="true" />
            <h3>O que eu apresentei no Congresso de MTC em Xinjiang, e o que vi por lá</h3>
          </article>
          <article>
            <Eye size={30} weight="duotone" aria-hidden="true" />
            <h3>
              Uma consulta simulada, com paciente e diálogo fictícios, registrada do começo ao fim sem ninguém digitar
              durante o atendimento
            </h3>
          </article>
        </div>
      </section>

      <section className="section" aria-labelledby="quem-title">
        <div className="section-heading section-heading--center">
          <p className="eyebrow">Quem apresenta</p>
          <h2 id="quem-title">
            Feito por quem <em>atende.</em>
          </h2>
        </div>
        <div className="offer-founder">
          <img
            className="offer-founder-photo"
            src="/images/palestra/fundadora-debora.jpg"
            alt="Retrato de Debora Giovanella, fundadora do MedChina"
            width={963}
            height={963}
            loading="lazy"
            decoding="async"
          />
          <div>
            <h3>Debora Giovanella</h3>
            <p className="offer-founder-role">Fundadora do MedChina · Terapeuta de Medicina Tradicional Chinesa</p>
            <p>
              Terapeuta desde 2017, com formação em shiatsu e em acupuntura, e 25 anos em gestão de marketing e vendas.
              Idealizou o 1º Congresso Práticas da Sabedoria Milenar, em 2020, e conduz a visão clínica do produto.
            </p>
            <p>
              Em setembro de 2026 apresentou o MedChina no Congresso de MTC em Xinjiang, na China: a história da
              medicina chinesa no Brasil e o prontuário que ela construiu para quem atende.
            </p>
          </div>
        </div>
      </section>

      <section className="section offer-section--tinted" aria-labelledby="para-quem-title">
        <div className="section-heading section-heading--center">
          <p className="eyebrow">Para quem é</p>
          <h2 id="para-quem-title">
            Para quem registra <em>o que atende.</em>
          </h2>
          <p>
            Para quem atende com acupuntura ou MTC e registra as consultas — em papel, em caderno, em qualquer sistema.
            Se você nunca registrou nada e não pretende começar, {afterEvent ? "esta gravação" : "esta noite"} não vai
            te servir.
          </p>
        </div>
      </section>

      {event.state === "inscricoes" || (event.state === "ao_vivo" && !registered) ? (
        <section className="section event-closing" aria-labelledby="fim-title">
          <div className="section-heading section-heading--center">
            <p className="eyebrow">{starts ? starts.label : "Ao vivo"}</p>
            <h2 id="fim-title">
              {registered ? "Você está inscrita." : "Garanta seu lugar."} <em>A sala abre nesta página.</em>
            </h2>
          </div>
          <div className="event-card event-card--center">
            <EventSignupForm {...formProps} idPrefix="fim" submitLabel="Quero participar" />
          </div>
        </section>
      ) : null}

      {/* No purchase CTA before the event: until the room opens, the page has
          one job — "Quero participar" (docs/PAGINA-CHINA.md §0.1). The
          subscribe button lives in the room and on the recording. */}
    </main>
  );
}
