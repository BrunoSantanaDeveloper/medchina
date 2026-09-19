"use server";

import { recordAudit } from "@/lib/audit";
import { createClient } from "@flyee/auth/server";
import { createServiceClient } from "@flyee/auth/service";
import { type BillingProviderName, getProvider } from "@flyee/billing";

export type UserAdminInfo = {
  id: string;
  email: string | null;
  lastSignInAt: string | null;
  bannedUntil: string | null;
  /** True when the user has at least one verified TOTP factor. */
  hasMfa: boolean;
};

export type AdminActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: "forbidden" | "not-configured" | string };

/**
 * Server-side superadmin guard for actions that must escalate to the
 * service role (auth admin API). Everything RLS can authorize goes through
 * the normal client instead — this file is only for the escalated paths.
 */
async function isCallerSuperadmin(): Promise<{ userId: string | null; allowed: boolean }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { userId: null, allowed: false };
  const { data } = await supabase.from("profiles").select("is_superadmin").eq("id", user.id).maybeSingle();
  return { userId: user.id, allowed: Boolean(data?.is_superadmin) };
}

const isServiceConfigured = () =>
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

/**
 * Auth-side info (email, last sign-in, ban state) for the users console.
 * Degrades gracefully: without the service key the console still lists
 * profiles, just without these fields.
 */
export async function listUserAdminInfo(): Promise<AdminActionResult<UserAdminInfo[]>> {
  const { allowed } = await isCallerSuperadmin();
  if (!allowed) return { ok: false, error: "forbidden" };
  if (!isServiceConfigured()) return { ok: false, error: "not-configured" };

  const service = createServiceClient();
  const users: UserAdminInfo[] = [];
  let page = 1;
  // Template-scale cap (1000 users); raise it in a derived project if needed.
  while (page <= 5) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: 200 });
    if (error) return { ok: false, error: error.message };
    users.push(
      ...data.users.map((user) => ({
        id: user.id,
        email: user.email ?? null,
        lastSignInAt: user.last_sign_in_at ?? null,
        bannedUntil: (user as { banned_until?: string }).banned_until ?? null,
        hasMfa: (user.factors ?? []).some((factor) => factor.status === "verified"),
      })),
    );
    if (data.users.length < 200) break;
    page += 1;
  }
  return { ok: true, data: users };
}

/** Ban or unban a user platform-wide (Supabase auth ban). */
export async function setUserBanned(userId: string, banned: boolean): Promise<AdminActionResult<null>> {
  const { userId: callerId, allowed } = await isCallerSuperadmin();
  if (!allowed) return { ok: false, error: "forbidden" };
  if (!isServiceConfigured()) return { ok: false, error: "not-configured" };
  if (userId === callerId) return { ok: false, error: "Você não pode banir a sua própria conta." };

  const service = createServiceClient();
  // Supabase has no permanent ban flag: "876000h" ≈ 100 years; "none" lifts it.
  const { error } = await service.auth.admin.updateUserById(userId, {
    ban_duration: banned ? "876000h" : "none",
  });
  if (error) return { ok: false, error: error.message };
  await recordAudit(await createClient(), banned ? "admin.user.banned" : "admin.user.unbanned", {
    entityType: "user",
    entityId: userId,
  });
  return { ok: true, data: null };
}

/**
 * Remove every MFA factor from a user's account — the recovery path when
 * someone loses their authenticator and is locked out at the 2FA step-up.
 * The user can sign in with password alone afterwards and re-enroll.
 */
export async function resetUserMfa(userId: string): Promise<AdminActionResult<null>> {
  const { allowed } = await isCallerSuperadmin();
  if (!allowed) return { ok: false, error: "forbidden" };
  if (!isServiceConfigured()) return { ok: false, error: "not-configured" };

  const service = createServiceClient();
  const { data, error } = await service.auth.admin.mfa.listFactors({ userId });
  if (error) return { ok: false, error: error.message };
  for (const factor of data?.factors ?? []) {
    const { error: deleteError } = await service.auth.admin.mfa.deleteFactor({ id: factor.id, userId });
    if (deleteError) return { ok: false, error: deleteError.message };
  }
  await recordAudit(await createClient(), "admin.user.mfa_reset", {
    entityType: "user",
    entityId: userId,
    metadata: { factorsRemoved: data?.factors?.length ?? 0 },
  });
  return { ok: true, data: null };
}

// ---------- Account deletion (migration 0099) ----------

