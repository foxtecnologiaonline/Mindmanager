import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Logo de clínica fica no Supabase Storage (bucket público
    // tenant-logos) — qualquer projeto Supabase, não só o nosso, pra
    // não precisar reconfigurar se o projeto mudar de nome/região.
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
};

export default nextConfig;
