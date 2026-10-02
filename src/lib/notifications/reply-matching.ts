export function normalizeReply(text: string) {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

// "1"/"2" é o principal (ver messages.ts — evita palavra reservada do
// ZapScript); sim/não ficam como sinônimos pra quem responde por fora do
// texto sugerido, ou via Twilio (que não tem essa colisão).
const YES_WORDS = ["1", "sim", "s", "confirmo", "confirmar", "yes"];
const NO_WORDS = ["2", "nao", "n", "cancelar", "cancelo", "no"];

export function isYesReply(normalized: string) {
  return YES_WORDS.includes(normalized);
}

export function isNoReply(normalized: string) {
  return NO_WORDS.includes(normalized);
}
