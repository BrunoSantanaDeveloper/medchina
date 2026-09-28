"use client";

import EventsList from "./components/events-list";
import Link from "next/link";

import { Breadcrumbs, Grid, Typography } from "@mui/material";

/**
 * Live events (docs/PAGINA-EVENTO.md; migration 0113): every event with its
 * own page, registrations and results. The admin layout gates the route on the
 * server and RLS is the real fence (every table read here is superadmin-only).
 */
export default function AdminEvents() {
  return (
    <Grid container spacing={5}>
      <Grid size={12}>
        <Typography variant="h1" component="h1" className="mb-0">
          Eventos ao vivo
        </Typography>
        <Breadcrumbs>
          <Link color="inherit" href="/inicio">
            Início
          </Link>
          <Typography variant="body2">Admin</Typography>
          <Typography variant="body2">Eventos ao vivo</Typography>
        </Breadcrumbs>
      </Grid>
      <Grid size={12}>
        <EventsList />
      </Grid>
    </Grid>
  );
}
