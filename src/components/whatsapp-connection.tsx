"use client";

import { useState, useTransition } from "react";
import { disconnectOwnWhatsapp } from "@/lib/integrations/whatsapp-actions";

export function WhatsappConnection({
  mode,
  numberId,
  isAdmin,
}: {
  mode: "shared" | "own";
  numberId: string | null;
  isAdmin: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(
    null,
  );

  function handleDisconnect() {
    setMessage(null);
    startTransition(async () => {
      const result = await disconnectOwnWhatsapp();
      if (!result.success) {
        setMessage({ type: "error", text: result.error ?? "Não foi possível desconectar." });
        return;
      }
      setMessage({ type: "success", text: "Voltou para o número do MindManager." });
    });
  }

  if (!isAdmin) {
    return (
      <p className="text-sm text-muted-soft">
        {mode === "own"
          ? "Esta clínica usa um número de WhatsApp próprio."
          : "Esta clínica usa o número de WhatsApp do MindManager."}{" "}
        Só administradores podem alterar essa configuração.
      </p>
    );
  }

  // Número próprio por clínica ainda existe no banco (migration 0006) e
  // continua suportado para quem já estava conectado, mas não dá pra
  // conectar um novo — decisão de produto (2026-10-14): por enquanto só
  // o número único do MindManager. A trava real está nas server actions
  // (whatsapp-actions.ts); aqui só não oferecemos a opção.
  if (mode === "own") {
    return (
      <div className="space-y-2 text-sm">
        <p className="text-ink">
          Conectado com número próprio{numberId ? ` (ID ${numberId})` : ""}. As perguntas de
          confirmação e as respostas dos pacientes passam por esse número.
        </p>
        <button
          type="button"
          onClick={handleDisconnect}
          disabled={isPending}
          className="btn-secondary px-3 py-1.5 text-xs"
        >
          Voltar para o número do MindManager
        </button>
        {message && (
          <p
            className={`rounded-lg p-2 text-xs ${
              message.type === "error" ? "bg-red-50 text-red-600" : "bg-green-50 text-green-700"
            }`}
          >
            {message.text}
          </p>
        )}
      </div>
    );
  }

  return (
    <p className="text-sm text-muted-soft">
      Por enquanto, todas as clínicas usam o número de WhatsApp do MindManager — conectar um
      número próprio ainda não está disponível.
    </p>
  );
}
