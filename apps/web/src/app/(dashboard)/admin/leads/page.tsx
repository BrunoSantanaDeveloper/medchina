"use client";

import PeopleAdmin from "./components/people-admin";
import Link from "next/link";

import { Breadcrumbs, Card, CardContent, Grid, Typography } from "@mui/material";

/**
 * Leads (docs/PAGINA-EVENTO.md §7; FUNIL T2.0/T6.4) — the platform's contacts
 * WITHOUT an account, one row per person across every event. The events
 * themselves, with their pages and results, are in /admin/eventos.
 *
 * The admin layout gates the route on the server; RLS is the real fence (every
 * table in migrations 0112/0113 is superadmin-only).
 */
export default function AdminLeads() {
  return (
    <Grid container spacing={5}>
      <Grid size={12}>
        <Typography variant="h1" component="h1" className="mb-0">
          Leads
        </Typography>
        <Breadcrumbs>
          <Link color="inherit" href="/inicio">
            Início
          </Link>
          <Typography variant="body2">Admin</Typography>
          <Typography variant="body2">Leads</Typography>
        </Breadcrumbs>
      </Grid>
      <Grid size={12}>
        <Card component="section">
          <CardContent>
            <PeopleAdmin />
          </CardContent>
        </Card>
      </Grid>
    </Grid>
  );
}
