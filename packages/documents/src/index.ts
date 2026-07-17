import { createHash, randomBytes, randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import QRCode from "qrcode";

/** Unambiguous alphabet (no 0/O/1/I/L) for codes typed by hand. */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 12;

export function generateVerifyCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let code = "";
  for (let index = 0; index < CODE_LENGTH; index += 1) {
    code += CODE_ALPHABET[bytes[index] % CODE_ALPHABET.length];
  }
  return code;
}

export const sha256Hex = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

/** PNG data URL for embedding the QR in the rendered document. */
export const qrPngDataUrl = (text: string) => QRCode.toDataURL(text, { margin: 1, width: 256 });

export interface IssuePayloadContext {
  documentId: string;
  version: number;
  /** Canonical source row captured transactionally by reservation, when the source supports it. */
  sourceSnapshot: unknown | null;
}

export interface IssueDocumentInput {
  orgId: string;
  /** Project-defined template slug (e.g. "session-plan", "invoice"). */
  kind: string;
  title: string;
  /** Data used to render the document. Stored, never exposed by verification. */
  payload?: Record<string, unknown> | ((context: IssuePayloadContext) => Record<string, unknown>);
  issuedBy: string;
  sourceType: string;
  sourceId: string;
  subjectType?: string;
  subjectId?: string;
  /** One UUID per user action; retries reuse it, deliberate reissues do not. */
  idempotencyKey: string;
  /** Public origin for verification links, e.g. "https://app.example.com". */
  verifyBaseUrl: string;
}

/** Passed to the caller's renderer so the QR/code can be printed on the document. */
export interface IssueContext extends IssuePayloadContext {
  verifyCode: string;
  verifyUrl: string;
  qrDataUrl: string;
}

export type IssueResult =
  | { ok: true; documentId: string; verifyCode: string; verifyUrl: string }
  | { ok: false; error: string };

/**
 * Issue a document: creates the draft row, hands the verification context
 * to the caller's PDF renderer, stores the bytes in the private
 * "documents" bucket, records the sha256 and flips status to "issued".
 * A failed attempt releases its fenced rendering claim but retains the exact
 * reserved version for an idempotent retry. Runs through a trusted client;
 * authorization and source-snapshot validity are enforced by the RPCs.
 */
