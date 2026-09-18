import { summarizeWatch, watchAccounts } from "./admin-jobs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SupabaseClient } from "@supabase/supabase-js";

// The job is server-only and wired to Inngest, Resend and the service role.
// None of that is what the test is about: the logic worth pinning is WHICH
// accounts become a digest, and that the same digest never goes out twice.
const { notifyUsers, sendDigest } = vi.hoisted(() => ({ notifyUsers: vi.fn(), sendDigest: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@flyee/jobs", () => ({ inngest: { createFunction: () => ({ id: "admin-account-watch" }) } }));
vi.mock("@flyee/auth/service", () => ({ createServiceClient: () => ({}) }));
vi.mock("@/lib/notifications", () => ({ notifyUsers }));
vi.mock("@flyee/email", () => ({ sendAdminAccountsDigestEmail: sendDigest }));

type Account = Record<string, unknown>;

const account = (flags: string[], extra: Account = {}): Account => ({
  orgId: `org-${flags.join("-")}`,
  name: "Consultório",
  owner: { name: "Dra. Marina", email: "marina@medchina.invalid" },
  billing: { planName: "Gratuito", pastDueSince: null },
  trial: null,
  minutes: { remaining: 0 },
  flags,
  ...extra,
});

const supabaseWith = (accounts: Account[], operators: { id: string }[] = [{ id: "op-1" }]) =>
  ({
    rpc: vi.fn(async () => ({ data: { accounts }, error: null })),
    from: vi.fn(() => ({ select: () => ({ eq: async () => ({ data: operators, error: null }) }) })),
    auth: { admin: { getUserById: vi.fn(async () => ({ data: { user: { email: "operator@medchina.dev" } } })) } },
  }) as unknown as SupabaseClient;

beforeEach(() => {
  notifyUsers.mockResolvedValue({ sent: true, created: 1, createdFor: ["op-1"] });
  sendDigest.mockResolvedValue({ sent: true });
});

describe("the daily operator watch", () => {
  it("stays silent when nothing needs a decision", async () => {
    // An alert that arrives every morning stops being read, so a quiet day
    // produces no notification and no e-mail at all.
    const outcome = await watchAccounts(supabaseWith([account(["paid"]), account(["idle", "never_activated"])]));

    expect(outcome).toMatchObject({ notified: 0, reason: "nothing-to-report" });
    expect(notifyUsers).not.toHaveBeenCalled();
    expect(sendDigest).not.toHaveBeenCalled();
  });

  it("reports a trial about to end, with the days and minutes left", async () => {
    const outcome = await watchAccounts(
      supabaseWith([
        account(["trial_active", "trial_ending"], {
          trial: { endsAt: new Date(Date.now() + 2 * 86_400_000).toISOString(), daysLeft: 2 },
          minutes: { remaining: 230 },
        }),
      ]),
    );

    expect(outcome).toMatchObject({ notified: 1, accounts: 1, emailed: 1 });
    const [ids, input] = notifyUsers.mock.calls[0];
    expect(ids).toEqual(["op-1"]);
    expect(input.title).toBe("1 trial terminando hoje");
    // The alert lands on the accounts it is about, not on the whole book.
    expect(input.href).toBe("/admin/organizations?filter=trial_ending");
    expect(input.body).toContain("230 min restantes");
    expect(sendDigest).toHaveBeenCalledWith(
      "operator@medchina.dev",
      expect.objectContaining({ headline: input.title }),
    );
  });

  it("names both problems when the morning has two kinds", async () => {
    await watchAccounts(
      supabaseWith([
        account(["trial_ending"], {
          trial: { endsAt: new Date().toISOString(), daysLeft: 1 },
          minutes: { remaining: 10 },
        }),
        account(["past_due"], { billing: { planName: "Pro", pastDueSince: "2026-09-10T00:00:00Z" } }),
      ]),
    );

    expect(notifyUsers.mock.calls[0][1].title).toBe("1 trial terminando e 1 conta inadimplente hoje");
  });

  it("forgets a trial that ended weeks ago", async () => {
    // `trial_over` stays true until she converts; reporting it every morning
    // would turn the digest into wallpaper.
    const outcome = await watchAccounts(
      supabaseWith([
        account(["trial_over"], {
          trial: { endsAt: new Date(Date.now() - 20 * 86_400_000).toISOString(), daysLeft: 0 },
        }),
      ]),
    );

    expect(outcome.reason).toBe("nothing-to-report");
  });

  it("still reports a trial that ended this morning", async () => {
    const outcome = await watchAccounts(
      supabaseWith([
        account(["trial_over"], {
          trial: { endsAt: new Date(Date.now() - 3 * 3_600_000).toISOString(), daysLeft: 0 },
        }),
      ]),
    );

    expect(outcome).toMatchObject({ accounts: 1, notified: 1 });
    expect(notifyUsers.mock.calls[0][1].href).toBe("/admin/organizations?filter=trial_over");
  });

  it("does not e-mail an operator who already has today's digest", async () => {
    // The bell's source_key is the fence for the whole digest: a second run
    // (a retry, a re-deploy of the cron) writes nothing and sends nothing.
    notifyUsers.mockResolvedValue({ sent: true, created: 0, createdFor: [] });

    const outcome = await watchAccounts(
      supabaseWith([account(["past_due"], { billing: { planName: "Pro", pastDueSince: null } })]),
    );

    expect(outcome).toMatchObject({ notified: 0, emailed: 0 });
    expect(sendDigest).not.toHaveBeenCalled();
  });

  it("reports the failure instead of pretending it warned somebody", async () => {
    const broken = {
      rpc: vi.fn(async () => ({ data: null, error: { message: "not_authorized" } })),
    } as unknown as SupabaseClient;

    expect(await watchAccounts(broken)).toMatchObject({ notified: 0, error: "not_authorized" });
  });
});

describe("the digest headline", () => {
  it("counts in Portuguese, because the bell is the professional-facing surface", () => {
    expect(summarizeWatch(1, 0, 0)).toBe("1 trial terminando hoje");
    expect(summarizeWatch(3, 0, 0)).toBe("3 trials terminando hoje");
    expect(summarizeWatch(2, 1, 0)).toBe("2 trials terminando e 1 conta inadimplente hoje");
    expect(summarizeWatch(1, 2, 1)).toBe("1 trial terminando, 2 contas inadimplentes e 1 trial encerrado hoje");
    expect(summarizeWatch(0, 0, 0)).toBe("Nenhuma conta pede atenção hoje");
  });
});
