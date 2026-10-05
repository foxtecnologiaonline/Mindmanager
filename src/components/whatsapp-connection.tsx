"use client";

import { useState, useTransition } from "react";
import {
  connectOwnWhatsapp,
  disconnectOwnWhatsapp,
  listOwnZapscriptNumbers,
} from "@/lib/integrations/whatsapp-actions";

type ZapscriptNumber = {
  id: string;
  phoneNumber: string;
  status: string;
  connected: boolean;
};

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
  const [connecting, setConnecting] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [numbers, setNumbers] = useState<ZapscriptNumber[]>([]);
  const [selectedNumberId, setSelectedNumberId] = useState("");
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(
    null,
  );

  function handleListNumbers() {
    setMessage(null);
    startTransition(async () => {
      const result = await listOwnZapscriptNumbers(apiKey);
      if (result.error) {
        setMessage({ type: "error", text: result.error });
        return;
      }
      setNumbers(result.numbers);
      if (result.numbers.length === 0) {
        setMessage({
          type: "error",
          text: "Nenhum número encontrado nessa conta ZapScript. Conecte um número de WhatsApp no painel do ZapScript primeiro.",
        });
      }
    });
  }

  function handleConnect() {
    if (!selectedNumberId) return;
    setMessage(null);
    startTransition(async () => {
      const result = await connectOwnWhatsapp({ apiKey, numberId: selectedNumberId });
      if (!result.success) {
        setMessage({ type: "error", text: result.error ?? "Não foi possível conectar." });
        return;
      }
      setMessage({ type: "success", text: "Número conectado! Suas respostas agora saem por aqui." });
      setConnecting(false);
      setApiKey("");
      setNumbers([]);
    });
  }

  function handleDisconnect() {
    setMessage(null);
    startTransition(async () => {
      const result = await disconnectOwnWhatsapp();
      if (!result.success) {
        setMessage({ type: "error", text: result.error ?? "Não foi possível desconectar." });
        return;
      }
      setMessage({ type: "success", text: "Voltou para o número compartilhado da plataforma." });
    });
  }

  if (!isAdmin) {
    return (
      <p className="text-sm text-muted-soft">
        {mode === "own"
          ? "Esta clínica usa um número de WhatsApp próprio."
          : "Esta clínica usa o número compartilhado da plataforma."}{" "}
        Só administradores podem alterar essa configuração.
      </p>
    );
  }

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
          Voltar para o número compartilhado
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
    <div className="space-y-3 text-sm">
      <p className="text-muted-soft">
        Hoje as mensagens saem pelo número compartilhado da plataforma. Pra usar o número da
        própria clínica, conecte sua conta ZapScript.
      </p>

      {!connecting ? (
        <button
          type="button"
          onClick={() => setConnecting(true)}
          className="btn-secondary px-3 py-1.5 text-xs"
        >
          Conectar número próprio
        </button>
      ) : (
        <div className="space-y-3 rounded-xl border border-border bg-paper p-4">
          <ol className="list-decimal space-y-1 pl-4 text-xs text-muted-soft">
            <li>Conecte seu WhatsApp no painel do ZapScript (QR code).</li>
            <li>
              Crie uma API key com os escopos <code>messages:send</code> e{" "}
              <code>webhooks:manage</code>.
            </li>
            <li>Cole a API key abaixo.</li>
          </ol>
          <div className="space-y-1">
            <label className="font-medium text-ink">API key do ZapScript</label>
            <input
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                setNumbers([]);
                setSelectedNumberId("");
              }}
              type="password"
              className="input"
              placeholder="zsk_..."
            />
          </div>
          <button
            type="button"
            onClick={handleListNumbers}
            disabled={isPending || !apiKey.trim()}
            className="btn-secondary px-3 py-1.5 text-xs"
          >
            Buscar números conectados
          </button>

          {numbers.length > 0 && (
            <div className="space-y-1">
              <label className="font-medium text-ink">Número</label>
              <select
                value={selectedNumberId}
                onChange={(e) => setSelectedNumberId(e.target.value)}
                className="input"
              >
                <option value="">Selecione...</option>
                {numbers.map((n) => (
                  <option key={n.id} value={n.id} disabled={!n.connected}>
                    {n.phoneNumber} {n.connected ? "" : "(desconectado)"}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleConnect}
              disabled={isPending || !selectedNumberId}
              className="btn-primary px-3 py-1.5 text-xs"
            >
              {isPending ? "Conectando..." : "Conectar este número"}
            </button>
            <button
              type="button"
              onClick={() => setConnecting(false)}
              className="text-xs text-muted-soft hover:text-ink"
            >
              cancelar
            </button>
          </div>
        </div>
      )}

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
