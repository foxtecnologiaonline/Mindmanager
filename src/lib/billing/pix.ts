import { stripDiacritics } from "@/lib/text";

// Gera o payload "Pix Copia e Cola" (BR Code / EMV QR estático, com
// valor fixo) a partir da chave Pix da própria clínica — formatação
// pura, sem chamar nenhuma API de pagamento. O dinheiro vai direto do
// banco do paciente pra chave da clínica; o MindManager nunca
// intermedeia nem vê a transação. Mesma ideia de gerar o código de
// barras de um boleto a partir dos dados: representação, não
// processamento.
//
// Especificação: Banco Central (EMV QRCPS-MPM aplicado ao Pix). Cada
// campo é ID (2 dígitos) + tamanho (2 dígitos) + valor. O payload
// inteiro termina com o CRC16-CCITT (poli 0x1021, init 0xFFFF) dos
// próprios bytes anteriores, incluindo o cabeçalho "6304" do campo do
// CRC.

function tlv(id: string, value: string): string {
  const length = String(value.length).padStart(2, "0");
  return `${id}${length}${value}`;
}

// Remove acentuação e qualquer caractere fora do conjunto simples que o
// padrão aceita em nome/cidade (letras sem acento, números, espaço).
function sanitize(value: string, maxLength: number, fallback: string): string {
  const normalized = stripDiacritics(value)
    .replace(/[^A-Za-z0-9 ]/g, "")
    .trim();
  return (normalized || fallback).slice(0, maxLength);
}

function crc16CCITT(payload: string): string {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

export function buildPixPayload({
  pixKey,
  merchantName,
  merchantCity,
  amountCents,
  txId,
}: {
  pixKey: string;
  merchantName: string;
  merchantCity: string;
  amountCents: number;
  txId: string;
}): string {
  const amount = (amountCents / 100).toFixed(2);

  const merchantAccountInfo = tlv("00", "BR.GOV.BCB.PIX") + tlv("01", pixKey.trim());

  // Sem espaço e só alfanumérico — mesmo conjunto aceito pro txid.
  const cleanTxId = stripDiacritics(txId).replace(/[^A-Za-z0-9]/g, "").slice(0, 25) || "***";
  const additionalData = tlv("05", cleanTxId);

  const payloadWithoutCrc =
    tlv("00", "01") + // Payload Format Indicator
    tlv("26", merchantAccountInfo) + // Merchant Account Information — Pix
    tlv("52", "0000") + // Merchant Category Code (genérico)
    tlv("53", "986") + // Transaction Currency — BRL (ISO 4217)
    tlv("54", amount) + // Transaction Amount
    tlv("58", "BR") + // Country Code
    tlv("59", sanitize(merchantName, 25, "NA")) + // Merchant Name
    tlv("60", sanitize(merchantCity, 15, "NA")) + // Merchant City
    tlv("62", additionalData) + // Additional Data Field — txid
    "6304"; // cabeçalho do campo de CRC, entra no cálculo

  return payloadWithoutCrc + crc16CCITT(payloadWithoutCrc);
}
