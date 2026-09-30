import Link from "next/link";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-3xl font-semibold">MindManager</h1>
      <p className="max-w-md text-neutral-600">
        Gestão de agenda, prontuário e financeiro para profissionais de
        saúde autônomos.
      </p>
      <div className="flex gap-3">
        <Link href="/signup" className="rounded bg-black px-4 py-2 text-white">
          Criar conta
        </Link>
        <Link href="/login" className="rounded border px-4 py-2">
          Entrar
        </Link>
      </div>
    </main>
  );
}
