import type { NextConfig } from "next";

// Cabeçalhos de segurança básicos. CSP fica de fora de propósito: o Next
// injeta scripts inline e exigiria nonce por request (middleware) — item
// da lista de melhorias, não um ajuste de uma linha.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Upload de logo (2 MB) e anexos do prontuário (10 MB) passam por server
  // actions; o padrão do Next é 1 MB.
  experimental: {
    serverActions: { bodySizeLimit: "11mb" },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
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
