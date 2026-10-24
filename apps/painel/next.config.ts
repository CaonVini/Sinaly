import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@sinaly/shared"],
  poweredByHeader: false,
};

export default config;
