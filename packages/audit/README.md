# @flyee/audit

Compliance layer for projects handling sensitive data (LGPD, Lei 13.787-style requirements): audit trail, immutable row history and consent records. **Mechanism only** — the template marks no tables and defines no consent terms; each derived project opts in.

## 1. Audit events (`audit_events`)

Append-only by construction: RLS has insert + select policies and **no update/delete**. Org owners/admins (and superadmins) can read; anyone in the org can append their own actions.

```ts
import { logAuditEvent } from "@flyee/audit";
await logAuditEvent(supabase, { orgId, actorId: user.id, action: "patient.viewed", entityType: "patient", entityId });
```

Failures are returned, never thrown — auditing must not take the main flow down.

## 2. Immutable row versioning (`record_versions`)

A generic `audit_record_version()` trigger snapshots every INSERT/UPDATE/DELETE of marked tables (full row as jsonb + operation + `auth.uid()`). History is written via security definer and has **no write policies**: it cannot be edited or purged through the API.

Mark tables in the derived project's migrations:

```sql
select public.enable_row_versioning('public.patients');
select public.enable_row_versioning('public.anamnesis_records');
```

Requirements: the table has an `id uuid` primary key; an `org_id uuid` column (when present) scopes who may read its history (org owners/admins).

## 3. Consents (`consent_terms` / `consent_acceptances`)

Terms are versioned per slug (e.g. `treatment`, `audio-recording`, `ai-processing`); superadmins manage them. Acceptances record who consented (`subject_type` + `subject_id`, project-defined), which term version, when — and are revocable (`revoked_at`) but never deleted.

```ts
import { hasActiveConsent, recordConsent, revokeConsent } from "@flyee/audit";

if (!(await hasActiveConsent(supabase, { orgId, slug: "audio-recording", subjectType: "patient", subjectId }))) {
  // block the recording flow until consent is recorded
}
```

## Migration

`packages/db/migrations/0005_audit.sql`. No env vars; no background jobs.
