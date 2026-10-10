import { timingSafeEqual } from "node:crypto";

// Compara "Authorization: Bearer <CRON_SECRET>" em tempo constante.
export function isCronAuthorized(authHeader: string | null, secret: string | undefined): boolean {
  if (!secret || !authHeader) return false;
  const a = Buffer.from(authHeader);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}
