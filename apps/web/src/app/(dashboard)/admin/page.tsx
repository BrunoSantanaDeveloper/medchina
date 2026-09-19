"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Alert, Box, Breadcrumbs, Card, CardContent, Grid, Skeleton, Typography } from "@mui/material";

import NiAI from "@/icons/nexture/ni-ai";
import NiAnnouncement from "@/icons/nexture/ni-announcement";
import NiArchive from "@/icons/nexture/ni-archive";
import NiBook from "@/icons/nexture/ni-book";
import NiBuilding from "@/icons/nexture/ni-building";
import NiChartLineBar from "@/icons/nexture/ni-chart-line-bar";
import NiCoin from "@/icons/nexture/ni-coin";
import NiMoney from "@/icons/nexture/ni-money";
import NiPen from "@/icons/nexture/ni-pen";
import NiQuestionHexagon from "@/icons/nexture/ni-question-hexagon";
import NiReceipt from "@/icons/nexture/ni-receipt";
import NiShieldCheck from "@/icons/nexture/ni-shield-check";
import NiUsers from "@/icons/nexture/ni-users";
import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";

type AdminMetrics = {
  orgs: number;
  users: number;
  new_orgs_30d: number;
  new_users_30d: number;
  subscriptions: Record<string, number>;
  suspended: number;
  mrr: { currency: string; amount_cents: number }[];
  credits_consumed_30d: number;
};

const formatMoney = (amountCents: number, currency: string) =>
  new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amountCents / 100);

function StatCard({
  icon,
  label,
  value,
  hint,
  loading,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  loading: boolean;
}) {
  return (
    <Card component="section" className="h-full">
      <CardContent className="flex flex-row items-start gap-4">
        <span className="bg-primary/10 text-primary flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl [&_svg]:h-6 [&_svg]:w-6">
          {icon}
        </span>
        <Box className="flex min-w-0 flex-col">
          <Typography variant="body2" className="text-text-secondary">
            {label}
          </Typography>
          {loading ? (
            <Skeleton variant="text" className="text-2xl" width={96} />
          ) : (
            <Typography variant="h4" component="p" className="truncate">
              {value}
            </Typography>
          )}
          {loading ? (
            <Skeleton variant="text" width={128} />
          ) : (
            hint && (
              <Typography variant="body2" className="text-text-secondary">
                {hint}
              </Typography>
            )
          )}
        </Box>
      </CardContent>
    </Card>
  );
}

const consoles = [
  {
    href: "/admin/organizations",
    icon: <NiBuilding size="medium" />,
    title: "Contas e profissionais",
    description: "Todas as contas da plataforma: quadro de profissionais, planos, suspensão e banimentos.",
  },
  {
    href: "/admin/billing",
    icon: <NiMoney size="medium" />,
    title: "Faturamento",
    description: "Planos, módulos, cupons e todas as assinaturas da plataforma.",
  },
  {
    href: "/admin/ai",
    icon: <NiAI size="medium" />,
    title: "Assistentes de IA",
    description: "Assistentes guiados por instruções oferecidos dentro do produto.",
  },
  {
    href: "/admin/knowledge",
    icon: <NiBook size="medium" />,
    title: "Conhecimento",
    description: "Coleções globais de conhecimento que alimentam as respostas dos assistentes.",
  },
  {
    href: "/admin/audit",
    icon: <NiShieldCheck size="medium" />,
    title: "Auditoria e logs",
    description: "Trilha de auditoria somente-acréscimo, log de acessos e o log de mensagens do WhatsApp.",
  },
  {
    href: "/admin/insights",
    icon: <NiChartLineBar size="medium" />,
    title: "Insights de dados",
    description: "Pergunte ao banco em linguagem natural — a IA responde com uma consulta somente leitura.",
  },
  {
    href: "/admin/backups",
    icon: <NiArchive size="medium" />,
    title: "Backups",
    description: "Backups automáticos do banco toda noite e exportações sob demanda para baixar.",
  },
  {
    href: "/admin/announcements",
    icon: <NiAnnouncement size="medium" />,
    title: "Anúncios",
    description: "Avisos gerais que toda a plataforma vê até dispensar.",
  },
  {
    href: "/admin/help",
    icon: <NiQuestionHexagon size="medium" />,
    title: "Central de ajuda",
    description: "Artigos públicos de ajuda publicados em /help, por idioma.",
  },
  {
    href: "/admin/blog",
    icon: <NiPen size="medium" />,
    title: "Blog",
    description: "Posts publicados em /blog e a fila de moderação de comentários.",
  },
];

/**
 * Superadmin overview: the real platform numbers (via the admin_metrics
 * RPC) and the door to every console. RLS + the /admin layout gate keep
 * non-superadmins out; the client check only improves UX.
 */
