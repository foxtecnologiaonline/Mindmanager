"use client";

import { useFormStatus } from "react-dom";

// Mostra feedback de "enviando" enquanto a server action do form pai
// está em voo — sem isso, clicar em qualquer botão (login, cadastro,
// configurações) não dava nenhum sinal até a página toda trocar,
// parecendo que o clique não fez nada em conexões mais lentas.
export function SubmitButton({
  children,
  pendingText,
  className = "btn-primary w-full",
}: {
  children: React.ReactNode;
  pendingText?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button type="submit" disabled={pending} className={className}>
      {pending ? pendingText ?? "Enviando..." : children}
    </button>
  );
}
