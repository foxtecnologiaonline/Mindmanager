"use client";

import { useState } from "react";

export function CopyLinkButton({ text, label = "Copiar" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API pode falhar (permissão, contexto não seguro) — sem
      // fallback automático, o texto já fica visível pra copiar na mão.
    }
  }

  return (
    <button type="button" onClick={copy} className="btn-secondary px-2 py-1 text-xs">
      {copied ? "Copiado!" : label}
    </button>
  );
}