export default function AdminOverview() {
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }
    const load = async () => {
      const supabase = createClient();
      const { data, error: rpcError } = await supabase.rpc("admin_metrics");
      if (rpcError) {
        setError(true);
      } else {
        setMetrics(data as AdminMetrics);
      }
      setLoading(false);
    };
    load();
  }, []);

  const live = (metrics?.subscriptions?.active ?? 0) + (metrics?.subscriptions?.trialing ?? 0);
  const pastDue = metrics?.subscriptions?.past_due ?? 0;
  const suspended = metrics?.suspended ?? 0;
  const mrrLabel = metrics
    ? metrics.mrr.length > 0
      ? metrics.mrr.map((entry) => formatMoney(entry.amount_cents, entry.currency)).join(" + ")
      : formatMoney(0, "BRL")
    : "";

  return (
    <Grid container spacing={5}>
      <Grid size={12}>
        <Typography variant="h1" component="h1" className="mb-0">
          Administração da plataforma
        </Typography>
        <Breadcrumbs>
          <Link color="inherit" href="/inicio">
            Início
          </Link>
          <Typography variant="body2">Admin</Typography>
        </Breadcrumbs>
      </Grid>

      {!isSupabaseConfigured && (
        <Grid size={12}>
          <Alert severity="info" className="neutral bg-background-paper/60!">
            Supabase não está configurado. Defina NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY para ativar
            os consoles de administração.
          </Alert>
        </Grid>
      )}

      {error && (
        <Grid size={12}>
          <Alert severity="error" className="neutral bg-background-paper/60!">
            Não foi possível carregar as métricas da plataforma. Confira se a migração 0010_admin.sql foi aplicada e se
            você é superadmin.
          </Alert>
        </Grid>
      )}

      {isSupabaseConfigured && !error && (
        <>
          {(pastDue > 0 || suspended > 0) && !loading && (
            <Grid size={12}>
              <Alert severity="warning" className="neutral bg-background-paper/60!">
                Precisa de atenção:{" "}
                {pastDue > 0 && `${pastDue} assinatura${pastDue > 1 ? "s" : ""} inadimplente${pastDue > 1 ? "s" : ""}`}
                {pastDue > 0 && suspended > 0 && ", "}
                {suspended > 0 &&
                  `${suspended} conta${suspended > 1 ? "s" : ""} suspensa${suspended > 1 ? "s" : ""} pelo admin`}
                . Reveja no console de Faturamento.
              </Alert>
            </Grid>
          )}

          <Grid size={{ xs: 12, sm: 6, lg: 4 }}>
            <StatCard
              icon={<NiMoney size="medium" />}
              label="Receita recorrente mensal"
              value={mrrLabel}
              hint="Planos pagos recorrentes ativos, normalizados por mês"
              loading={loading}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, lg: 4 }}>
            <StatCard
              icon={<NiReceipt size="medium" />}
              label="Assinaturas ativas"
              value={String(live)}
              hint={`${metrics?.subscriptions?.trialing ?? 0} em trial, ${pastDue} inadimplentes`}
              loading={loading}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, lg: 4 }}>
            <StatCard
              icon={<NiCoin size="medium" />}
              label="Créditos consumidos (30 d)"
              value={String(metrics?.credits_consumed_30d ?? 0)}
              hint="Em todos os consultórios"
              loading={loading}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, lg: 4 }}>
            <StatCard
              icon={<NiBuilding size="medium" />}
              label="Consultórios"
              value={String(metrics?.orgs ?? 0)}
              hint={`${metrics?.new_orgs_30d ?? 0} novos nos últimos 30 dias`}
              loading={loading}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, lg: 4 }}>
            <StatCard
              icon={<NiUsers size="medium" />}
              label="Profissionais"
              value={String(metrics?.users ?? 0)}
              hint={`${metrics?.new_users_30d ?? 0} novas nos últimos 30 dias`}
              loading={loading}
            />
          </Grid>
        </>
      )}

      <Grid size={12}>
        <Typography variant="h5" component="h2" className="mb-0">
          Consoles
        </Typography>
      </Grid>
      {consoles.map((entry) => (
        <Grid key={entry.href} size={{ xs: 12, sm: 6, lg: 4 }}>
          <Card component="section" className="h-full transition-shadow hover:shadow-md">
            <Link href={entry.href} className="block h-full">
              <CardContent className="flex flex-row items-start gap-4">
                <span className="bg-primary/10 text-primary flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl [&_svg]:h-6 [&_svg]:w-6">
                  {entry.icon}
                </span>
                <Box className="flex flex-col">
                  <Typography variant="h6" component="h3">
                    {entry.title}
                  </Typography>
                  <Typography variant="body2" className="text-text-secondary">
                    {entry.description}
                  </Typography>
                </Box>
              </CardContent>
            </Link>
          </Card>
        </Grid>
      ))}
    </Grid>
  );
}
