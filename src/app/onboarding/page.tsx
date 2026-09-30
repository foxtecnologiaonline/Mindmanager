import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createTenant } from "@/lib/actions";

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", user.id)
    .single();

  if (profile?.tenant_id) {
    redirect("/dashboard");
  }

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <form action={createTenant} className="w-full max-w-sm space-y-4">
        <h1 className="text-2xl font-semibold">Sua clínica</h1>
        <p className="text-sm text-neutral-600">
          Como se chama sua clínica ou consultório?
        </p>
        {error && (
          <p className="rounded bg-red-50 p-2 text-sm text-red-600">
            {error}
          </p>
        )}
        <div className="space-y-1">
          <label htmlFor="name" className="text-sm font-medium">
            Nome da clínica
          </label>
          <input
            id="name"
            name="name"
            required
            className="w-full rounded border px-3 py-2"
          />
        </div>
        <button
          type="submit"
          className="w-full rounded bg-black py-2 text-white"
        >
          Continuar
        </button>
      </form>
    </main>
  );
}
