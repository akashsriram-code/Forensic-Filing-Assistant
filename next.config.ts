import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Precomputed 13F radar files are read with fs at runtime, so file tracing can't discover them on its own.
  outputFileTracingIncludes: {
    "/api/13f-radar": ["./data/13f-precomputed/**/radar.json"],
    "/api/13f-radar/holders": ["./data/13f-precomputed/**/*.json"],
  },
};

export default nextConfig;
