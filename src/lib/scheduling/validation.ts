// Telefone BR: DDD (2) + número (8 ou 9 dígitos), com ou sem +55.
export function isValidBrazilPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  const local = digits.startsWith("55") && digits.length > 11 ? digits.slice(2) : digits;
  return local.length === 10 || local.length === 11;
}
