/**
 * Allowed attachment types for a consultation (migration 0068), shared by the
 * client (input accept + validation) and the server (reserve/confirm). Kept
 * isomorphic — no server-only imports — so both sides agree on one list.
 *
 *  - image  = a clinical PHOTO (gated on clinical-images consent);
 *  - document = a PDF the professional attaches (exam result, referral).
 */
export type AttachmentKind = "image" | "document";

export const ATTACHMENT_IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"] as const;
export const ATTACHMENT_DOCUMENT_MIMES = ["application/pdf"] as const;

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

const EXTENSION: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "application/pdf": "pdf",
};

/** The `accept` attribute for the desktop file input (photos + PDF). */
export const ATTACHMENT_ACCEPT = [...ATTACHMENT_IMAGE_MIMES, ...ATTACHMENT_DOCUMENT_MIMES].join(",");

export function attachmentKindForMime(mime: string): AttachmentKind | null {
  if ((ATTACHMENT_IMAGE_MIMES as readonly string[]).includes(mime)) return "image";
  if ((ATTACHMENT_DOCUMENT_MIMES as readonly string[]).includes(mime)) return "document";
  return null;
}

export function attachmentExtension(mime: string): string {
  return EXTENSION[mime] ?? "bin";
}
