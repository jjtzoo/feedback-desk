import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cloud Run runs .next/standalone/server.js (spec v3 D29).
  output: "standalone",
  // The browser tests build into their own folder so a running `next dev` is left alone.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // Every screen is signed-in and fetches on the client, so Cache Components and Partial
  // Prefetching add nothing here; keep the defaults off.
  poweredByHeader: false,
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
