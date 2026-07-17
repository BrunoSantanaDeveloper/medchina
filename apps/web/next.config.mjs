import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Vercel's default build container is 8 GB. This app is large (MUI X Premium,
  // @react-pdf, many admin/marketing routes), and parallel static-generation
  // workers collectively exhausted the container (SIGKILL / OOM) after a
  // successful compile. Cap build parallelism to one worker and enable Next's
  // webpack memory optimizations so peak build memory stays under the limit.
  experimental: {
    webpackMemoryOptimizations: true,
    cpus: 1,
  },
  // @react-pdf/renderer (therapeutic-plan PDF issuance) is a heavy Node-only
  // renderer — keep it external so Next does not bundle it into the server build.
  serverExternalPackages: ["@react-pdf/renderer"],
  transpilePackages: [
    "@mui/material-nextjs",
    "@flyee/content",
    "@flyee/design-tokens",
    "@flyee/auth",
    "@flyee/db",
    "@flyee/email",
    "@flyee/billing",
    "@flyee/ai",
    "@flyee/jobs",
    "@flyee/knowledge",
    "@flyee/connectors",
    "@flyee/clinical",
    "@flyee/audit",
    "@flyee/documents",
    "@flyee/transcribe",
    "@flyee/whatsapp",
    "@flyee/onboarding",
  ],
  images: {
    formats: ["image/webp", "image/avif"],
    qualities: [90],
  },
  async headers() {
    const patientConsentHeaders = [
      { key: "Cache-Control", value: "no-store, max-age=0" },
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
      { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
    ];

    return [
      { source: "/consentir", headers: patientConsentHeaders },
      { source: "/api/public/consent/:path*", headers: patientConsentHeaders },
    ];
  },
};

export default withNextIntl(nextConfig);
