"use client";

import CampaignOfferAdmin from "./components/campaign-offer-admin";
import ConversionOffersAdmin from "./components/conversion-offers-admin";
import CouponsAdmin from "./components/coupons-admin";
import FoundersAdmin from "./components/founders-admin";
import ModulesAdmin from "./components/modules-admin";
import PlansAdmin from "./components/plans-admin";
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
          Billing Administration
        </Typography>
        <Breadcrumbs>
          <Link color="inherit" href="/inicio">
            Home
          </Link>
          <Typography variant="body2">Admin</Typography>
          <Typography variant="body2">Billing</Typography>
        </Breadcrumbs>
      </Grid>

      {allowed === false && (
        <Grid size={12}>
          <Alert severity="error" className="neutral bg-background-paper/60!">
            This area is restricted to platform superadmins.
          </Alert>
        </Grid>
      )}

      {allowed && (
        <Grid size={12}>
          <Card component="section">
            <CardContent>
              <Tabs value={tab} onChange={(_, value) => setTab(value)} className="mb-6">
                <Tab label="Plans" />
                <Tab label="Modules" />
                <Tab label="Coupons" />
                <Tab label="Subscriptions" />
                <Tab label="Offers" />
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
                    <Box className="flex flex-col gap-3">
                      <Box>
                        <Typography variant="subtitle1">Campaign offer · /assinar</Typography>
                        <Typography variant="body2" className="text-text-secondary">
                          What paid traffic is offered. The deadline here is the one the checkout enforces.
                        </Typography>
                      </Box>
                      <CampaignOfferAdmin />
                    </Box>
                    <Box className="flex flex-col gap-3">
                      <Box>
                        <Typography variant="subtitle1">Founders offer · /fundadores</Typography>
                        <Typography variant="body2" className="text-text-secondary">
                          The warm-audience condition, limited by seats and sold on calls.
                        </Typography>
                      </Box>
                      <FoundersAdmin />
                    </Box>
                    <Box className="flex flex-col gap-3">
                      <Box>
                        <Typography variant="subtitle1">Trial conversion offers</Typography>
                        <Typography variant="body2" className="text-text-secondary">
                          Offered inside the product at the two moments of highest intent, once per workspace.
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
