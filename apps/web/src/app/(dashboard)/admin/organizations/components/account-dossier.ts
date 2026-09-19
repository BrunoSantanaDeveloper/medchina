/**
 * Shape of `admin_account_dossier(org)` (migration 0106) and the two
 * derivations the console puts on top of it: the one thing standing in this
 * account's way, and what to do about it.
 *
 * Everything else in this file is presentation. The numbers are the
 * database's — recomputing any of them here is how a console starts
 * disagreeing with the product it is supposed to describe.
 */

export type Dossier = {
  orgId: string;
  generatedAt: string;
  identity: {
    ownerId: string | null;
    userCreatedAt: string | null;
    modalities: string[] | null;
    areas: string[] | null;
    fiscalId: string | null;
    billingPhone: string | null;
    postalCodeOnFile: boolean;
    addressNumberOnFile: boolean;
    checkoutReady: boolean;
    audioRetention: string | null;
    timezoneConfirmed: boolean;
    lifecycleEmailOptOut: boolean;
    hasPassword: boolean;
    recoverySentAt: string | null;
    emailChangePending: boolean;
    staffAccount: boolean;
    onboarding: { track: string | null; dismissed: boolean | null; completedAt: string | null } | null;
  };
  money: {
    lifetimePaidCents: number;
    payments: number;
    refundedCents: number;
    payingSince: string | null;
    daysToFirstPayment: number | null;
    lastPaidCents: number | null;
    currency: string;
    providerCustomerId: string | null;
    providerSubscriptionId: string | null;
    coupon: { code: string; type: string; value: number } | null;
    invoices: {
      at: string;
      amountCents: number;
      status: string;
      provider: string;
      description: string | null;
      invoiceUrl: string | null;
    }[];
    failedCharges: { count: number; since: string | null; invoiceUrl: string | null };
    openCheckout: {
      planName: string;
      provider: string | null;
      createdAt: string;
      ageDays: number;
      url: string | null;
    } | null;
    checkout: { failed90d: number; stuck: number; lastError: string | null };
    offers: {
      trigger: string;
      state: string;
      openedAt: string | null;
      expiresAt: string | null;
      couponCode: string | null;
    }[];
    subscriptions: {
      planName: string;
      status: string;
      period: string | null;
      provider: string | null;
      createdAt: string;
      canceledAt: string | null;
      cancellationRequestedAt: string | null;
    }[];
  };
  usage: {
    activePatients: number;
    archivedPatients: number;
    daysToFirstPatient: number | null;
    daysToFirstRecord: number | null;
    funnel: {
      scheduled: number;
      inProgress: number;
      awaitingReview: number;
      draft: number;
      finalized: number;
      cancelled: number;
    };
    oldestOpenRecordDays: number | null;
    recordsFromAudio: number;
    recordsTyped: number;
    addenda: number;
    recordings: {
      total: number;
      ready: number;
      failed: number;
      cancelled: number;
      lastAt: string | null;
      modeAi: number;
      modeAudioOnly: number;
      modeUnknown: number;
    };
    captureSurface: Record<string, number>;
    mobileDevices: { count: number; lastSeenAt: string | null; platforms: string[] };
    minutes: { lifetimeCycle: number; lifetimePack: number; perFinalizedRecord: number | null };
    weeklyRecordings: number[] | null;
    documents: { issued: number; draft: number; revoked: number; byKind: Record<string, number> };
    shareLinks: { created: number; opened: number; totalOpens: number; lastOpenedAt: string | null };
  };
  broken: {
    failedRecordings30d: number;
    failedRecordingsTotal: number;
    failureStages: Record<string, number>;
    lastFailure: { at: string; errorCode: string | null; message: string | null } | null;
    stuckProcessing: { count: number; maxAttempts: number };
    strandedUploads: number;
    audioDeletionPending: { count: number; oldest: string | null };
    audioDeletionErrors: number;
    imports: {
      kind: string;
      status: string;
      source: string | null;
      counts: Record<string, number> | null;
      error: string | null;
      createdAt: string;
      revertedAt: string | null;
    }[];
  };
  ai: {
    library: Record<string, unknown>;
    libraryLedger: {
      billedUnitsThisMonth: number;
      viaApp: number;
      viaMcp: number;
      firstAt: string | null;
      lastAt: string | null;
      activeMonths: number;
    };
    usageAlerts: Record<string, { maxThreshold: number; lastAt: string }>;
    caseReviews: { total: number; aboutAPatient: number; lastAt: string | null };
    ownProtocols: { total: number; ready: number; failed: number };
    anamnesis: { fromAudio: number; edited: number; rejected: number };
    hypotheses: {
      total: number;
      awaitingReview: number;
      accepted: number;
      edited: number;
      rejected: number;
      withoutLibrary: number;
      stale: number;
    };
    plans: { ai: number; aiValidated: number; manual: number };
    reasoningPaywall: { viewed: number; clicked: number };
  };
  consent: {
    activePatients: number;
    clearedForAudio: number;
    clearedForAi: number;
    signedByPatient: number;
    declaredByProfessional: number;
    refusals: number;
    qrSessions: { total: number; completed: number; pending: number; expired: number; lastCompletedAt: string | null };
    audioUnderRevokedConsent: number;
    erasureRequests: { count: number; oldest: string | null };
    exports: {
      count: number;
      last: {
        status: string;
        requestedAt: string;
        completedAt: string | null;
        expiresAt: string | null;
        lastDownloadedAt: string | null;
        patientCount: number | null;
      } | null;
    };
  };
  access: {
    signIns: { total: number; last30d: number; lastAt: string | null };
    trailAvailable: boolean;
    mfa: { verified: number; unverified: number };
    supportVisits: { count: number; lastAt: string | null; lastActor: string | null };
  };
  timeline: { action: string; at: string }[];
};

