import { Alert, Box, Card, CardContent, Divider, Typography } from "@mui/material";

import { isSupabaseConfigured } from "@gogo/auth";
import { createClient } from "@gogo/auth/server";

type VerifyRow = {
  kind: string;
  title: string;
  status: string;
  version: number;
  issued_at: string | null;
  content_hash: string | null;
  organization_name: string;
};

/** Public QR target: authenticity check for documents issued via @gogo/documents. */
export default async function VerifyDocument({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;

  let row: VerifyRow | null = null;
  if (isSupabaseConfigured) {
    const supabase = await createClient();
    const { data } = await supabase.rpc("verify_document", { code });
    row = (data?.[0] as VerifyRow | undefined) ?? null;
  }

  return (
    <Box className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-lg">
        <CardContent className="flex flex-col gap-4">
          <Typography variant="h4" component="h1">
            Document verification
          </Typography>

          {!isSupabaseConfigured && (
            <Alert severity="info" className="neutral bg-background-paper/60!">
              Verification is unavailable: Supabase is not configured.
            </Alert>
          )}

          {isSupabaseConfigured && !row && (
            <Alert severity="error" className="neutral bg-background-paper/60!">
              No issued document matches this code. The document may be a draft, or the code is invalid.
            </Alert>
          )}

          {row && (
            <>
              <Alert
                severity={row.status === "issued" ? "success" : "warning"}
                className="neutral bg-background-paper/60!"
              >
                {row.status === "issued"
                  ? "Authentic document, issued through this platform."
                  : "This document was REVOKED by the issuer and should not be relied upon."}
              </Alert>
              <Divider />
              <Box className="flex flex-col gap-1">
                <Typography variant="body1">
                  <strong>Issuer:</strong> {row.organization_name}
                </Typography>
                <Typography variant="body1">
                  <strong>Title:</strong> {row.title}
                </Typography>
                <Typography variant="body1">
                  <strong>Type:</strong> {row.kind} · <strong>Version:</strong> {row.version}
                </Typography>
                {row.issued_at && (
                  <Typography variant="body1">
                    <strong>Issued at:</strong> {new Date(row.issued_at).toLocaleString()}
                  </Typography>
                )}
                {row.content_hash && (
                  <Typography variant="body2" className="text-text-secondary break-all">
                    File integrity (sha256): {row.content_hash}
                  </Typography>
                )}
              </Box>
              <Typography variant="body2" className="text-text-secondary">
                Verification code: {code}
              </Typography>
            </>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
