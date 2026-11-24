import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // The floating dev badge covered page content in demos and QA screenshots.
  devIndicators: false,
  partialPrefetching: true,
  // Server Actions default to 1 MB per request. Portraits are advertised as "up to 2 MB", so the
  // action body must hold 2 MB plus form overhead. The server still enforces 2 MB on the bytes.
  experimental: { serverActions: { bodySizeLimit: "3mb" } },
  // The invite link carries its token in the address; never pass that address on as a referrer.
  async headers() {
    return [{ source: "/join", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
