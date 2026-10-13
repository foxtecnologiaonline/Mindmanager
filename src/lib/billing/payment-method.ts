// Forma de pagamento de uma cobrança/recibo — compartilhado entre as server
// actions (validação do valor enviado pelo form) e as telas/relatórios
// (rótulo em pt-BR). Era redefinido em 8 arquivos diferentes; um método
// novo (ex: "boleto") só precisaria mudar aqui.
export const PAYMENT_METHODS = ["pix", "card", "cash", "other"] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const METHOD_LABEL: Record<PaymentMethod, string> = {
  pix: "PIX",
  card: "Cartão",
  cash: "Dinheiro",
  other: "Outro",
};

export function methodLabel(method: string | null | undefined): string {
  return method && method in METHOD_LABEL ? METHOD_LABEL[method as PaymentMethod] : "—";
}

// Valida o método vindo de um <select> de formulário, com fallback para um
// valor seguro em vez de deixar passar texto arbitrário pro banco.
export function parseMethod(
  value: FormDataEntryValue | null,
  fallback: PaymentMethod = "other",
): PaymentMethod {
  const v = String(value ?? "");
  return (PAYMENT_METHODS as readonly string[]).includes(v) ? (v as PaymentMethod) : fallback;
}
