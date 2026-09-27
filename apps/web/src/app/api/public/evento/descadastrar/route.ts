import { NextResponse } from "next/server";

import { liveEventService } from "@/lib/live-event";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * One-click unsubscribe from the live-event e-mails (docs/PAGINA-EVENTO.md §8).
 *
 * The token is the lead's own `email_unsubscribe_token` (migration 0112) — a
 * lead is not a profile, so the trial drip's route (/api/public/unsubscribe,
 * keyed on profiles) cannot serve it. GET is the footer link; POST is the mail
 * client's own button (`List-Unsubscribe-Post: List-Unsubscribe=One-Click`).
 *
 * Always answers with the same page, matched or not, so a token cannot be
 * probed. Stops the e-mails only: leaving the WhatsApp group, or everything,
 * is "responda SAIR" (the team marks it in /admin/leads).
 */
async function unsubscribe(token: string | null) {
  if (token && UUID.test(token)) {
    const service = liveEventService();
    if (service) {
      await service
        .from("leads")
        .update({ email_opt_out_at: new Date().toISOString() })
        .eq("email_unsubscribe_token", token)
        .is("email_opt_out_at", null);
    }
  }
}

function page(): NextResponse {
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>MedChina</title></head><body style="margin:0;font-family:Arial,Helvetica,sans-serif;background:#f6f4ef;color:#2c3633"><div style="max-width:440px;margin:64px auto;background:#fff;border-radius:16px;padding:32px"><p style="color:#177c81;font-weight:700;margin:0 0 12px">MedChina</p><p style="font-size:15px;line-height:23px;margin:0 0 12px">Pronto — você não receberá mais e-mails sobre os nossos eventos.</p><p style="font-size:14px;line-height:21px;margin:0;color:#4d574f">Para sair também do grupo de avisos no WhatsApp, responda SAIR por lá.</p></div></body></html>`;
  return new NextResponse(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function GET(request: Request) {
  await unsubscribe(new URL(request.url).searchParams.get("t"));
  return page();
}

export async function POST(request: Request) {
  await unsubscribe(new URL(request.url).searchParams.get("t"));
  return page();
}
