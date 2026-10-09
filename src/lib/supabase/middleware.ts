import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Páginas de auth: acessíveis sem sessão, mas usuário já logado é
// redirecionado para o dashboard (não faz sentido ver login de novo).
const AUTH_PATHS = ["/login", "/signup", "/auth", "/esqueci-senha"];

// Sempre públicas, independente de sessão: landing page, página de
// agendamento e de pagamento do paciente, e rotas server-to-server
// (cron), que têm sua própria checagem de segurança (CRON_SECRET) em
// vez de depender de cookie de usuário. Prefixos "startsWith" — nunca
// "/" aqui, ou todo o resto do app (inclusive /dashboard) passaria a
// ser público.
const ALWAYS_PUBLIC_PREFIXES = ["/agendar", "/pagar", "/api"];
// Match exato: essas rotas não têm sub-rotas e "/" via startsWith casaria
// com qualquer caminho.
const ALWAYS_PUBLIC_EXACT = ["/"];

export async function updateSession(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Curto-circuito antes de sequer criar o client: rotas sempre-públicas
  // não precisam pagar o round-trip de auth.getUser() a cada requisição
  // (importa especialmente para /agendar, que é a página do paciente, e
  // para /api/cron, chamada por um scheduler externo sem cookies).
  if (
    ALWAYS_PUBLIC_EXACT.includes(pathname) ||
    ALWAYS_PUBLIC_PREFIXES.some((path) => pathname.startsWith(path))
  ) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isAuthPath = AUTH_PATHS.some((path) => pathname.startsWith(path));

  if (!user && !isAuthPath) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && isAuthPath) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return response;
}
