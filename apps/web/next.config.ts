import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev badge would cover the rail and the timeline controls.
  devIndicators: false,
  transpilePackages: ["@goodscreen/editor-core", "@goodscreen/motion", "@goodscreen/ui"],
};

export default nextConfig;
