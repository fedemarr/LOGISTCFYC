import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Los packages del monorepo se consumen como TS fuente (sin paso de
  // build propio), Next.js los transpila igual que a su propio código.
  transpilePackages: ["@lastmile/shared", "@lastmile/state-machine", "@lastmile/geo"],
};

export default nextConfig;
