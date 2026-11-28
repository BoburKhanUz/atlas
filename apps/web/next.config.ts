import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import pkg from "./package.json";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// Sent with every page. The API is the Go server's (deploy/Caddyfile sends
// /api/* there); HSTS is added by Caddy, where HTTPS ends: local http
// development must not get it.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  reactStrictMode: false,
  poweredByHeader: false,
  // The version in browser error reports (src/lib/client-errors.ts).
  env: { NEXT_PUBLIC_APP_VERSION: process.env.APP_VERSION || pkg.version },
  async headers() {
    return [
      { source: "/(.*)", headers: securityHeaders },
      // No page may be framed (clickjacking).
      { source: "/(.*)", headers: [{ key: "Content-Security-Policy", value: "frame-ancestors 'none'" }] },
      // The reset link carries a one-time token: never send it on as a referrer.
      { source: "/reset-password", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
    ];
  },
};

export default withNextIntl(nextConfig);