/** The one thing standing in this account's way, and what to do about it. */
export type Verdict = { blocker: string | null; action: string };

const days = (iso: string | null | undefined) =>
  iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)) : null;

/**
 * First match wins, ordered by what an operator would actually do first:
 * something we broke, then money that is stuck, then a door she cannot open,
 * then the clock. A healthy account must reach the end and say so.
 */
export function readVerdict(dossier: Dossier, flags: string[], trialDaysLeft: number | null): Verdict {
  const { broken, money, identity, consent } = dossier;

  const brokenCount = broken.failedRecordings30d + broken.stuckProcessing.count + broken.strandedUploads;
  if (brokenCount > 0) {
    return {
      blocker: `${brokenCount} recording${brokenCount === 1 ? "" : "s"} failed or stuck in the last 30 days — and a failed recording burns no minutes, so her usage looks light instead of broken.`,
      action: "Fix the job, then tell her it is fixed.",
    };
  }
  if (consent.audioUnderRevokedConsent > 0) {
    return {
      blocker: `${consent.audioUnderRevokedConsent} recording${consent.audioUnderRevokedConsent === 1 ? "" : "s"} still stored under a consent the patient revoked.`,
      action: "Delete the audio today.",
    };
  }
  if (money.failedCharges.count > 0) {
    const since = days(money.failedCharges.since);
    return {
      blocker: `A charge has been failing${since !== null ? ` for ${since} day${since === 1 ? "" : "s"}` : ""}.`,
      action: money.failedCharges.invoiceUrl ? "Send her the payment link." : "Check the provider and reissue.",
    };
  }
  if (money.openCheckout) {
    return {
      blocker: `Checkout for ${money.openCheckout.planName} was abandoned ${money.openCheckout.ageDays} day${money.openCheckout.ageDays === 1 ? "" : "s"} ago and is still open.`,
      action: money.openCheckout.url ? "Send the open payment link." : "Ask whether she still wants it.",
    };
  }
  if (!identity.checkoutReady && (flags.includes("trial_ending") || flags.includes("trial_active"))) {
    return {
      blocker: "No fiscal identity on file: the checkout cannot complete when she decides to pay.",
      action: "Call and fill it in with her before the trial ends.",
    };
  }
  if (flags.includes("trial_ending")) {
    return {
      blocker: `Her trial ends in ${trialDaysLeft ?? 0} day${trialDaysLeft === 1 ? "" : "s"}.`,
      action: identity.lifecycleEmailOptOut
        ? "She opted out of lifecycle e-mail — the automation is silent, so this one needs a human."
        : "The drip is handling it; call only if the account is worth a personal push.",
    };
  }
  if (consent.erasureRequests.count > 0) {
    const oldest = days(consent.erasureRequests.oldest);
    return {
      blocker: `${consent.erasureRequests.count} patient erasure request${consent.erasureRequests.count === 1 ? "" : "s"} pending${oldest !== null ? ` (oldest ${oldest} d)` : ""}.`,
      action: "Walk her through erasing the chart.",
    };
  }
  if (flags.includes("never_activated")) {
    return {
      blocker: "No finalized record yet — the product has not happened to her.",
      action: dossier.identity.onboarding?.track
        ? `She chose the "${dossier.identity.onboarding.track}" start. Pick up where it stopped.`
        : "Ask what she got stuck on.",
    };
  }
  if (flags.includes("idle")) {
    return { blocker: "She used it and stopped.", action: "One message asking what changed." };
  }
  return { blocker: null, action: "Nothing needs you here." };
}
