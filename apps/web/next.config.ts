import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import type { NextConfig } from "next";

// Static on purpose: a nonce would make every page dynamic, so Next's inline scripts are allowed instead.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  // Product photos come straight from the stores (Darty's Shopify CDN, Radio Popular's file server).
  "img-src 'self' data: https://darty.pt https://cdn.shopify.com https://lojae-s3-prd-files.radiopopular.pt",
  "font-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CONTENT_SECURITY_POLICY },
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Its workerd build (cloudflare:sockets) only gets used when Next leaves it unbundled.
  serverExternalPackages: ["postgres"],
  images: {
    loader: "custom",
    loaderFile: "./image-loader.ts",
    deviceSizes: [640, 828, 1080, 1200],
    imageSizes: [96, 160, 256, 384],
  },
  headers() {
    // next dev needs eval for Fast Refresh, which the policy blocks.
    if (process.env.NODE_ENV !== "production") {
      return Promise.resolve([]);
    }
    return Promise.resolve([{ source: "/:path*", headers: SECURITY_HEADERS }]);
  },
};

export default nextConfig;

void initOpenNextCloudflareForDev();
