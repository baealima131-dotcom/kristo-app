import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Useful for Docker / server deployments later (optional, safe now)
  // output: "standalone",

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
