import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@mui/material-nextjs"],
  images: {
    formats: ["image/webp", "image/avif"],
    qualities: [90],
  },
};

export default withNextIntl(nextConfig);
