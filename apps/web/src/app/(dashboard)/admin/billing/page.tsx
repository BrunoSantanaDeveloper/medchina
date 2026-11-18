"use client";

import CampaignOfferAdmin from "./components/campaign-offer-admin";
import ConversionOffersAdmin from "./components/conversion-offers-admin";
import CouponsAdmin from "./components/coupons-admin";
import FoundersAdmin from "./components/founders-admin";
import GuaranteeAdmin from "./components/guarantee-admin";
import ModulesAdmin from "./components/modules-admin";
import PlansAdmin from "./components/plans-admin";
import PromotionAdmin from "./components/promotion-admin";
import SubscriptionsAdmin from "./components/subscriptions-admin";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Alert, Box, Breadcrumbs, Card, CardContent, Grid, Tab, Tabs, Typography } from "@mui/material";

import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";

/**
 * Superadmin billing console. RLS is the real gate (non-superadmins get
 * empty reads and rejected writes); the client-side check only improves UX.
 */
export default function AdminBilling() {
  const [tab, setTab] = useState(0);
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    const check = async () => {
      if (!isSupabaseConfigured) {
        setAllowed(false);
        return;
      }
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setAllowed(false);
        return;
      }
      const { data } = await supabase.from("profiles").select("is_superadmin").eq("id", user.id).maybeSingle();
      setAllowed(Boolean(data?.is_superadmin));
    };
    check();
  }, []);

  return (
    <Grid container spacing={5}>
      <Grid size={12}>
        <Typography variant="h1" component="h1" className="mb-0">
          Administração de faturamento
        </Typography>
        <Breadcrumbs>
          <Link color="inherit" href="/inicio">
            Início
          </Link>
          <Typography variant="body2">Admin</Typography>
          <Typography variant="body2">Faturamento</Typography>
        </Breadcrumbs>
      </Grid>

      {allowed === false && (
        <Grid size={12}>
          <Alert severity="error" className="neutral bg-background-paper/60!">
            Esta área é restrita aos superadmins da plataforma.
          </Alert>
        </Grid>
      )}

      {allowed && (
        <Grid size={12}>
          <Card component="section">
            <CardContent>
              <Tabs value={tab} onChange={(_, value) => setTab(value)} className="mb-6">
                <Tab label="Planos" />
                <Tab label="Módulos" />
                <Tab label="Cupons" />
                <Tab label="Assinaturas" />
                <Tab label="Ofertas" />
              </Tabs>
              <Box hidden={tab !== 0}>{tab === 0 && <PlansAdmin />}</Box>
              <Box hidden={tab !== 1}>{tab === 1 && <ModulesAdmin />}</Box>
              <Box hidden={tab !== 2}>{tab === 2 && <CouponsAdmin />}</Box>
              <Box hidden={tab !== 3}>{tab === 3 && <SubscriptionsAdmin />}</Box>
              {/* Every offer in ONE tab. They were two, and a third one for the
                  paid campaign would have made three places to look for "what
                  are we selling right now" — with the same plan slug typed into
                  each. Same order as the funnel: cold campaign, warm condition,
                  in-product offer to someone already trialling. */}
              <Box hidden={tab !== 4}>
                {tab === 4 && (
                  <Box className="flex flex-col gap-8">
                    {/* First because it is the only term the three offers
                        SHARE. Each block below answers "what are we selling";
                        this one answers "under what promise", and reading it
                        after the prices would be reading it after the decision
                        it qualifies. */}
                    <Box className="flex flex-col gap-3">
                      <Box>
                        <Typography variant="subtitle1">Garantia · vale para todas as ofertas</Typography>
                        <Typography variant="body2" className="text-text-secondary">
                          Um número só, lido pelas páginas de oferta, pela tela de pagamento e pelos termos.
                        </Typography>
                      </Box>
                      <GuaranteeAdmin />
                    </Box>
                    <Box className="flex flex-col gap-3">
                      <Box>
                        <Typography variant="subtitle1">Oferta de campanha · /assinar</Typography>
                        <Typography variant="body2" className="text-text-secondary">
                          O que o tráfego pago recebe. O prazo daqui é o que o checkout aplica.
                        </Typography>
                      </Box>
                      <CampaignOfferAdmin />
                    </Box>
                    <Box className="flex flex-col gap-3">
                      <Box>
                        <Typography variant="subtitle1">Promoção com data · /black-friday</Typography>
                        <Typography variant="body2" className="text-text-secondary">
                          Abre e fecha sozinha nas datas daqui; enquanto aberta, a home mostra a faixa e o cartão dela.
                        </Typography>
                      </Box>
                      <PromotionAdmin />
                    </Box>
                    <Box className="flex flex-col gap-3">
                      <Box>
                        <Typography variant="subtitle1">Oferta fundadores · /fundadores</Typography>
                        <Typography variant="body2" className="text-text-secondary">
                          A condição do público aquecido, limitada por vagas e vendida em call.
                        </Typography>
                      </Box>
                      <FoundersAdmin />
                    </Box>
                    <Box className="flex flex-col gap-3">
                      <Box>
                        <Typography variant="subtitle1">Ofertas de conversão do trial</Typography>
                        <Typography variant="body2" className="text-text-secondary">
                          Oferecidas dentro do produto nos dois momentos de maior intenção, uma vez por consultório.
                        </Typography>
                      </Box>
                      <ConversionOffersAdmin />
                    </Box>
                  </Box>
                )}
              </Box>
            </CardContent>
          </Card>
        </Grid>
      )}
    </Grid>
  );
}
