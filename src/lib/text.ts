// Remove acentuação (normaliza NFD e descarta os marcadores de
// combinação) — usado tanto pra gerar slug de tenant quanto pra
// sanitizar nome/cidade no payload Pix, que só aceita ASCII simples.
export function stripDiacritics(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "");
}