export async function issueDocument(
  supabase: SupabaseClient,
  input: IssueDocumentInput,
  render: (ctx: IssueContext) => Promise<Uint8Array>,
): Promise<IssueResult> {
  const verifyCode = generateVerifyCode();
  const { data: reserveData, error: reserveError } = await supabase.rpc("reserve_document_version", {
    target_org: input.orgId,
    target_kind: input.kind,
    target_title: input.title,
    // Rendering context is only committed after this request owns the issue
    // claim. This prevents a concurrent retry from changing the draft payload.
    target_payload: {},
    target_source_type: input.sourceType,
    target_source_id: input.sourceId,
    target_subject_type: input.subjectType ?? null,
    target_subject_id: input.subjectId ?? null,
    target_idempotency_key: input.idempotencyKey,
    target_verify_code: verifyCode,
    target_issued_by: input.issuedBy,
  });
  if (reserveError) return { ok: false, error: "document_issue_conflict" };
  const reserved = reserveData as {
    ok?: boolean;
    code?: string;
    documentId?: string;
    verifyCode?: string;
    version?: number;
    status?: string;
    sourceSnapshot?: unknown;
  } | null;
  if (!reserved?.ok || !reserved.documentId || !reserved.verifyCode || !reserved.version) {
    return { ok: false, error: reserved?.code ?? "document_issue_conflict" };
  }

  const documentId = reserved.documentId;
  const version = reserved.version;
  const effectiveVerifyCode = reserved.verifyCode;
  const sourceSnapshot = reserved.sourceSnapshot ?? null;
  const verifyUrl = `${input.verifyBaseUrl.replace(/\/$/, "")}/verify/${effectiveVerifyCode}`;

  // A repeated HTTP request after publication returns the same version.
  if (reserved.status === "issued") {
    return { ok: true, documentId, verifyCode: effectiveVerifyCode, verifyUrl };
  }

  const claimToken = randomUUID();
  let claimAttempted = false;
  let uploadedStoragePath: string | null = null;
  try {
    claimAttempted = true;
    const { data: claimData, error: claimError } = await supabase.rpc("claim_document_issue", {
      target_document: documentId,
      target_claim_token: claimToken,
    });
    const claimed = claimData as {
      ok?: boolean;
      code?: string;
      status?: string;
      claimToken?: string;
    } | null;
    if (claimError || !claimed?.ok) {
      throw new Error(claimed?.code ?? "document_issue_conflict");
    }
    if (claimed.status === "issued") {
      return { ok: true, documentId, verifyCode: effectiveVerifyCode, verifyUrl };
    }
    if (claimed.claimToken !== claimToken) throw new Error("document_issue_conflict");

    const payload =
      typeof input.payload === "function"
        ? input.payload({ documentId, version, sourceSnapshot })
        : (input.payload ?? {});
    const { data: payloadRow, error: payloadError } = await supabase
      .from("documents")
      .update({ payload })
      .eq("id", documentId)
      .eq("status", "draft")
      .eq("issue_claim_token", claimToken)
      .gt("issue_lease_expires_at", new Date().toISOString())
      .select("id")
      .maybeSingle();
    if (payloadError || !payloadRow) {
      throw new Error("document_issue_conflict");
    }

    const pdf = await render({
      documentId,
      version,
      verifyCode: effectiveVerifyCode,
      verifyUrl,
      qrDataUrl: await qrPngDataUrl(verifyUrl),
      sourceSnapshot,
    });

    // A claim-specific object path makes a stale renderer physically unable
    // to overwrite the bytes published by the winning claim. The database
    // stores the winning path, so no Storage-side compare-and-swap is needed.
    const storagePath = `${input.orgId}/${documentId}-v${version}-${claimToken}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from("documents")
      .upload(storagePath, pdf, { contentType: "application/pdf", upsert: true });
    if (uploadError) throw new Error("document_issue_conflict");
    uploadedStoragePath = storagePath;

    const { data: publishData, error: publishError } = await supabase.rpc("publish_document_version", {
      target_document: documentId,
      target_claim_token: claimToken,
      target_content_hash: sha256Hex(pdf),
      target_storage_path: storagePath,
    });
    const published = publishData as { ok?: boolean; code?: string } | null;
    if (publishError || !published?.ok) throw new Error(published?.code ?? "document_issue_conflict");

    return { ok: true, documentId, verifyCode: effectiveVerifyCode, verifyUrl };
  } catch (error) {
    // Keep the reserved draft. A retry with the same idempotency key resumes
    // the exact version instead of silently minting another one. Releasing by
    // token is safe even if the claim response itself was lost in transit.
    if (claimAttempted) {
      const { data: releaseData } = await supabase.rpc("release_document_issue", {
        target_document: documentId,
        target_claim_token: claimToken,
      });
      const released = releaseData as { ok?: boolean; code?: string } | null;

      // The publication may have committed even when its HTTP response was
      // lost. In that case the issued row is authoritative and its object must
      // remain available; return the idempotent success result.
      if (released?.ok && released.code === "issued") {
        return { ok: true, documentId, verifyCode: effectiveVerifyCode, verifyUrl };
      }

      // A failed/stale claim owns a unique path, so best-effort cleanup cannot
      // delete the artifact selected by another successful attempt.
      if (uploadedStoragePath) {
        await supabase.storage.from("documents").remove([uploadedStoragePath]);
      }
    }
    return { ok: false, error: error instanceof Error ? error.message : "document_issue_conflict" };
  }
}

/** Issued documents are never deleted — revoking keeps the trail verifiable. */
export async function revokeDocument(
  supabase: SupabaseClient,
  documentId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("documents").update({ status: "revoked" }).eq("id", documentId);
  return error ? { ok: false, error: "document_revoke_conflict" } : { ok: true };
}
