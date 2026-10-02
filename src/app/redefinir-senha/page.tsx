import { updatePassword } from "@/lib/actions";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <form action={updatePassword} className="card w-full max-w-sm space-y-4 p-8">
        <h1 className="heading text-2xl">Definir nova senha</h1>
        {error && (
          <p className="rounded-lg bg-red-50 p-2 text-sm text-red-600">{error}</p>
        )}
        <div className="space-y-1">
          <label htmlFor="password" className="text-sm font-medium text-ink">
            Nova senha
          </label>
          <input
            id="password"
            name="password"
            type="password"
            minLength={6}
            required
            className="input"
          />
        </div>
        <button type="submit" className="btn-primary w-full">
          Salvar nova senha
        </button>
      </form>
    </main>
  );
}
