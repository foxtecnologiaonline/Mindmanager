import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// CSP por request, com nonce: scripts só executam se carregados pelo
// próprio app (nonce + 'strict-dynamic'), o que neutraliza a maior parte
// do XSS mesmo que algum dado não escapado chegue ao HTML.
// - style-src mantém 'unsafe-inline' (atributos style={{}} e estilos
//   injetados pelo Next); o risco de XSS por CSS é bem menor que por JS.
// - Logos de clínica vêm do Supabase Storage (img-src).
// - 'unsafe-eval' só em desenvolvimento (React usa eval p/ stacks de debug).
function buildCsp(nonce: string) {
  const isDev = process.env.NODE_ENV === "development";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data: https://*.supabase.co",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

export async function proxy(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp(nonce);

  // O Next lê o nonce do header CSP da *requisição* ao renderizar.
  request.headers.set("x-nonce", nonce);
  request.headers.set("Content-Security-Policy", csp);

  const response = await updateSession(request);
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    // Prefetch continua passando pelo proxy: ele também faz a checagem de
    // sessão, e pular só para economizar um nonce enfraqueceria isso.
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
