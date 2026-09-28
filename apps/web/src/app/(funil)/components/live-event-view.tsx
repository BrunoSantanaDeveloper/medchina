import "./live-event.css";

import EventSignupForm from "./event-signup-form";
import LiveRoom, { LiveStateWatcher } from "./live-room";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { after } from "next/server";
import { cache } from "react";

import TrackEvent from "@/components/consent/track-event";
import { rich } from "@/components/marketing/home-copy/rich";
import { getSellableCampaign } from "@/lib/campaign-offer-server";
import {
  getEventTerms,
  getLiveEvent,
  getLiveEventViewer,
  getRegistrationFromCookie,
  liveEventService,
  youtubeIdFrom,
} from "@/lib/live-event";
import {
  eventDaypart,
  eventPath,
  eventSlugFromPath,
  isSafeInternalPath,
  normalizeInternalPath,
  readEventTopics,
  type TopicIconKey,
  topicsCountLabel,
} from "@/lib/live-event-common";
import { cleanText, formatEventStart, type LiveEventRow, personalEventLink } from "@/lib/live-event-shared";
import { isCrawler } from "@/lib/locale-detection";
import {
  ArrowRight,
  BookOpen,
  Broadcast,
  CalendarBlank,
  ChartLineUp,
  ChatsCircle,
  CheckCircle,
  Eye,
  Heart,
  Leaf,
  PresentationChart,
  Scales,
  UserCircle,
  UsersThree,
  VideoCamera,
} from "@phosphor-icons/react/dist/ssr";

/**
 * The live-event page, for every event (docs/PAGINA-EVENTO.md; migration 0113).
 *
 * One template, four states read at request time from `live_events` — the page
 * is the invitation, the room and, afterwards, the recording, so every message
 * about the event points at the same URL:
 *
 *  - `rascunho`   → 404 for everyone except a superadmin (preview banner);
 *  - `inscricoes` → the invitation and the sign-up;
 *  - `ao_vivo`    → the room: the stream, with the subscribe CTA beside it;
 *  - `encerrado`  → per event, chosen in the console: the recording with a
 *                   short capture, or a redirect to another address of the site.
 *
 * The copy is the event's own content (headline, lead, topics, audience),
 * edited in /admin/eventos — a new event is a console action, not a deploy.
 * What stays in code is what every event shares: the form, the consent, the
 * presenter block, the structure. Built in the Landing DS inside the (funil)
 * group: no site menu, noindex, out of the sitemap (FUNIL D10). The marketing
 * hooks do NOT run on (funil): docs/PAGINA-EVENTO.md §15 is the checklist.
 */

/** One read per request, shared by generateMetadata and the page. */
const loadEvent = cache(getLiveEvent);

const POSTER = "/images/medchina-presence-consultation.webp";

