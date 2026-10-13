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
    /**
     * What she declared beyond the five product modalities (0119), as she typed
     * it. Absent on a database that predates the migration.
     */
    modalitiesOther?: string[] | null;
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
    /**
     * What this account'''s AI cost us (migrations 0115/0117), in USD micros.
     *
     * `unpricedCalls` and `estimatedCalls` ride with every line for a reason:
     * a cost of zero beside 200 unpriced calls is a price book nobody filled
     * in, and an estimated line is history rebuilt from recorded seconds. The
     * UI must never let either read as a measured bill.
     */
    /** Absent on a database that predates migration 0117. */
    spend?: {
      usdToBrl: number | null;
      window: {
        costUsdMicros: number;
        calls: number;
        unpricedCalls: number;
        estimatedCalls: number;
        lifetimeCostUsdMicros: number;
        lifetimeCalls: number;
        firstAt: string | null;
        lastAt: string | null;
      };
      byFeature: {
        feature: string;
        costUsdMicros: number;
        calls: number;
        unpricedCalls: number;
        estimatedCalls: number;
        tokensIn: number;
        tokensOut: number;
        audioSeconds: number;
        lastAt: string | null;
      }[];
      byModel: { provider: string; model: string; costUsdMicros: number; calls: number; priced: boolean }[];
      monthly: { month: string; costUsdMicros: number; calls: number }[];
    };
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
      blocker: `${brokenCount} ${brokenCount === 1 ? "gravação falhou ou travou" : "gravações falharam ou travaram"} nos últimos 30 dias — e gravação que falha não queima minuto, então o uso dela parece leve em vez de quebrado.`,
      action: "Conserte o job e avise que foi consertado.",
    };
  }
  if (consent.audioUnderRevokedConsent > 0) {
    return {
      blocker: `${consent.audioUnderRevokedConsent} ${consent.audioUnderRevokedConsent === 1 ? "gravação guardada" : "gravações guardadas"} sob um consentimento que a paciente revogou.`,
      action: "Apague o áudio hoje.",
    };
  }
  if (money.failedCharges.count > 0) {
    const since = days(money.failedCharges.since);
    return {
      blocker: `Uma cobrança está falhando${since !== null ? ` há ${since} ${since === 1 ? "dia" : "dias"}` : ""}.`,
      action: money.failedCharges.invoiceUrl ? "Mande o link de pagamento para ela." : "Confira no provedor e reemita.",
    };
  }
  if (money.openCheckout) {
    return {
      blocker: `O checkout do ${money.openCheckout.planName} foi abandonado há ${money.openCheckout.ageDays} ${money.openCheckout.ageDays === 1 ? "dia" : "dias"} e continua aberto.`,
      action: money.openCheckout.url ? "Mande o link de pagamento em aberto." : "Pergunte se ela ainda quer.",
    };
  }
  if (!identity.checkoutReady && (flags.includes("trial_ending") || flags.includes("trial_active"))) {
    return {
      blocker: "Sem CPF/CNPJ no cadastro: o checkout não se completa quando ela decidir pagar.",
      action: "Ligue e preencha junto com ela antes do trial acabar.",
    };
  }
  if (flags.includes("trial_ending")) {
    return {
      blocker: `O trial dela acaba em ${trialDaysLeft ?? 0} ${trialDaysLeft === 1 ? "dia" : "dias"}.`,
      action: identity.lifecycleEmailOptOut
        ? "Ela recusou os e-mails de ciclo de vida — a automação está muda, esta precisa de gente."
        : "A automação está cuidando; ligue só se a conta merecer um empurrão pessoal.",
    };
  }
  if (consent.erasureRequests.count > 0) {
    const oldest = days(consent.erasureRequests.oldest);
    return {
      blocker: `${consent.erasureRequests.count} ${consent.erasureRequests.count === 1 ? "pedido de exclusão de paciente pendente" : "pedidos de exclusão de paciente pendentes"}${oldest !== null ? ` (o mais antigo há ${oldest} d)` : ""}.`,
      action: "Acompanhe com ela a exclusão do prontuário.",
    };
  }
  if (flags.includes("never_activated")) {
    return {
      blocker: "Nenhum atendimento finalizado — o produto ainda não aconteceu para ela.",
      action: dossier.identity.onboarding?.track
        ? `Ela escolheu começar por "${dossier.identity.onboarding.track}". Retome de onde parou.`
        : "Pergunte onde ela travou.",
    };
  }
  if (flags.includes("idle")) {
    return { blocker: "Ela usou e parou.", action: "Uma mensagem perguntando o que mudou." };
  }
  return { blocker: null, action: "Nada aqui precisa de você." };
}
