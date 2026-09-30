import { updatePassword } from "@/lib/actions";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <form action={updatePassword} className="w-full max-w-sm space-y-4">
        <h1 className="text-2xl font-semibold">Definir nova senha</h1>
        {error && (
          <p className="rounded bg-red-50 p-2 text-sm text-red-600">{error}</p>
        )}
        <div className="space-y-1">
          <label htmlFor="password" className="text-sm font-medium">
            Nova senha
          </label>
          <input
            id="password"
            name="password"
            type="password"
            minLength={6}
            required
            className="w-full rounded border px-3 py-2"
          />
        </div>
        <button
          type="submit"
          className="w-full rounded bg-black py-2 text-white"
        >
          Salvar nova senha
        </button>
      </form>
    </main>
  );
}
