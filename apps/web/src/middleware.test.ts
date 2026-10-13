import { middleware } from "./middleware";
import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { updateSession } from "@flyee/auth/middleware";

vi.mock("@flyee/auth/middleware", () => ({ updateSession: vi.fn() }));

const ORIGIN = "http://localhost:3000";

type Session = {
  user: { id: string; email?: string; app_metadata?: Record<string, unknown> } | null;
  needsMfa?: boolean;
  impersonating?: boolean;
};

function session({ user, needsMfa = false, impersonating = false }: Session) {
  vi.mocked(updateSession).mockResolvedValue({ response: NextResponse.next(), user, needsMfa, impersonating });
}

const run = (path: string, init?: { method?: string; cookie?: string }) =>
  middleware(
    new NextRequest(`${ORIGIN}${path}`, {
      method: init?.method ?? "GET",
      headers: init?.cookie ? { cookie: init.cookie } : undefined,
    }),
  );

/** Where a redirect points, without the origin. */
const target = (response: Response) => {
  const location = response.headers.get("location");
  if (!location) return null;
  const url = new URL(location);
  return `${url.pathname}${url.search}`;
};

const PENDING = { id: "u1", email: "ela@example.com", app_metadata: { whatsapp_pending: true } };
const CONFIRMED = { id: "u2", email: "ela@example.com", app_metadata: { provider: "email" } };

/**
 * The hold on an account that still owes its WhatsApp confirmation (migration
 * 0122). Such an account came from a campaign: it was created without a
 * confirmation so that nothing would stand between the ad and the payment —
 * so the checkout has to stay open to it, and everything else has to wait.
 */
describe("middleware — an account that owes its WhatsApp confirmation", () => {
  beforeEach(() => {
    vi.mocked(updateSession).mockReset();
  });

  it("lets it through the checkout, both doors of it", async () => {
    session({ user: PENDING });
    expect(target(await run("/assinatura?plan=pro-campanha"))).toBeNull();
    expect(target(await run("/settings/billing?plan=pro-campanha"))).toBeNull();
  });

  it("lets the checkout's own server actions through (they post to the page)", async () => {
    session({ user: PENDING });
    expect(target(await run("/assinatura?plan=pro-campanha", { method: "POST" }))).toBeNull();
  });

  it("holds it at the confirmation the moment it leaves the checkout — which is where a payment sends it", async () => {
    session({ user: PENDING });
    expect(target(await run("/onboarding?pagamento=confirmado"))).toBe(
      `/auth/whatsapp?next=${encodeURIComponent("/onboarding?pagamento=confirmado")}`,
    );
    expect(target(await run("/inicio"))).toBe(`/auth/whatsapp?next=${encodeURIComponent("/inicio")}`);
    expect(target(await run("/pacientes/novo"))).toBe(`/auth/whatsapp?next=${encodeURIComponent("/pacientes/novo")}`);
  });

  it("does not loop: the confirmation screen and the rest of /auth stay open", async () => {
    session({ user: PENDING });
    expect(target(await run("/auth/whatsapp?next=%2Finicio"))).toBeNull();
    expect(target(await run("/auth/password-reset"))).toBeNull();
  });

  it("refuses API routes instead of redirecting them — no trial, no recording behind the screen", async () => {
    session({ user: PENDING });
    for (const path of ["/api/billing/start-trial", "/api/recordings", "/api/ai/chat"]) {
      const response = await run(path, { method: "POST" });
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: "whatsapp_confirmation_required" });
    }
  });

  it("leaves the routes that answer without a session alone", async () => {
    session({ user: PENDING });
    expect((await run("/api/webhooks/whatsapp/meta", { method: "POST" })).status).toBe(200);
    expect(target(await run("/planos"))).toBeNull();
    expect(target(await run("/"))).toBeNull();
  });

  it("never holds a support session: the operator has to see the account she was asked about", async () => {
    session({ user: PENDING, impersonating: true });
    const marker = `mc-impersonating=session-1.${Date.now() + 60_000}`;
    expect(target(await run("/inicio", { cookie: marker }))).toBeNull();
  });

  it("asks for the second factor first, when the account has one", async () => {
    session({ user: PENDING, needsMfa: true });
    expect(target(await run("/inicio"))).toBe(`/auth/two-factor?next=${encodeURIComponent("/inicio")}`);
  });

  it("holds nobody else", async () => {
    session({ user: CONFIRMED });
    expect(target(await run("/inicio"))).toBeNull();
    expect((await run("/api/billing/start-trial", { method: "POST" })).status).toBe(200);

    // An account older than the migration carries no flag at all.
    session({ user: { id: "u3" } });
    expect(target(await run("/inicio"))).toBeNull();

    // A flag only counts when the database wrote `true`.
    session({ user: { id: "u4", app_metadata: { whatsapp_pending: "true" } } });
    expect(target(await run("/inicio"))).toBeNull();
  });

  it("still sends a visitor with no session to sign-in, not to the confirmation", async () => {
    session({ user: null });
    expect(target(await run("/inicio"))).toBe(`/auth/sign-in?next=${encodeURIComponent("/inicio")}`);
  });
});
