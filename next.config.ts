import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    proxyClientMaxBodySize: "150mb",
  },
  typescript: {
    // Monorepo API routes have legacy type drift; runtime is validated in handlers.
    ignoreBuildErrors: true,
  },

  // Useful for Docker / server deployments later (optional, safe now)
  // output: "standalone",

  async headers() {
    return [
      {
        source: "/.well-known/apple-app-site-association",
        headers: [{ key: "Content-Type", value: "application/json" }],
      },
    ];
  },

  async rewrites() {
    return {
      // App Router does not register app/.well-known/* routes on Vercel (404).
      // Rewrite the Apple-required path to a normal API route before filesystem routing.
      beforeFiles: [
        {
          source: "/.well-known/apple-app-site-association",
          destination: "/api/aasa",
        },
      ],
    };
  },

  images: {
    // Allow common remote image hosts (edit later to your real hosts)
    remotePatterns: [
      // Clerk profile images (sometimes)
      { protocol: "https", hostname: "img.clerk.com" },
      { protocol: "https", hostname: "images.clerk.dev" },

      // Common CDNs (safe defaults)
      { protocol: "https", hostname: "cdn.jsdelivr.net" },

      // If you later use Cloudinary / S3 / Firebase Storage, add them here:
      // { protocol: "https", hostname: "res.cloudinary.com" },
      // { protocol: "https", hostname: "firebasestorage.googleapis.com" },
      // { protocol: "https", hostname: "<your-bucket>.s3.amazonaws.com" },
    ],
  },
};

export default nextConfig;
