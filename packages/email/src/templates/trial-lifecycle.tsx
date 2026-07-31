import { Body, Button, Container, Head, Heading, Hr, Html, Link, Preview, Section, Text } from "@react-email/components";

export type TrialEmailKind = "welcome" | "activation" | "expiring" | "ended";

export type TrialLifecycleEmailProps = {
  kind: TrialEmailKind;
  /** First name / display name of the professional, when known. */
  name?: string;
  /** Absolute URL for the primary action (built by the caller per kind). */
  ctaUrl: string;
  /** Absolute URL of the one-click unsubscribe route (token-based). */
  unsubscribeUrl: string;
};

/**
 * Trial lifecycle drip (activation → expiration → upgrade). ONE template, four
 * moments. Inline styles only (email clients ignore stylesheets); values kept
 * aligned with the MedChina palette by hand (teal #177c81 / camel #c09362).
 * Copy is honest: the AI PREPARES a draft for the professional to review — it
 * never diagnoses — and never hardcodes a price (those live in the app).
 */
const CONTENT: Record<
  TrialEmailKind,
  { preview: string; heading: string; paragraphs: string[]; cta: string; ctaHint?: string }
> = {
  welcome: {
    preview: "Seu teste do MedChina Pro começou",
    heading: "Seu teste do Pro começou",
    paragraphs: [
      "A partir de agora, o MedChina grava a consulta, transcreve, estrutura a anamnese e prepara hipóteses de padrão e um rascunho de plano terapêutico — tudo para a sua revisão. Você interpreta, valida e decide.",
      "O jeito mais rápido de sentir o valor é registrar uma consulta de ponta a ponta.",
    ],
    cta: "Começar uma consulta",
  },
  activation: {
    preview: "Que tal registrar sua primeira consulta no MedChina?",
    heading: "Dê o primeiro passo",
    paragraphs: [
      "Você começou seu teste, mas ainda não finalizou uma consulta. É nesse momento que o MedChina mostra a que veio: a documentação pronta para revisar, sem retrabalho.",
      "Leva poucos minutos — cadastre um paciente e registre um atendimento.",
    ],
    cta: "Abrir o MedChina",
  },
  expiring: {
    preview: "Seu teste do MedChina Pro está acabando",
    heading: "Seu teste está acabando",
    paragraphs: [
      "Seu período de teste do Pro está chegando ao fim. Para não perder o acesso à transcrição, ao raciocínio clínico e ao plano terapêutico assistido, você pode assinar quando quiser.",
      "Seus registros e pacientes continuam com você de qualquer forma.",
    ],
    cta: "Ver planos e assinar",
  },
  ended: {
    preview: "Seu teste do Pro terminou — seus dados continuam com você",
    heading: "Seu teste do Pro terminou",
    paragraphs: [
      "O período de teste chegou ao fim. Sua conta continua ativa no plano gratuito: seus pacientes e prontuários manuais seguem completos e acessíveis.",
      "Quando quiser voltar a contar com a IA para documentar e preparar a consulta, é só assinar.",
    ],
    cta: "Voltar para o Pro",
  },
};

export default function TrialLifecycleEmail({ kind, name, ctaUrl, unsubscribeUrl }: TrialLifecycleEmailProps) {
  const { preview, heading, paragraphs, cta } = CONTENT[kind];
  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={{ backgroundColor: "#f6f4ef", fontFamily: "Arial, Helvetica, sans-serif", margin: 0 }}>
        <Container style={{ backgroundColor: "#ffffff", borderRadius: 16, margin: "40px auto", maxWidth: 480, padding: 32 }}>
          <Text style={{ color: "#177c81", fontSize: 15, fontWeight: 700, letterSpacing: 0.3, margin: 0 }}>MedChina</Text>
          <Heading as="h1" style={{ color: "#2c3633", fontSize: 22, lineHeight: "30px", margin: "12px 0 4px" }}>
            {name ? `${heading}, ${name}` : heading}
          </Heading>
          {paragraphs.map((paragraph) => (
            <Text key={paragraph} style={{ color: "#4d574f", fontSize: 15, lineHeight: "23px" }}>
              {paragraph}
            </Text>
          ))}
          <Section style={{ margin: "26px 0 8px" }}>
            <Button
              href={ctaUrl}
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
          <Hr style={{ borderColor: "#eae6dd", margin: "28px 0 16px" }} />
          <Text style={{ color: "#9aa39d", fontSize: 12, lineHeight: "18px", margin: 0 }}>
            Você recebe estes e-mails porque iniciou um teste no MedChina.{" "}
            <Link href={unsubscribeUrl} style={{ color: "#9aa39d", textDecoration: "underline" }}>
              Descadastrar destes avisos
            </Link>
            .
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
