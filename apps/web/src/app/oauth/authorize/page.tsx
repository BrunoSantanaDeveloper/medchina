import { approveAuthorization, denyAuthorization } from "./actions";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import {
  Alert,
  Box,
  Button,
  Divider,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Paper,
  Typography,
} from "@mui/material";

import Logo from "@/components/logo/logo";
import NiBook from "@/icons/nexture/ni-book";
import NiCalendar from "@/icons/nexture/ni-calendar";
import NiPlug from "@/icons/nexture/ni-plug";
import NiUser from "@/icons/nexture/ni-user";
import { authorizeParamsFromSearch, errorRedirectUrl, validateAuthorizeRequest } from "@/lib/oauth/authorize-request";
import { type OauthScope, SCOPE_LABEL_KEYS } from "@/lib/oauth/scopes";
import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/server";
import { createServiceClient } from "@flyee/auth/service";

/**
 * OAuth consent screen (docs/MCP-CONECTORES.md). The professional arrives
 * here mid-flow from ChatGPT/Claude; her job is a single informed decision —
 * let this app query her workspace, or not — and either way she lands back
 * in the app she came from. Failures that cannot be safely redirected
 * (unknown client, unregistered return address) render here instead: a user
 * is never bounced to an unverified URL.
 */

const SCOPE_ICONS: Record<OauthScope, React.ReactNode> = {
  "library:read": <NiBook size="medium" className="text-primary" />,
  "patients:read": <NiUser size="medium" className="text-primary" />,
  "agenda:read": <NiCalendar size="medium" className="text-primary" />,
};

function ConsentShell({ children }: { children: React.ReactNode }) {
  return (
    <Box className="bg-waves flex min-h-screen w-full items-center justify-center bg-cover bg-center p-4">
      <Paper elevation={3} className="bg-background-paper shadow-darker-xs w-lg max-w-full rounded-4xl py-12">
        <Box className="flex flex-col gap-5 px-8 sm:px-12">{children}</Box>
      </Paper>
    </Box>
  );
}

function ErrorCard({ title, message, backLabel }: { title: string; message: string; backLabel: string }) {
  return (
    <ConsentShell>
      <Box className="flex justify-center">
        <Logo classNameFull="h-12 w-auto" classNameMobile="hidden" />
      </Box>
      <Typography variant="h1" component="h1" className="mb-0">
        {title}
      </Typography>
      <Alert severity="warning" className="neutral bg-background-paper/60!">
        {message}
      </Alert>
      <Button color="grey" variant="text" component={Link} href="/inicio">
        {backLabel}
      </Button>
    </ConsentShell>
  );
}

