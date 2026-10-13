"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { logout } from "@/lib/actions";
import { GlobalSearch } from "@/components/global-search";
import { can, type Capability } from "@/lib/permissions";

type NavItem = { href: string; label: string; shortLabel?: string; icon: "home" | "calendar" | "users" | "cash" | "team" | "settings"; cap?: Capability };

const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", shortLabel: "Início", icon: "home" },
  { href: "/dashboard/agenda", label: "Agenda", icon: "calendar" },
  { href: "/dashboard/pacientes", label: "Pacientes", icon: "users" },
  { href: "/dashboard/financeiro", label: "Financeiro", icon: "cash", cap: "finance" },
  { href: "/dashboard/equipe", label: "Equipe", icon: "team", cap: "team" },
  { href: "/dashboard/agenda/configuracoes", label: "Configurações", shortLabel: "Config.", icon: "settings", cap: "settings" },
];

type IconName = NavItem["icon"] | "logout";

// Ícones inline (sem lib externa, consistente com o resto do projeto):
// traço simples em currentColor, herdam a cor do item ativo/inativo.
function NavIcon({ name, className }: { name: IconName; className?: string }) {
  const common = {
    className,
    viewBox: "0 0 20 20",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  switch (name) {
    case "logout":
      return (
        <svg {...common}>
          <path d="M8 3H4.5A1.5 1.5 0 0 0 3 4.5v11A1.5 1.5 0 0 0 4.5 17H8M13 6l4 4-4 4M17 10H8" />
        </svg>
      );
    case "home":
      return (
        <svg {...common}>
          <path d="M3 9.5 10 3l7 6.5" />
          <path d="M5 8v8h10V8" />
        </svg>
      );
    case "calendar":
      return (
        <svg {...common}>
          <rect x="3" y="4.5" width="14" height="12" rx="1.5" />
          <path d="M3 8h14M7 3v3M13 3v3" />
        </svg>
      );
    case "users":
      return (
        <svg {...common}>
          <circle cx="7.5" cy="7" r="2.5" />
          <path d="M2.5 16c0-2.5 2.2-4 5-4s5 1.5 5 4" />
          <circle cx="14.5" cy="7.5" r="2" />
          <path d="M12.5 5.3c.3-.1.6-.1 1-.1 2 0 3.6 1.2 3.9 3" />
        </svg>
      );
    case "team":
      return (
        <svg {...common}>
          <circle cx="10" cy="6.5" r="2.5" />
          <path d="M5 16c0-2.8 2.2-4.5 5-4.5s5 1.7 5 4.5" />
          <path d="M3 9.5h2M15 9.5h2" />
        </svg>
      );
    case "settings":
      return (
        <svg {...common}>
          <circle cx="10" cy="10" r="2.6" />
          <path d="M10 3.5v2M10 14.5v2M3.5 10h2M14.5 10h2M5.4 5.4l1.4 1.4M13.2 13.2l1.4 1.4M5.4 14.6l1.4-1.4M13.2 6.8l1.4-1.4" />
        </svg>
      );
    case "cash":
      return (
        <svg {...common}>
          <rect x="2.5" y="5.5" width="15" height="9" rx="1.5" />
          <circle cx="10" cy="10" r="2" />
          <path d="M5 7.5v0M15 12.5v0" />
        </svg>
      );
  }
}

// Longest-match: "/dashboard/agenda/configuracoes" não deve acender também
// "Agenda" (prefixo dela), e "/dashboard" só vale na raiz.
function isActive(items: NavItem[], pathname: string, href: string) {
  if (href === "/dashboard") return pathname === "/dashboard";
  const matchesThis = pathname === href || pathname.startsWith(`${href}/`);
  if (!matchesThis) return false;
  return !items.some(
    (other) =>
      other.href.length > href.length &&
      other.href.startsWith(`${href}/`) &&
      (pathname === other.href || pathname.startsWith(`${other.href}/`)),
  );
}

function NavLinks({ items, pathname, onNavigate }: { items: NavItem[]; pathname: string; onNavigate?: () => void }) {
  return (
    <>
      {items.map((item) => {
        const active = isActive(items, pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              active ? "bg-accent-soft text-accent-dark" : "text-muted hover:bg-accent-soft/60 hover:text-ink"
            }`}
          >
            <NavIcon name={item.icon} className="h-5 w-5 shrink-0" />
            {item.label}
          </Link>
        );
      })}
    </>
  );
}

export function DashboardNav({
  tenantName,
  logoUrl,
  fullName,
  role,
  patients,
}: {
  tenantName: string | null;
  logoUrl: string | null;
  fullName: string;
  role: string;
  patients: { id: string; fullName: string; phone: string }[];
}) {
  const pathname = usePathname();
  const items = NAV_ITEMS.filter((item) => !item.cap || can(role, item.cap));

  return (
    <>
      {/* Desktop: coluna fixa à esquerda */}
      {/* sticky + altura da tela: a barra fica parada enquanto a página rola, e o
          "Sair" no rodapé dela não muda de lugar conforme o tamanho da página. */}
      <aside className="hidden h-dvh w-60 shrink-0 flex-col self-start border-r border-border bg-surface md:sticky md:top-0 md:flex">
        <div className="flex shrink-0 items-center gap-2 p-4">
          {logoUrl ? (
            <Image
              src={logoUrl}
              alt={`Logo de ${tenantName ?? "clínica"}`}
              width={32}
              height={32}
              className="rounded-md border border-border object-contain"
            />
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-accent-soft text-sm font-semibold text-accent-dark">
              {tenantName?.charAt(0)?.toUpperCase() ?? "M"}
            </div>
          )}
          <span className="heading truncate text-base">{tenantName ?? "MindManager"}</span>
        </div>

        <div className="shrink-0 px-3">
          <GlobalSearch patients={patients} />
        </div>

        <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-3">
          <NavLinks items={items} pathname={pathname} />
        </nav>

        <div className="shrink-0 border-t border-border p-3">
          <p className="truncate px-3 text-xs text-muted-soft">{fullName}</p>
          <form action={logout}>
            <button
              type="submit"
              className="mt-1 w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-muted hover:bg-accent-soft/60 hover:text-ink"
            >
              Sair
            </button>
          </form>
        </div>
      </aside>

      {/* Mobile: tab bar fixa no rodapé */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex h-[calc(3.5rem+env(safe-area-inset-bottom))] border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:hidden">
        {items.map((item) => {
          const active = isActive(items, pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium ${
                active ? "text-accent-dark" : "text-muted-soft"
              }`}
            >
              <NavIcon name={item.icon} className="h-5 w-5" />
              <span className="max-w-full truncate px-0.5">{item.shortLabel ?? item.label}</span>
            </Link>
          );
        })}
        <form action={logout} className="flex min-w-0 flex-1">
          <button
            type="submit"
            className="flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium text-muted-soft"
          >
            <NavIcon name="logout" className="h-5 w-5" />
            Sair
          </button>
        </form>
      </nav>
    </>
  );
}
