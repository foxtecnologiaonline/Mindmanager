import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Usada pelo monitor de uptime (.github/workflows/uptime.yml) e por
// qualquer verificador externo. Confere que o app responde E que o
// Supabase Auth está de pé — sem tocar em dados de nenhuma clínica.
export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    return NextResponse.json({ status: "error", reason: "supabase não configurado" }, { status: 503 });
  }

  try {
    const res = await fetch(`${url}/auth/v1/health`, {
      headers: { apikey: key },
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json({ status: "degraded", supabase: res.status }, { status: 503 });
    }
    return NextResponse.json({ status: "ok" });
  } catch {
    return NextResponse.json({ status: "degraded", supabase: "timeout" }, { status: 503 });
  }
}
