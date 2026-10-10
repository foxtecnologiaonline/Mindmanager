// CSV para planilha (Excel/Sheets pt-BR): separador ";", BOM UTF-8 e
// proteção contra "CSV injection" — célula que começa com = + - @ vira
// fórmula ao abrir, então recebe um apóstrofo na frente.
function escapeCell(value: string): string {
  let v = value;
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return /[";\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function toCsv(rows: string[][]): string {
  return "﻿" + rows.map((row) => row.map(escapeCell).join(";")).join("\r\n") + "\r\n";
}

export function centsToDecimal(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}
