import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Página não encontrada" };

export default function NotFound() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="card w-full max-w-sm space-y-4 p-8 text-center">
        <h1 className="heading text-2xl">Página não encontrada</h1>
        <p className="text-sm text-muted">
          O endereço que você acessou não existe ou o link pode estar
          incorreto — confira com a clínica se for um link de agendamento.
        </p>
        <Link href="/" className="link-accent text-sm">
          Voltar para o início
        </Link>
      </div>
    </main>
  );
}
