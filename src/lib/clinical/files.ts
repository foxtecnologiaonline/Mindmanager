// Anexos do prontuário: só PDF e imagens, conferindo os primeiros bytes
// (o `type` enviado pelo navegador é só uma declaração, fácil de forjar).
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB (igual ao bucket)

export const EXTENSION_BY_MIME: Record<string, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export function sniffMime(bytes: Uint8Array): string | null {
  const startsWith = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);

  if (startsWith(0x25, 0x50, 0x44, 0x46)) return "application/pdf"; // %PDF
  if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (startsWith(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (
    startsWith(0x52, 0x49, 0x46, 0x46) && // RIFF
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50 // WEBP
  ) {
    return "image/webp";
  }
  return null;
}

// Nome para exibição: sem caminho, sem caracteres de controle, tamanho limitado.
export function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "arquivo";
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 200);
  return cleaned || "arquivo";
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
