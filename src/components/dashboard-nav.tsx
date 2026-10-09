"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { logout } from "@/lib/actions";
import { GlobalSearch } from "@/components/global-search";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: "home" as const },
  { href: "/dashboard/agenda", label: "Agenda", icon: "calendar" as const },
  { href: "/dashboard/pacientes", label: "Pacientes", icon: "users" as const },
  { href: "/dashboard/agenda/configuracoes", label: "Configurações", icon: "settings" as const },
];

type IconName = (typeof NAV_ITEMS)[number]["icon"];

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
    case "settings":
      return (
        <svg {...common}>
          <circle cx="10" cy="10" r="2.6" />
          <path d="M10 3.5v2M10 14.5v2M3.5 10h2M14.5 10h2M5.4 5.4l1.4 1.4M13.2 13.2l1.4 1.4M5.4 14.6l1.4-1.4M13.2 6.8l1.4-1.4" />
        </svg>
      );
  }
}

function NavLinks({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <>
      {NAV_ITEMS.map((item) => {
        const active =
          item.href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(item.href);
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
  patients,
}: {
  tenantName: string | null;
  logoUrl: string | null;
  fullName: string;
  patients: { id: string; fullName: string; phone: string }[];
}) {
  const pathname = usePathname();

  return (
    <>
      {/* Desktop: coluna fixa à esquerda */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-surface md:flex">
        <div className="flex items-center gap-2 p-4">
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

        <div className="px-3">
          <GlobalSearch patients={patients} />
        </div>

        <nav className="flex flex-1 flex-col gap-1 p-3">
          <NavLinks pathname={pathname} />
        </nav>

        <div className="border-t border-border p-3">
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
      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-surface md:hidden">
        {NAV_ITEMS.map((item) => {
          const active =
            item.href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${
                active ? "text-accent-dark" : "text-muted-soft"
              }`}
            >
              <NavIcon name={item.icon} className="h-5 w-5" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
