import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cloud Run runs .next/standalone/server.js (spec v3 D29).
  output: "standalone",
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