const TOPIC_ICONS: Record<TopicIconKey, typeof Scales> = {
  lei: Scales,
  apresentacao: PresentationChart,
  consulta: Eye,
  conversa: ChatsCircle,
  livro: BookOpen,
  grafico: ChartLineUp,
  pessoas: UsersThree,
  coracao: Heart,
  folha: Leaf,
  video: VideoCamera,
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

/**
 * Where an ended event sends its visitors, or null. The target is compared as
 * the page it lands on (a query, a fragment, a trailing slash or
 * /ao-vivo/<legacy> would otherwise loop back here), and an event page as the
 * target must be one a visitor can see — not a draft, and not itself
 * redirecting (two ended events pointing at each other would loop forever).
 */
async function endedRedirect(event: LiveEventRow): Promise<string | null> {
  if (event.state !== "encerrado" || event.ended_behavior !== "redirect") return null;
  const target = event.ended_redirect_path;
  if (!isSafeInternalPath(target)) return null;
  if (normalizeInternalPath(target) === normalizeInternalPath(eventPath(event.slug))) return null;
  const targetSlug = eventSlugFromPath(target);
  if (targetSlug) {
    const targetEvent = await loadEvent(targetSlug);
    if (!targetEvent || targetEvent.state === "rascunho") return null;
    if (targetEvent.state === "encerrado" && targetEvent.ended_behavior === "redirect") return null;
  }
  return target;
}

/**
 * Title and preview from the event itself. A draft says nothing about itself:
 * its 404 must not carry the planned title in the tab or in a link preview.
 */
export async function liveEventMetadata(slug: string): Promise<Metadata> {
  const event = await loadEvent(slug);
  const noindex = { index: false, follow: false };
  if (!event || event.state === "rascunho") return { title: { absolute: "MedChina" }, robots: noindex };
  const path = eventPath(event.slug);
  const title = `${event.page_title ?? event.title} · MedChina`;
  const description = event.description ?? undefined;
  return {
    title: { absolute: title },
    description,
    // A dated campaign page: out of the index and the sitemap (FUNIL.md D10).
    robots: noindex,
    alternates: { canonical: path },
    openGraph: { title, description, type: "website", locale: "pt_BR", siteName: "MedChina", url: path },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function LiveEventView({
  slug,
  searchParams,
}: {
  slug: string;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const [event, viewer, terms] = await Promise.all([loadEvent(slug), getLiveEventViewer(), getEventTerms()]);

  if (!event) notFound();
  const preview = event.state === "rascunho";
  if (preview && !viewer.isSuperadmin) notFound();

  // An ended event may send its visitors elsewhere (a choice made per event in
  // the console). The operator still sees the page, with a banner saying so.
  const redirectTo = await endedRedirect(event);
  if (redirectTo && !viewer.isSuperadmin) redirect(redirectTo);

  const touch = pageTouch(searchParams);

  // Visits by channel, for "registered ÷ visited" in the console. Counted after
  // the response, never for a crawler, a draft or an operator — and only for a
  // DOCUMENT load: the sign-up's server action (which sets a cookie, so Next
  // re-renders the page) and the refresh after it are RSC requests of the same
  // visit, and counting them inflated every registration by two visits. Next
  // strips its own RSC/Next-Action headers from `headers()`, so the browser's
  // fetch metadata decides: a navigation is `Sec-Fetch-Dest: document`, and
  // asks for HTML (an RSC fetch asks for text/x-component).
  const requestHeaders = await headers();
  const fetchDest = requestHeaders.get("sec-fetch-dest");
  const documentLoad = fetchDest
    ? fetchDest === "document"
    : (requestHeaders.get("accept") ?? "").includes("text/html");
  if (documentLoad && !preview && !viewer.isSuperadmin && !isCrawler(requestHeaders.get("user-agent"))) {
    const channel = touch.origem ?? touch.utm_source ?? null;
    after(async () => {
      const service = liveEventService();
      if (service) await service.rpc("count_live_event_view", { target_slug: event.slug, target_origem: channel });
    });
  }

  const registration = await getRegistrationFromCookie(event.id);
  const registered = Boolean(registration);
  const starts = event.starts_at ? formatEventStart(event.starts_at) : null;

  // Someone who already pays never gets a purchase button: /assinar would take
  // her straight to a checkout that REPLACES her plan with no credit for the
  // days paid (lib/live-event.ts, BILLING-AUDIT A1).
  const paying = viewer.plan === "paying";
  const sellable = paying ? null : await getSellableCampaign();
  const medium = event.state === "encerrado" ? "gravacao" : "ao-vivo";
  // The campaign IS the event: `utm_campaign=<slug>` is what the console's
  // "compras" reads back from purchase_attributions (migration 0113). It rides
  // on BOTH destinations — /planos too, where the middleware keeps it as the
  // last-touch campaign until the checkout — or a sale made while no offer is
  // open would be credited to nothing. `utm_content` leads with the event's
  // /assinar angle, which /assinar reads from its first word.
  const campaign = [
    `origem=${event.slug}`,
    `utm_source=${event.slug}`,
    `utm_medium=${medium}`,
    `utm_campaign=${event.slug}`,
    `utm_content=${event.offer_angle ? `${event.offer_angle}-` : ""}${event.slug}-${medium}`,
  ].join("&");
  const ctaHref = sellable ? `/assinar?${campaign}` : `/planos?${campaign}`;

  const liveId = event.state === "ao_vivo" ? youtubeIdFrom(event.stream_url) : null;
  const recordingId = event.state === "encerrado" ? youtubeIdFrom(event.recording_url) : null;

  const afterEvent = event.state === "encerrado";
  const lead = afterEvent ? (event.lead_after ?? event.lead) : event.lead;
  const topics = readEventTopics(event.topics);

  const formProps = {
    eventSlug: event.slug,
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
      <h1 id="evento-title">{rich(event.headline ?? event.title)}</h1>
      <p className="event-signature">
        <UserCircle size={20} weight="duotone" aria-hidden="true" /> {event.byline}
      </p>
    </>
  );

  // The room (ao_vivo, registered) and the recording (encerrado) take the hero.
  const showRoom = event.state === "ao_vivo" && registered && liveId;
  const showRecording = event.state === "encerrado" && recordingId;

  return (
    <main className="clinical-source-home offer-page event-page">
      <TrackEvent event="ViewContent" props={{ content_name: event.slug, content_category: "event" }} />

      {preview ? (
        <p className="event-preview" role="status">
          Prévia — esta página ainda não está publicada. Só superadmins a veem.
        </p>
      ) : null}
      {redirectTo ? (
        <p className="event-preview" role="status">
          Evento encerrado: quem visita esta página é levado para {redirectTo}. Você a vê porque é superadmin.
        </p>
      ) : viewer.isSuperadmin && event.state === "encerrado" && event.ended_behavior === "redirect" ? (
        // The destination went bad after it was saved (the target event went
        // back to draft, or now redirects too): visitors see this page. Only
        // the operator can fix it, so only she is told.
        <p className="event-preview" role="status">
          O redirecionamento para {event.ended_redirect_path} está sendo ignorado: o destino é esta mesma página, um
          rascunho ou outro evento que também redireciona. Quem visita vê esta página. Corrija em /admin/eventos.
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
                eventSlug={event.slug}
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
              {lead ? <p className="hero-lead">{lead}</p> : null}
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
              {afterEvent ? (
                <p className="event-card-title">A gravação chega em breve nesta página.</p>
              ) : (
                <p className="event-card-title">{registered ? "Sua inscrição" : "Garanta seu lugar"}</p>
              )}
              <EventSignupForm
                {...formProps}
                idPrefix="topo"
                submitLabel={afterEvent ? "Receber a gravação no meu WhatsApp" : "Quero participar"}
              />
            </div>
          </div>
          {event.state === "inscricoes" && event.starts_at ? (
            <LiveStateWatcher slug={event.slug} startsAt={event.starts_at} />
          ) : null}
        </section>
      )}

      {/* What you will see — at most three lines, not a syllabus. The copy is
          the event's own; the precision rules of docs/PAGINA-EVENTO.md §4 bind
          whoever writes it in the console. */}
      {topics.length > 0 ? (
        <section className="section offer-section--tinted" aria-labelledby="ver-title">
          <div className="section-heading section-heading--center">
            <p className="eyebrow">{afterEvent ? "O que está na gravação" : "O que você vai ver"}</p>
            <h2 id="ver-title">
              {eventDaypart(event.starts_at)}, <em>{topicsCountLabel(topics.length)}.</em>
            </h2>
          </div>
          <div className="offer-includes">
            {topics.map((topic) => {
              const Icon = TOPIC_ICONS[topic.icon];
              return (
                <article key={`${topic.icon}-${topic.text}`}>
                  <Icon size={30} weight="duotone" aria-hidden="true" />
                  <h3>{topic.text}</h3>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

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

      {event.audience ? (
        <section className="section offer-section--tinted" aria-labelledby="para-quem-title">
          <div className="section-heading section-heading--center">
            <p className="eyebrow">Para quem é</p>
            <h2 id="para-quem-title">
              {event.audience_heading ? (
                rich(event.audience_heading)
              ) : (
                <>
                  Para quem é <em>este encontro.</em>
                </>
              )}
            </h2>
            <p>{event.audience}</p>
          </div>
        </section>
      ) : null}

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
