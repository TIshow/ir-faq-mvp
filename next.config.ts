import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Commented out export mode to enable API routes
  // output: 'export',
  trailingSlash: true,
  images: {
    unoptimized: true
  }
};

export default nextConfig;
