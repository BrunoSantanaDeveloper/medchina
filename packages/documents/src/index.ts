import { createHash, randomBytes } from "node:crypto";

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

export interface IssueDocumentInput {
  orgId: string;
  /** Project-defined template slug (e.g. "session-plan", "invoice"). */
  kind: string;
  title: string;
  /** Data used to render the document. Stored, never exposed by verification. */
  payload?: Record<string, unknown>;
  issuedBy: string;
  /** Set when reissuing: previous document id; version should be previous + 1. */
  parentId?: string;
  version?: number;
  /** Public origin for verification links, e.g. "https://app.example.com". */
  verifyBaseUrl: string;
}

/** Passed to the caller's renderer so the QR/code can be printed on the document. */
export interface IssueContext {
  documentId: string;
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
 * The draft is discarded if any step fails. Runs under the user's client
 * (RLS: org owners/admins).
 */
export async function issueDocument(
  supabase: SupabaseClient,
  input: IssueDocumentInput,
  render: (ctx: IssueContext) => Promise<Uint8Array>,
): Promise<IssueResult> {
  const verifyCode = generateVerifyCode();
  const version = input.version ?? 1;

  const { data: draft, error: insertError } = await supabase
    .from("documents")
    .insert({
      org_id: input.orgId,
      kind: input.kind,
      title: input.title,
      payload: input.payload ?? {},
      version,
      parent_id: input.parentId ?? null,
      verify_code: verifyCode,
      issued_by: input.issuedBy,
    })
    .select("id")
    .single();
  if (insertError || !draft) return { ok: false, error: insertError?.message ?? "Insert failed." };

  const verifyUrl = `${input.verifyBaseUrl.replace(/\/$/, "")}/verify/${verifyCode}`;

  try {
    const pdf = await render({
      documentId: draft.id,
      verifyCode,
      verifyUrl,
      qrDataUrl: await qrPngDataUrl(verifyUrl),
    });

    const storagePath = `${input.orgId}/${draft.id}-v${version}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from("documents")
      .upload(storagePath, pdf, { contentType: "application/pdf" });
    if (uploadError) throw new Error(uploadError.message);

    const { error: updateError } = await supabase
      .from("documents")
      .update({
        status: "issued",
        content_hash: sha256Hex(pdf),
        storage_path: storagePath,
        issued_at: new Date().toISOString(),
      })
      .eq("id", draft.id);
    if (updateError) throw new Error(updateError.message);

    return { ok: true, documentId: draft.id, verifyCode, verifyUrl };
  } catch (error) {
    await supabase.from("documents").delete().eq("id", draft.id);
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Issued documents are never deleted — revoking keeps the trail verifiable. */
export async function revokeDocument(
  supabase: SupabaseClient,
  documentId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("documents").update({ status: "revoked" }).eq("id", documentId);
  return error ? { ok: false, error: error.message } : { ok: true };
}
