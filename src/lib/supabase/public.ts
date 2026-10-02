import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Client sem acesso a cookies — só para dados 100% públicos (RPCs
// security definer que já não dependem de sessão, ex: get_booking_info).
// Importante: usar `cookies()`/o client de src/lib/supabase/server.ts
// força a rota inteira a renderizar dinâmica a cada request (Next detecta
// o acesso a cookies). Esse client evita isso, permitindo ISR nas
// páginas públicas que só precisam dele.
export function createPublicClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
