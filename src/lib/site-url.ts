import { headers } from "next/headers";

// URL pública do site a partir da própria requisição (fallback pra
// NEXT_PUBLIC_SITE_URL quando setado) — usado pra montar links
// absolutos (confirmação de e-mail, recuperação de senha, link de
// pagamento) que saem do app por e-mail/WhatsApp.
export async function siteUrl() {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const protocol = h.get("x-forwarded-proto") ?? "http";
  return `${protocol}://${host}`;
}