type DeletionPreview = {
  blockers: string[];
  providerSubscriptions: {
    id: string;
    provider: BillingProviderName;
    providerSubscriptionId: string;
    status: string;
  }[];
};

export type StoragePurgeResult = {
  removed: number;
  /** -1 when what is left could not be read back. */
  remaining: number;
  error?: string;
};

export type AccountDeletionResult = {
  deletedWorkspaces: string[];
  counts: Record<string, number>;
  canceledSubscriptions: number;
  storage: StoragePurgeResult;
};

const BLOCKER_MESSAGE: Record<string, string> = {
  self: "Você não pode excluir a sua própria conta — peça a outra superadmin.",
  superadmin: "Esta conta tem o papel de superadmin da plataforma. Remova o papel primeiro, depois exclua a conta.",
  shared_workspace:
    "Ela é responsável por um consultório do qual outras pessoas ainda fazem parte. Transfira a responsabilidade ou remova os outros membros primeiro.",
};

/** The database answers in codes; the console answers in reasons. */
function deletionMessage(raw: string): string {
  if (raw.includes("self_delete_forbidden")) return BLOCKER_MESSAGE.self;
  if (raw.includes("target_is_superadmin")) return BLOCKER_MESSAGE.superadmin;
  if (raw.includes("shared_workspace")) return BLOCKER_MESSAGE.shared_workspace;
  if (raw.includes("confirmation_mismatch")) return "O e-mail digitado não corresponde à conta. Nada foi excluído.";
  if (raw.includes("reason_required")) return "Diga por que esta conta está sendo excluída (no mínimo 8 caracteres).";
  if (raw.includes("provider_subscription_live")) {
    return "Uma assinatura ainda está sendo cobrada no provedor de pagamento. Nada foi excluído.";
  }
  if (raw.includes("user_not_found")) return "Esta conta não existe mais. Recarregue a lista.";
  if (raw.includes("workspace_still_exists") || raw.includes("user_still_exists")) {
    return "A conta ainda existe: os arquivos só são removidos depois que a própria conta é excluída.";
  }
  if (raw.includes("not_authorized")) {
    return "Só uma superadmin da plataforma pode excluir contas, e nunca de dentro de uma sessão de suporte.";
  }
  // The deletion is one transaction: a refusal from the database means it
  // rolled back whole. Say so — a raw constraint name leaves the operator
  // wondering what is already gone.
  if (raw.includes("violates foreign key constraint")) {
    return `O banco recusou a exclusão e desfez tudo — nada foi excluído, a conta está intacta. (${raw})`;
  }
  return raw;
}

/** A subscription the provider no longer knows about is already stopped. */
function isGoneAtProvider(error: unknown): boolean {
  const failure = error as { code?: string; statusCode?: number; message?: string } | null;
  return failure?.code === "resource_missing" || failure?.statusCode === 404 || /\(404\)/.test(failure?.message ?? "");
}

const STORAGE_REMOVE_BATCH = 100;
// The listing is capped by PostgREST's max rows, so a large practice is
// emptied in passes; a pass that removes nothing ends the loop.
const STORAGE_MAX_PASSES = 50;

/**
 * Removes the files of an account that no longer exists. The list comes from
 * `admin_orphaned_account_storage`, which refuses any workspace or person that
 * still exists — so this service-role delete can only ever reach leftovers.
 * What remains is counted from the database, not from the API's answer.
 */
async function purgeAccountStorage(orgIds: string[], userId: string): Promise<StoragePurgeResult> {
  const supabase = await createClient();
  const service = createServiceClient();
  const list = () => supabase.rpc("admin_orphaned_account_storage", { target_orgs: orgIds, target_user: userId });

  let removed = 0;
  for (let pass = 0; pass < STORAGE_MAX_PASSES; pass += 1) {
    const { data, error } = await list();
    if (error) return { removed, remaining: -1, error: deletionMessage(error.message) };
    const objects = (data ?? []) as { bucket: string; path: string }[];
    if (objects.length === 0) return { removed, remaining: 0 };

    const byBucket = new Map<string, string[]>();
    for (const object of objects) byBucket.set(object.bucket, [...(byBucket.get(object.bucket) ?? []), object.path]);

    const before = removed;
    for (const [bucket, paths] of byBucket) {
      for (let index = 0; index < paths.length; index += STORAGE_REMOVE_BATCH) {
        const { data: gone } = await service.storage
          .from(bucket)
          .remove(paths.slice(index, index + STORAGE_REMOVE_BATCH));
        removed += gone?.length ?? 0;
      }
    }
    if (removed === before) return { removed, remaining: objects.length };
  }

  const { data: left, error: leftError } = await list();
  if (leftError) return { removed, remaining: -1, error: deletionMessage(leftError.message) };
  return { removed, remaining: (left ?? []).length };
}

