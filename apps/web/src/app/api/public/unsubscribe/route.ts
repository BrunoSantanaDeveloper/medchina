import { NextResponse } from "next/server";

import { createServiceClient } from "@flyee/auth/service";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * One-click unsubscribe from the trial lifecycle emails. Public + token-based
 * (the token is the profile's `email_unsubscribe_token`): a click from an email
 * link, no login. Uses the service role because the visitor is unauthenticated.
 * Always answers with the same confirmation so a token cannot be probed.
 */
function page(message: string): NextResponse {
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>MedChina</title></head><body style="margin:0;font-family:Arial,Helvetica,sans-serif;background:#f6f4ef;color:#2c3633"><div style="max-width:440px;margin:64px auto;background:#fff;border-radius:16px;padding:32px"><p style="color:#177c81;font-weight:700;margin:0 0 12px">MedChina</p><p style="font-size:15px;line-height:23px;margin:0">${message}</p></div></body></html>`;
  return new NextResponse(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
}

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  if (token && UUID.test(token)) {
    try {
      const service = createServiceClient();
      await service.from("profiles").update({ lifecycle_email_opt_out: true }).eq("email_unsubscribe_token", token);
    } catch {
      // Fall through to the same confirmation — never reveal whether it matched.
    }
  }
  return page(
    "Pronto — você não receberá mais os e-mails sobre o seu teste. Suas notificações essenciais da conta continuam normalmente.",
  );
}
