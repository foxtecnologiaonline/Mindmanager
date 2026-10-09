"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

// Lê ?error=/?success= da URL (como os server actions já redirecionam)
// e mostra como toast flutuante com auto-dismiss, em vez do parágrafo
// inline que ficava preso na página até a próxima navegação. Limpa o
// parâmetro da URL ao fechar/expirar, sem recarregar a página.
export function Toast({
  paramNames = { error: "error", success: "success" },
  undo,
}: {
  paramNames?: { error?: string; success?: string };
  // Ação extra opcional no toast de sucesso ("Desfazer") — válida
  // enquanto o toast estiver visível (mesma janela do auto-dismiss,
  // sem precisar de um timer separado).
  undo?: {
    action: (formData: FormData) => void | Promise<void>;
    fields: Record<string, string>;
    label?: string;
  };
} = {}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const errorText = paramNames.error ? searchParams.get(paramNames.error) : null;
  const successText = paramNames.success ? searchParams.get(paramNames.success) : null;
  const text = errorText ?? successText;
  const type: "error" | "success" = errorText ? "error" : "success";

  // `dismissed` guarda o texto já descartado — evita setState síncrono
  // dentro do efeito (só dispara via timeout/clique, nunca direto no
  // corpo do effect) e dispensa um segundo estado "visible" espelhando `text`.
  const [dismissed, setDismissed] = useState<string | null>(null);
  const visible = Boolean(text) && text !== dismissed;

  useEffect(() => {
    if (!text) return;
    const timeout = setTimeout(() => dismiss(), 5000);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só precisa reagir a `text` mudar
  }, [text]);

  function dismiss() {
    setDismissed(text);
    const next = new URLSearchParams(searchParams.toString());
    if (paramNames.error) next.delete(paramNames.error);
    if (paramNames.success) next.delete(paramNames.success);
    const query = next.toString();
    router.replace(query ? `?${query}` : "?", { scroll: false });
  }

  if (!visible) return null;

  return (
    <div
      role="status"
      className={`animate-toast-in fixed bottom-4 left-1/2 z-50 flex max-w-sm -translate-x-1/2 items-start gap-3 rounded-xl border p-3 text-sm shadow-lg ${
        type === "error"
          ? "border-red-200 bg-red-50 text-red-700"
          : "border-accent/30 bg-accent-soft text-ink"
      }`}
    >
      <span className="flex-1">{text}</span>
      {type === "success" && undo && (
        <form action={undo.action}>
          {Object.entries(undo.fields).map(([key, value]) => (
            <input key={key} type="hidden" name={key} value={value} />
          ))}
          <button type="submit" className="font-semibold text-accent-dark underline">
            {undo.label ?? "Desfazer"}
          </button>
        </form>
      )}
      <button
        type="button"
        onClick={dismiss}
        aria-label="Fechar aviso"
        className="font-medium text-current opacity-70 hover:opacity-100"
      >
        ×
      </button>
    </div>
  );
}
