"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { Alert, Box, Button, CircularProgress, Paper, Typography } from "@mui/material";

import { DEFAULTS } from "@/config";
import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";

type Status = "loading" | "accepted" | "error";

/**
 * Invite landing page. The middleware guarantees a session (unauthenticated
 * visitors are sent to sign-in with next=/invite/<token> and land back here),
 * so this page only needs to call the accept_invite RPC.
 */
export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const [status, setStatus] = useState<Status>("loading");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const accept = async () => {
      if (!isSupabaseConfigured) {
        setStatus("error");
        setMessage("Supabase is not configured.");
        return;
      }
      const supabase = createClient();
      const { error } = await supabase.rpc("accept_invite", { invite_token: token });
      if (error) {
        setStatus("error");
        setMessage(error.message);
        return;
      }
      setStatus("accepted");
    };
    accept();
  }, [token]);

  return (
    <Box className="flex min-h-[60vh] w-full items-center justify-center p-4">
      <Paper elevation={3} className="bg-background-paper shadow-darker-xs w-[32rem] max-w-full rounded-4xl p-14">
        <Box className="flex flex-col items-center gap-6 text-center">
          {status === "loading" && (
            <>
              <CircularProgress />
              <Typography variant="h5" component="h5">
                Accepting invite...
              </Typography>
            </>
          )}

          {status === "accepted" && (
            <>
              <Typography variant="h4" component="h4">
                Welcome aboard!
              </Typography>
              <Typography variant="body1" className="text-text-secondary">
                You joined the organization. You can review it in the organization settings.
              </Typography>
              <Box className="flex flex-row gap-2">
                <Button variant="contained" LinkComponent={Link} href="/settings/organization">
                  Organization settings
                </Button>
                <Button variant="outlined" color="grey" LinkComponent={Link} href={DEFAULTS.appRoot}>
                  Go to dashboard
                </Button>
              </Box>
            </>
          )}

          {status === "error" && (
            <>
              <Typography variant="h4" component="h4">
                Invite not accepted
              </Typography>
              <Alert severity="error" className="neutral bg-background-paper/60! w-full">
                {message ?? "The invite may be expired or already used."}
              </Alert>
              <Button variant="outlined" color="grey" LinkComponent={Link} href={DEFAULTS.appRoot}>
                Go to dashboard
              </Button>
            </>
          )}
        </Box>
      </Paper>
    </Box>
  );
}
