import Link from "next/link";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 p-6">
      <h1 className="heading text-4xl">MindManager</h1>
      <div className="flex gap-3">
        <Link href="/signup" className="btn-primary">
          Cadastrar
        </Link>
        <Link href="/login" className="btn-secondary">
          Entrar
        </Link>
      </div>
    </main>
  );
}
