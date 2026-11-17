"use client";

import { BRL, type ConsoleEvent, type EventResults, percent } from "./event-model";

import { Box, Card, CardContent, Typography } from "@mui/material";

import EmptyState from "@/components/product/empty-state";
import { StatTile } from "@/components/product/home-tiles";
import InfoHint from "@/components/product/info-hint";
import MetricBars, { type MetricBarItem } from "@/components/product/metric-bars";
import IllustrationAccounts from "@/icons/illustrations/illustration-accounts";
import NiChartLineBar from "@/icons/nexture/ni-chart-line-bar";
import NiMoney from "@/icons/nexture/ni-money";
import NiScreen from "@/icons/nexture/ni-screen";
import NiUsers from "@/icons/nexture/ni-users";
import { eventPath } from "@/lib/live-event-common";

const TOP_CHANNELS = 5;

/**
 * How this event is doing (docs/PAGINA-EVENTO.md §14), in the order of the
 * chain: visit → registration → group click → presence → purchase. Every
 * number is a real count from `live_event_results` — nothing projected, no
 * trend drawn without a previous period to compare with.
 */
export default function EventResultsView({
  results,
  failed,
  event,
  onOpenSettings,
}: {
  results: EventResults | null;
  /** The load failed: the screen above says so; nothing here pretends it is empty. */
  failed: boolean;
  event: ConsoleEvent;
  onOpenSettings: () => void;
}) {
  if (!results) {
    // Still loading, or failed (the error is shown above the tabs, with a retry).
    return failed ? null : <Box className="min-h-40" aria-busy="true" />;
  }

  const total = results.registrations;
  // Visits are counted from migration 0113 on, never for an operator, while
  // registrations count everyone: a rate over 100% is an artefact, not news.
  const rate = total > results.visits ? "—" : percent(total, results.visits);
  const rateOf = (registrations: number, visits: number) =>
    registrations > visits
      ? "mais inscrições do que visitas medidas"
      : `${percent(registrations, visits)} se inscreveram`;
  // A tile points at the section it summarizes only when that section exists.
  const anchor = (id: string) => (total > 0 ? id : undefined);
  const beforeEvent = total - results.after_event;
  const groupUnknown = Math.max(0, results.group_clicked - results.group_phone - results.group_computer);

  // Registrations by channel, the biggest first; the long tail is summed so
  // the bars stay comparable (MetricBars reads best up to six parts).
  const channels = results.channels.filter((row) => row.registrations > 0 || row.visits > 0);
  const top = channels.slice(0, TOP_CHANNELS);
  const rest = channels.slice(TOP_CHANNELS);
  const channelItems: MetricBarItem[] = top.map((row) => ({
    key: row.channel,
    label: row.channel,
    value: row.registrations,
    hint: row.visits
      ? `${row.visits} visitas · ${rateOf(row.registrations, row.visits)}`
      : "Visitas não medidas neste canal",
  }));
  if (rest.length) {
    const visits = rest.reduce((sum, row) => sum + row.visits, 0);
    const registrations = rest.reduce((sum, row) => sum + row.registrations, 0);
    channelItems.push({
      key: "outros",
      label: `Outros (${rest.length})`,
      value: registrations,
      tone: "empty",
      hint: visits ? `${visits} visitas · ${rateOf(registrations, visits)}` : undefined,
    });
  }

  return (
    <Box className="flex flex-col gap-5">
      <Box className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          icon={<NiScreen size="large" />}
          tone="primary"
          label="Visitas à página"
          hint="Contadas no servidor, sem robôs, sem rascunho e sem as suas visitas de superadmin"
          value={results.visits}
          href={anchor("#canais")}
        />
        <StatTile
          icon={<NiUsers size="large" />}
          tone="secondary"
          label="Inscrições"
          hint="Todas as inscrições do evento, antes e depois dele"
          value={total}
          href={anchor("#funil")}
        />
        <StatTile
          icon={<NiChartLineBar size="large" />}
          tone="accent-1"
          label="Taxa de inscrição"
          hint="Inscrições ÷ visitas à página. Sem valor enquanto houver mais inscrições do que visitas medidas (as visitas só são contadas a partir desta versão, e nunca as suas)"
          value={rate}
          href={anchor("#canais")}
        />
        <StatTile
          icon={<NiMoney size="large" />}
          tone="accent-2"
          label="Compras do evento"
          hint="Assinaturas novas cujo checkout veio do botão desta página"
          value={results.purchases}
          href={anchor("#vendas")}
        />
      </Box>

      {total === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              illustration={<IllustrationAccounts />}
              title="Ninguém se inscreveu ainda"
              description={
                event.state === "rascunho"
                  ? "O evento está em rascunho: publique em Configuração, mudando o estado para “Inscrições abertas”."
                  : "Divulgue o link da página: toda inscrição aparece aqui e na aba Inscritas."
              }
              action={
                event.state === "rascunho"
                  ? { label: "Abrir a configuração", onClick: onOpenSettings }
                  : { label: "Ver a página do evento", href: eventPath(event.slug) }
              }
            />
          </CardContent>
        </Card>
      ) : (
        <Box className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Card id="funil" component="section" aria-labelledby="funil-title">
            <CardContent className="flex flex-col gap-4">
              <Typography variant="h6" component="h2" id="funil-title" className="mb-0">
                Da inscrição à sala
              </Typography>
              <MetricBars
                total={total}
                items={[
                  {
                    key: "group",
                    label: "Clicaram no grupo de avisos",
                    value: results.group_clicked,
                    tone: "secondary",
                  },
                  {
                    key: "whatsapp",
                    label: "Iniciaram conversa no WhatsApp",
                    value: results.whatsapp_started,
                    tone: "secondary",
                    hint: "Prova de que o número é delas — prioridade no 1:1",
                  },
                  { key: "present", label: "Assistiram ao vivo", value: results.present, tone: "primary" },
                  {
                    key: "watched",
                    label: "Assistiram 20 minutos ou mais",
                    value: results.watched_20,
                    tone: "primary",
                    hint: "O público mais quente — vira anúncio só com o termo de novidades",
                  },
                  {
                    key: "after",
                    label: "Inscreveram-se depois do evento",
                    value: results.after_event,
                    tone: "attention",
                    hint: `Pela captura da gravação · ${beforeEvent} antes do evento`,
                  },
                ]}
              />
            </CardContent>
          </Card>

          <Card component="section" aria-labelledby="aparelho-title">
            <CardContent className="flex flex-col gap-4">
              <Box className="flex flex-row items-center gap-1">
                <Typography variant="h6" component="h2" id="aparelho-title" className="mb-0">
                  Clique no grupo, por aparelho
                </Typography>
                <InfoHint label="No computador, sem o WhatsApp instalado, o clique mede o aparelho e não o botão. Julgue a tela de confirmação pelo celular." />
              </Box>
              {results.group_clicked > 0 ? (
                <MetricBars
                  total={results.group_clicked}
                  items={[
                    { key: "phone", label: "Celular", value: results.group_phone, tone: "primary" },
                    { key: "computer", label: "Computador", value: results.group_computer, tone: "secondary" },
                    ...(groupUnknown
                      ? [
                          {
                            key: "unknown",
                            label: "Antes da medição por aparelho",
                            value: groupUnknown,
                            tone: "empty" as const,
                          },
                        ]
                      : []),
                  ]}
                />
              ) : (
                <Typography variant="body2" color="text.secondary">
                  Ninguém clicou no grupo ainda.
                </Typography>
              )}
            </CardContent>
          </Card>

          <Card id="canais" component="section" aria-labelledby="canais-title">
            <CardContent className="flex flex-col gap-4">
              <Box className="flex flex-row items-center gap-1">
                <Typography variant="h6" component="h2" id="canais-title" className="mb-0">
                  Inscrições por canal
                </Typography>
                <InfoHint label="O canal é o parâmetro origem (ou utm_source) do link que trouxe a pessoa. Sem parâmetro, conta como direto." />
              </Box>
              {channelItems.length ? (
                <MetricBars total={total} items={channelItems} />
              ) : (
                <Typography variant="body2" color="text.secondary">
                  Nenhum canal registrado ainda.
                </Typography>
              )}
            </CardContent>
          </Card>

          <Card id="vendas" component="section" aria-labelledby="vendas-title">
            <CardContent className="flex flex-col gap-3">
              <Box className="flex flex-row items-center gap-1">
                <Typography variant="h6" component="h2" id="vendas-title" className="mb-0">
                  Vendas atribuídas
                </Typography>
                <InfoHint label="Conta a primeira fatura paga de uma assinatura cujo checkout começou pelo botão desta página, em até 14 dias. Renovações e compras sem o link do evento não entram." />
              </Box>
              <Typography variant="h4" component="p" className="mb-0 tabular-nums">
                {BRL.format(results.revenue_cents / 100)}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {results.purchases === 1 ? "1 assinatura nova" : `${results.purchases} assinaturas novas`}
              </Typography>
            </CardContent>
          </Card>
        </Box>
      )}
    </Box>
  );
}
