import { redirect } from "next/navigation";

// Espelha as policies de RLS (migration 0016/0017) — o banco é quem
// realmente impede; isto só evita mostrar tela/botão que daria erro.
export type Role = "admin" | "profissional" | "recepcao";
export type Capability = "finance" | "clinical" | "settings" | "team" | "audit";

const MATRIX: Record<Capability, Role[]> = {
  finance: ["admin", "recepcao"],
  clinical: ["admin", "profissional"],
  settings: ["admin"],
  team: ["admin"],
  audit: ["admin"],
};

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Administrador",
  profissional: "Profissional",
  recepcao: "Recepção",
};

export function can(role: string | null | undefined, capability: Capability): boolean {
  return !!role && (MATRIX[capability] as string[]).includes(role);
}

// Para server components/actions: sem permissão volta ao dashboard com aviso.
export function requireCapability(role: string, capability: Capability): void {
  if (!can(role, capability)) {
    redirect(`/dashboard?error=${encodeURIComponent("Você não tem permissão para acessar essa área.")}`);
  }
}
