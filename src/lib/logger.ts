// Log estruturado (uma linha JSON por evento): a Vercel indexa os campos e
// dá pra filtrar por `level`/`event` em Logs, ou encaminhar via Log Drain
// para qualquer ferramenta (Sentry, Datadog, Axiom...) sem mexer no código.
type Level = "info" | "warn" | "error";

function serializeError(err: unknown) {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack?.split("\n").slice(0, 6).join("\n") };
  }
  return { message: String(err) };
}

function emit(level: Level, event: string, fields: Record<string, unknown> = {}, err?: unknown) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...fields,
    ...(err === undefined ? {} : { error: serializeError(err) }),
  });
  (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(line);
}

export const logger = {
  info: (event: string, fields?: Record<string, unknown>) => emit("info", event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => emit("warn", event, fields),
  error: (event: string, err?: unknown, fields?: Record<string, unknown>) =>
    emit("error", event, fields, err),
};