export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations("product");
  const params = authorizeParamsFromSearch(await searchParams);

  if (!isSupabaseConfigured) {
    return (
      <ErrorCard
        title={t("oauth-authorize-error-title")}
        message={t("oauth-error-not-configured")}
        backLabel={t("oauth-authorize-back-home")}
      />
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    // The middleware normally redirects first; this covers direct hits.
    const query = new URLSearchParams({
      response_type: params.responseType,
      client_id: params.clientId,
      redirect_uri: params.redirectUri,
      state: params.state,
      code_challenge: params.codeChallenge,
      code_challenge_method: params.codeChallengeMethod,
      scope: params.scopeParam,
    });
    redirect(`/auth/sign-in?next=${encodeURIComponent(`/oauth/authorize?${query.toString()}`)}`);
  }

  let service;
  try {
    service = createServiceClient();
  } catch {
    return (
      <ErrorCard
        title={t("oauth-authorize-error-title")}
        message={t("oauth-error-not-configured")}
        backLabel={t("oauth-authorize-back-home")}
      />
    );
  }

  const validation = await validateAuthorizeRequest(service, params);
  if (!validation.ok) {
    if (validation.kind === "redirect") {
      redirect(errorRedirectUrl(params.redirectUri, validation.error, validation.description, params.state));
    }
    const message =
      validation.error === "invalid_client" ? t("oauth-error-invalid-client") : t("oauth-error-invalid-redirect");
    return (
      <ErrorCard
        title={t("oauth-authorize-error-title")}
        message={message}
        backLabel={t("oauth-authorize-back-home")}
      />
    );
  }
  const { client, scopes } = validation;

  const { data: membership } = await supabase
    .from("memberships")
    .select("org_id, organizations(name)")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const orgId = (membership?.org_id as string | undefined) ?? null;
  if (!orgId) {
    return (
      <ErrorCard
        title={t("oauth-authorize-error-title")}
        message={t("oauth-error-no-workspace")}
        backLabel={t("oauth-authorize-back-home")}
      />
    );
  }
  const orgRel = membership?.organizations as { name?: string } | { name?: string }[] | null;
  const orgName = (Array.isArray(orgRel) ? orgRel[0]?.name : orgRel?.name) ?? "";

  const { data: entitlements } = await supabase.rpc("org_entitlements", { target_org: orgId });
  const limits = (entitlements?.limits ?? {}) as Record<string, unknown>;
  if (!entitlements?.active || Number(limits.mcp_access ?? 0) < 1) {
    return (
      <ErrorCard
        title={t("oauth-authorize-error-title")}
        message={t("oauth-error-plan")}
        backLabel={t("oauth-authorize-back-home")}
      />
    );
  }

  const { data: term } = await service
    .from("consent_terms")
    .select("title, body")
    .eq("slug", "external-assistant")
    .eq("is_active", true)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  const hiddenFields = (
    <>
      <input type="hidden" name="response_type" value={params.responseType} />
      <input type="hidden" name="client_id" value={params.clientId} />
      <input type="hidden" name="redirect_uri" value={params.redirectUri} />
      <input type="hidden" name="state" value={params.state} />
      <input type="hidden" name="code_challenge" value={params.codeChallenge} />
      <input type="hidden" name="code_challenge_method" value={params.codeChallengeMethod} />
      <input type="hidden" name="scope" value={params.scopeParam} />
    </>
  );

  return (
    <ConsentShell>
      <Box className="flex justify-center">
        <Logo classNameFull="h-12 w-auto" classNameMobile="hidden" />
      </Box>

      <Box className="flex flex-col items-center gap-2 text-center">
        <NiPlug size="large" className="text-primary" />
        <Typography variant="h1" component="h1" className="mb-0">
          {t("oauth-authorize-title")}
        </Typography>
        <Typography variant="body1" className="text-text-secondary">
          {t("oauth-authorize-subtitle", { client: client.client_name })}
        </Typography>
        {orgName ? (
          <Typography variant="body2" className="text-text-secondary">
            {t("oauth-authorize-workspace")}: <span className="text-text-primary font-medium">{orgName}</span>
          </Typography>
        ) : null}
      </Box>

      <Divider />

      <Box className="flex flex-col gap-1">
        <Typography variant="h6" component="h2" className="mb-0">
          {t("oauth-authorize-permissions")}
        </Typography>
        <List dense disablePadding>
          {scopes.map((scope) => (
            <ListItem key={scope} disableGutters>
              <ListItemIcon>{SCOPE_ICONS[scope]}</ListItemIcon>
              <ListItemText primary={t(SCOPE_LABEL_KEYS[scope])} />
            </ListItem>
          ))}
        </List>
      </Box>

      <Alert severity="info" className="neutral bg-background-paper/60!">
        {t("oauth-authorize-quota-note")}
      </Alert>

      {term ? (
        <Box className="flex flex-col gap-1">
          <Typography variant="h6" component="h2" className="mb-0">
            {t("oauth-authorize-term-title")}
          </Typography>
          <Box className="border-grey-100 max-h-40 overflow-y-auto rounded-lg border p-3">
            <Typography variant="body2" className="text-text-secondary whitespace-pre-line">
              {term.body as string}
            </Typography>
          </Box>
        </Box>
      ) : null}

      <Typography variant="body2" className="text-text-secondary">
        {t("oauth-authorize-disclaimer")}
      </Typography>

      <Box className="flex flex-col gap-2">
        <Box component="form" action={approveAuthorization}>
          {hiddenFields}
          <Button type="submit" variant="contained" fullWidth>
            {t("oauth-authorize-approve")}
          </Button>
        </Box>
        <Box component="form" action={denyAuthorization}>
          {hiddenFields}
          <Button type="submit" color="grey" variant="text" fullWidth>
            {t("oauth-authorize-deny")}
          </Button>
        </Box>
      </Box>
    </ConsentShell>
  );
}
