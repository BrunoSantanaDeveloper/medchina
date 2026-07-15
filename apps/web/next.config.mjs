import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
};

export default withNextIntl(nextConfig);
