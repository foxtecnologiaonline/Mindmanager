import Link from "next/link";

// Padrão único pra "não tem nada aqui ainda": ícone + frase + ação
// principal, em vez do parágrafo cinza solto que cada lista reimplementava
// do seu jeito.
export function EmptyState({
  icon,
  title,
  description,
  actionHref,
  actionLabel,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  actionHref?: string;
  actionLabel?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border p-8 text-center">
      {icon && <div className="text-muted-soft" aria-hidden="true">{icon}</div>}
      <p className="font-medium text-ink">{title}</p>
      {description && <p className="max-w-sm text-sm text-muted-soft">{description}</p>}
      {actionHref && actionLabel && (
        <Link href={actionHref} className="btn-primary mt-2">
          {actionLabel}
        </Link>
      )}
    </div>
  );
}
