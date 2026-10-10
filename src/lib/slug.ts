import { stripDiacritics } from "@/lib/text";

// Normaliza um nome em slug ascii-kebab (ex: "Clínica São José" ->
// "clinica-sao-jose"), usado no fallback de criação de tenant.
export function slugify(name: string): string {
  return (
    stripDiacritics(name.toLowerCase())
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "clinica"
  );
}
