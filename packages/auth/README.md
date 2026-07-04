# @flyee/auth

Supabase auth building blocks for the apps.

- `@flyee/auth/client` — `createClient()` for Client Components.
- `@flyee/auth/server` — `createClient()` / `getUser()` for Server Components, Server Actions and Route Handlers.
- `@flyee/auth/middleware` — `updateSession(request)` to refresh session cookies and read the user in `middleware.ts`.
- `@flyee/auth` — `isSupabaseConfigured` flag.

## Graceful degradation

When `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` are absent, `updateSession` no-ops and the auth screens surface a configuration hint instead of failing. A fresh template clone stays fully browsable with no Supabase project.

## Required env vars (apps/web/.env)

```
NEXT_PUBLIC_SUPABASE_URL="https://<project>.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="<anon key>"
```

For OAuth (Google/GitHub) also enable the providers in the Supabase dashboard and add `<site>/auth/callback` to the redirect allow list.
