"use client";

import { useFormStatus } from "react-dom";

// Mesmo botão do SubmitButton, mas pede confirmação antes de deixar o
// form submeter — usado nas ações destrutivas (cancelar consulta,
// remover paciente) que antes agiam no primeiro clique, sem chance de
// desistir de um toque errado.
export function ConfirmSubmitButton({
  confirmMessage,
  children,
  pendingText,
  className = "btn-primary w-full",
}: {
  confirmMessage: string;
  children: React.ReactNode;
  pendingText?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className={className}
      onClick={(e) => {
        if (!window.confirm(confirmMessage)) {
          e.preventDefault();
        }
      }}
    >
      {pending ? pendingText ?? "Enviando..." : children}
    </button>
  );
}
