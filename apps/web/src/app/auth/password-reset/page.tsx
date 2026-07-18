"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import React, { useState } from "react";

import { Alert, Box, Button, Divider, FormControl, FormLabel, Input, Paper, Typography } from "@mui/material";

import Logo from "@/components/logo/logo";
import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";
import { sanitizeInternalNext } from "@flyee/clinical";

export default function Page() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations("auth");
  const requestedNext = searchParams.get("next");
  const next = requestedNext ? sanitizeInternalNext(requestedNext) : null;
  const [email, setEmail] = useState("");
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setServerError(null);
    if (!isSupabaseConfigured) {
      setServerError(t("not-configured"));
      return;
    }
    setBusy(true);
    try {
      const supabase = createClient();
      const passwordNew = new URL("/auth/password-new", window.location.origin);
      if (next) passwordNew.searchParams.set("next", next);
      const callback = new URL("/auth/callback", window.location.origin);
      callback.searchParams.set("next", `${passwordNew.pathname}${passwordNew.search}`);
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: callback.toString() });
      if (error) {
        setServerError(t("request-failed"));
        return;
      }
      router.push("/auth/password-sent");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box className="bg-waves flex min-h-screen w-full items-center justify-center bg-cover bg-center p-4">
      <Paper elevation={3} className="bg-background-paper shadow-darker-xs w-lg max-w-full rounded-4xl py-14">
        <Box className="flex flex-col gap-4 px-8 sm:px-14">
          <Box className="mb-14 flex justify-center">
            <Logo classNameMobile="hidden" />
          </Box>

          <Box className="flex flex-col gap-10">
            <Box className="flex flex-col">
              <Typography variant="h1" component="h1" className="mb-2">
                {t("reset-title")}
              </Typography>
              <Typography variant="body1" className="text-text-primary">
                {t("reset-subtitle")}
              </Typography>
            </Box>

            <Box component="form" onSubmit={handleSubmit} className="flex flex-col">
              <FormControl className="outlined" variant="standard" size="small">
                <FormLabel component="label" htmlFor="email">
                  {t("email")}
                </FormLabel>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </FormControl>

              {serverError && (
                <Alert severity="error" className="neutral bg-background-paper/60! mb-4">
                  {serverError}
                </Alert>
              )}

              <Button type="submit" variant="contained" className="mt-2 mb-4" disabled={busy}>
                {t("reset-submit")}
              </Button>
            </Box>

            <Divider className="text-text-secondary my-0 text-sm"></Divider>
            <Box className="flex flex-col">
              <Typography variant="body1" className="text-text-secondary">
                <Link
                  href={`/auth/sign-in${next ? `?next=${encodeURIComponent(next)}` : ""}`}
                  className="link-primary link-underline-hover"
                >
                  {t("sent-back")}
                </Link>
              </Typography>
            </Box>
          </Box>
        </Box>
      </Paper>
    </Box>
  );
}
