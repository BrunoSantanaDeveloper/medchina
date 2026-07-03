# @gogo/documents

Issued documents (professional records, prescriptions, invoices, certificates...) with **versioning**, **sha256 integrity hash** and a **QR-verifiable public code**.

## Model

- `documents` — org-scoped row per issued document: project-defined `kind`, render `payload`, `version` + `parent_id` chain for reissues, unique `verify_code`, `content_hash` of the stored PDF. RLS: members read, owners/admins issue; issued documents can be **revoked, never deleted** (drafts may be discarded).
- Private `documents` storage bucket (`<org_id>/...` paths).
- `verify_document(code)` — security-definer RPC callable by `anon`: exposes only kind/title/status/version/issued_at/hash/org name. The public page at `/verify/[code]` (QR target) renders it.

## Issuing

PDF rendering is **pluggable** — the package hands your renderer the verification context and takes the bytes back:

```ts
import { issueDocument } from "@gogo/documents";

const result = await issueDocument(
  supabase, // user's server client (RLS applies)
  { orgId, kind: "session-plan", title: "Session plan — 2026-07-03", payload, issuedBy: user.id, verifyBaseUrl: origin },
  async ({ verifyUrl, qrDataUrl, verifyCode }) => {
    // Render with your stack of choice (e.g. @react-pdf/renderer) and
    // print the QR (qrDataUrl) + code on the document.
    return pdfBytes;
  },
);
```

Reissue: pass `parentId` (previous document id) and `version: previous + 1`. The old version stays verifiable; revoke it if it must be flagged as superseded.

## Verifying

Anyone scanning the QR lands on `/verify/<code>`: valid documents show issuer organization, kind, title, version, issue date and content hash (compare with a local `sha256` of the file to prove integrity); revoked ones are clearly flagged.

## Migration

`packages/db/migrations/0006_documents.sql`. No env vars; `verifyBaseUrl` comes from the caller (request origin).
