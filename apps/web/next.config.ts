import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import pkg from "./package.json";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  reactStrictMode: false,
  // The version in browser error reports (src/lib/client-errors.ts).
  env: { NEXT_PUBLIC_APP_VERSION: process.env.APP_VERSION || pkg.version },
};

export default withNextIntl(nextConfig);
