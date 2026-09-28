import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";

export type LiveEventEmailKind = "confirmation" | "day_before" | "hour_before" | "live" | "recording";

export type LiveEventEmailProps = {
  kind: LiveEventEmailKind;
  /** The event's title, as the page shows it. */
  eventTitle: string;
  /**
   * How the event is named inside a sentence — "sobre a Lei 15.345", or the
   * quoted title when the event has no topic (lib/live-event-common.ts
   * `aboutEvent`). Used by the subject line.
   */
  about: string;
  /** "3 de outubro, às 20h (horário de Brasília)" — formatted by the caller (packages/email never formats dates). */
  startsLabel: string | null;
  /** "20h" — for the hour-before reminder. */
  timeLabel: string | null;
  /** The personal link: recreates her registration on any device and lands on the event page. */
  personalLink: string;
  /** The Community invite through the app's redirect route, when the event has one. */
  groupUrl?: string | null;
  /** One-click unsubscribe from the EVENT e-mails (lead-scoped token). */
  unsubscribeUrl: string;
};

/**
 * The live event's e-mails (docs/PAGINA-EVENTO.md §8): ONE template, five
 * moments, in Debora's first person like the page. A redundant channel — the
 * WhatsApp announcement group is the main one — so every message is short and
 * points at the same page.
 *
 * Inline styles only (email clients ignore stylesheets), aligned with the
 * palette by hand like the other templates. Clinical-safety language holds here
 * too: the AI prepares, the professional decides; nothing about the law is said
 * beyond what the page says.
 */
const CONTENT: Record<
  LiveEventEmailKind,
  (props: LiveEventEmailProps) => { preview: string; heading: string; paragraphs: string[]; cta: string }
> = {
  confirmation: ({ eventTitle, startsLabel }) => ({
    preview: "Sua inscrição está confirmada",
    heading: "Seu lugar está garantido",
    paragraphs: [
      `Obrigada por se inscrever no ao vivo “${eventTitle}”.`,
      startsLabel ? `Quando: ${startsLabel}.` : "Assim que a data for confirmada, eu aviso por aqui e no grupo.",
      "A sala abre na própria página do evento. O botão abaixo é o seu link pessoal: ele abre a página em qualquer celular ou computador, já com a sua inscrição.",
    ],
    cta: "Abrir a página do evento",
  }),
  day_before: ({ eventTitle, startsLabel }) => ({
    preview: "É amanhã",
    heading: "É amanhã",
    paragraphs: [
      `Amanhã eu faço o ao vivo “${eventTitle}”.`,
      startsLabel ? `Anote: ${startsLabel}.` : "",
      "A sala abre na página do evento. Guarde o seu link pessoal.",
    ].filter(Boolean),
    cta: "Abrir a página do evento",
  }),
  hour_before: ({ timeLabel }) => ({
    preview: "Começa em uma hora",
    heading: "Começa em uma hora",
    paragraphs: [
      timeLabel
        ? `Daqui a pouco, às ${timeLabel} (horário de Brasília), a sala abre na página do evento.`
        : "Daqui a pouco a sala abre na página do evento.",
      "Entre alguns minutos antes: o vídeo começa quando você tocar no play.",
    ],
    cta: "Abrir a página do evento",
  }),
  live: () => ({
    preview: "Estamos ao vivo",
    heading: "Estamos ao vivo",
    paragraphs: ["A sala abriu. Toque no botão para entrar — o seu link pessoal já leva à sala."],
    cta: "Entrar na sala",
  }),
  recording: ({ eventTitle }) => ({
    preview: "A gravação está no ar",
    heading: "A gravação está no ar",
    paragraphs: [
      `Se você não conseguiu assistir ao ao vivo “${eventTitle}”, ou quer rever algum trecho, a gravação está na página do evento.`,
    ],
    cta: "Ver a gravação",
  }),
};

/** Every event shares the template: the subject names THIS event through `about`. */
export function liveEventSubject(kind: LiveEventEmailKind, about: string): string {
  switch (kind) {
    case "confirmation":
      return `Inscrição confirmada: o ao vivo ${about}`;
    case "day_before":
      return `É amanhã: o ao vivo ${about}`;
    case "hour_before":
      return `Começa em uma hora: o ao vivo ${about}`;
    case "live":
      return "Estamos ao vivo — a sala abriu";
    case "recording":
      return `A gravação do ao vivo ${about} está no ar`;
  }
}

export default function LiveEventEmail(props: LiveEventEmailProps) {
  const { preview, heading, paragraphs, cta } = CONTENT[props.kind](props);
  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={{ backgroundColor: "#f6f4ef", fontFamily: "Arial, Helvetica, sans-serif", margin: 0 }}>
        <Container
          style={{ backgroundColor: "#ffffff", borderRadius: 16, margin: "40px auto", maxWidth: 480, padding: 32 }}
        >
          <Text style={{ color: "#177c81", fontSize: 15, fontWeight: 700, letterSpacing: 0.3, margin: 0 }}>
            MedChina
          </Text>
          <Heading as="h1" style={{ color: "#2c3633", fontSize: 22, lineHeight: "30px", margin: "12px 0 4px" }}>
            {heading}
          </Heading>
          {paragraphs.map((paragraph) => (
            <Text key={paragraph} style={{ color: "#4d574f", fontSize: 15, lineHeight: "23px" }}>
              {paragraph}
            </Text>
          ))}
          <Section style={{ margin: "26px 0 8px" }}>
            <Button
              href={props.personalLink}
              style={{
                backgroundColor: "#177c81",
                borderRadius: 12,
                color: "#ffffff",
                display: "inline-block",
                fontSize: 15,
                fontWeight: 600,
                padding: "13px 26px",
                textDecoration: "none",
              }}
            >
              {cta}
            </Button>
          </Section>
          {props.groupUrl && props.kind !== "recording" ? (
            <Text style={{ color: "#4d574f", fontSize: 14, lineHeight: "21px" }}>
              Os lembretes e o aviso de que a sala abriu saem no{" "}
              <Link href={props.groupUrl} style={{ color: "#177c81", fontWeight: 700 }}>
                grupo de avisos do WhatsApp
              </Link>
              , que não mostra o seu número aos outros participantes.
            </Text>
          ) : null}
          <Text style={{ color: "#4d574f", fontSize: 15, lineHeight: "23px", margin: "18px 0 0" }}>
            Debora Giovanella
          </Text>
          <Text style={{ color: "#9aa39d", fontSize: 13, lineHeight: "19px", margin: 0 }}>Fundadora do MedChina</Text>
          <Hr style={{ borderColor: "#eae6dd", margin: "28px 0 16px" }} />
          <Text style={{ color: "#9aa39d", fontSize: 12, lineHeight: "18px", margin: 0 }}>
            Você recebe este e-mail porque se inscreveu em um ao vivo do MedChina.{" "}
            <Link href={props.unsubscribeUrl} style={{ color: "#9aa39d", textDecoration: "underline" }}>
              Não quero mais receber e-mails de eventos
            </Link>
            . No WhatsApp, responda SAIR. MedChina Gestão e Prontuários · CNPJ 38.504.491/0001-80 · Goiânia (GO).
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
