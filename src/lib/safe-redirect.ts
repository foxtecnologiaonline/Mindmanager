// Só caminhos internos: "//evil.com" ou "/\\evil.com" seriam redirect aberto
// (o navegador trata como URL absoluta de outro host).
export function safeNextPath(raw: string | null | undefined, fallback = "/dashboard"): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) {
    return fallback;
  }
  // Caracteres de controle (CR/LF/tab) podem ser descartados pelo parser de
  // URL e reabrir "//host" depois da validação.
  if (/[\u0000-\u001f\u007f]/.test(raw)) return fallback;
  return raw;
}
