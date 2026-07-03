import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    "@mui/material-nextjs",
    "@gogo/design-tokens",
    "@gogo/auth",
    "@gogo/db",
    "@gogo/email",
    "@gogo/billing",
  ],
  images: {
    formats: ["image/webp", "image/avif"],
    qualities: [90],
  },
};

export default withNextIntl(nextConfig);
