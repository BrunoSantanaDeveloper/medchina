# @flyee/email

Transactional email via Resend + React Email templates.

## Contract

- Server-only (uses `RESEND_API_KEY`); never import from client components.
- Every sender returns `{ sent: boolean }` and **no-ops gracefully** when `RESEND_API_KEY` is absent — features must offer a fallback (e.g. the invite UI offers a copyable link).
- Templates live in `src/templates/` as React Email components with inline styles (email clients ignore stylesheets; keep colors visually aligned with `packages/design-tokens` by hand).

## Env vars (apps/web/.env)

```
RESEND_API_KEY=        # server-only
EMAIL_FROM=            # verified sender, e.g. "Flyee <noreply@yourdomain.com>"
```

Without a verified domain, Resend only delivers from `onboarding@resend.dev` to your own account email — fine for development.

## Supabase auth emails

Auth emails (confirmation, reset) are sent by Supabase. To brand them through Resend, configure custom SMTP in the Supabase dashboard (Settings > Auth > SMTP) with Resend's SMTP credentials.