/**
 * Permanently deletes a professional's account and everything it holds.
 *
 * Order is the design: (1) re-read the preview — the dialog's may be stale;
 * (2) stop the money at the provider BEFORE anything is deleted, so a failure
 * there leaves the account intact; (3) one database transaction removes the
 * workspaces, their change history and the person (0099); (4) the files go
 * through the Storage API afterwards, because storage refuses SQL deletes —
 * and can be retried, since the listing only ever returns leftovers.
 */
export async function deleteAccount(
  userId: string,
  confirmEmail: string,
  reason: string,
): Promise<AdminActionResult<AccountDeletionResult>> {
  const { userId: callerId, allowed } = await isCallerSuperadmin();
  if (!allowed) return { ok: false, error: "forbidden" };
  if (!isServiceConfigured()) return { ok: false, error: "not-configured" };
  if (userId === callerId) return { ok: false, error: BLOCKER_MESSAGE.self };

  const supabase = await createClient();
  const { data: previewData, error: previewError } = await supabase.rpc("admin_account_deletion_preview", {
    target_user: userId,
  });
  if (previewError) return { ok: false, error: deletionMessage(previewError.message) };
  const preview = previewData as DeletionPreview;
  const blocker = preview.blockers[0];
  if (blocker) return { ok: false, error: BLOCKER_MESSAGE[blocker] ?? blocker };

  const service = createServiceClient();
  let canceled = 0;
  for (const subscription of preview.providerSubscriptions) {
    try {
      await getProvider(subscription.provider).cancelSubscription(subscription.providerSubscriptionId);
    } catch (cancelError) {
      if (!isGoneAtProvider(cancelError)) {
        const detail = cancelError instanceof Error ? cancelError.message : String(cancelError);
        return {
          ok: false,
          error: `Não foi possível cancelar a assinatura ${subscription.provider}, então nada foi excluído: ${detail}`,
        };
      }
    }
    const { error: markError } = await service
      .from("subscriptions")
      .update({ status: "canceled", canceled_at: new Date().toISOString(), cancel_at_period_end: false })
      .eq("id", subscription.id);
    if (markError) {
      return {
        ok: false,
        error: `A assinatura ${subscription.provider} foi cancelada no provedor, mas registrar isso falhou (${markError.message}). Nada mais foi excluído — tente de novo.`,
      };
    }
    canceled += 1;
    await recordAudit(supabase, "admin.account.subscription_canceled", {
      entityType: "subscription",
      entityId: subscription.id,
      metadata: { provider: subscription.provider, userId, cause: "account_deletion" },
    });
  }

  const { data: deletedData, error: deleteError } = await supabase.rpc("admin_delete_account", {
    target_user: userId,
    confirm_email: confirmEmail,
    reason,
  });
  if (deleteError) {
    const already =
      canceled > 0
        ? ` (${plural(canceled, "assinatura no provedor já foi cancelada", "assinaturas no provedor já foram canceladas")}.)`
        : "";
    return { ok: false, error: `${deletionMessage(deleteError.message)}${already}` };
  }
  const deleted = deletedData as { deletedWorkspaces: string[]; counts: Record<string, number> };

  const storage = await purgeAccountStorage(deleted.deletedWorkspaces, userId);
  await recordAudit(supabase, "admin.account.storage_purged", {
    entityType: "user",
    entityId: userId,
    metadata: { workspaces: deleted.deletedWorkspaces, ...storage },
  });

  return {
    ok: true,
    data: {
      deletedWorkspaces: deleted.deletedWorkspaces,
      counts: deleted.counts,
      canceledSubscriptions: canceled,
      storage,
    },
  };
}

/** Second attempt at the files of an already-deleted account. */
export async function retryAccountStoragePurge(
  userId: string,
  orgIds: string[],
): Promise<AdminActionResult<StoragePurgeResult>> {
  const { allowed } = await isCallerSuperadmin();
  if (!allowed) return { ok: false, error: "forbidden" };
  if (!isServiceConfigured()) return { ok: false, error: "not-configured" };

  const storage = await purgeAccountStorage(orgIds, userId);
  await recordAudit(await createClient(), "admin.account.storage_purged", {
    entityType: "user",
    entityId: userId,
    metadata: { workspaces: orgIds, retry: true, ...storage },
  });
  return { ok: true, data: storage };
}

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}
