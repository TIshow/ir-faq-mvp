// JS設定（実行時に typescript 不要。Cloud Runで prune 後も next start が config を読める）
/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  trailingSlash: true,
  // firebase-admin は webpack バンドルすると内部HTTP/ネイティブ依存が壊れやすい。
  // node_modules から実行させる（トークン検証を安定動作させる）。
  serverExternalPackages: ['firebase-admin'],
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
