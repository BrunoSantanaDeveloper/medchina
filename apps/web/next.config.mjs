import createNextIntlPlugin from "next-intl/plugin";
import { fileURLToPath, URL } from "node:url";

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
  // Type-checking and linting the whole monorepo inside `next build` is the
  // heaviest memory phase and OOM-killed the Vercel build container. Both are
  // already enforced as dedicated CI steps (`npm run typecheck` + lint in
  // .github/workflows/ci.yml), so skipping them here is safe and only removes
  // redundant work from the production build.
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
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
  /*
    `pptxgenjs` (the .pptx export at /palestra/exportar) ships one build for
    both runtimes and reaches for `node:fs` / `node:https` through dynamic
    imports on its Node-only paths. Turbopack honors the `browser` field that
    maps them away, which is why `next dev` was fine; the webpack production
    build failed instead with `UnhandledSchemeError: Reading from "node:fs"`.
    A `resolve.alias` does not help — webpack handles the `node:` scheme before
    resolution — so the specifier itself is replaced, for the client only.
  */
  webpack(config, { isServer, webpack }) {
    if (!isServer) {
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(
          /^node:(fs|https)$/,
          fileURLToPath(new URL("./src/lib/node-module-stub.ts", import.meta.url)),
        ),
      );
    }
    return config;
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
