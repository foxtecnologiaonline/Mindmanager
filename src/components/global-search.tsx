"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type Patient = { id: string; fullName: string; phone: string };

// Busca client-side sobre a lista de pacientes já carregada no layout —
// clínicas pequenas/autônomas têm no máximo algumas centenas de
// pacientes, então filtrar na hora é mais simples e mais rápido do que
// ida ao banco por tecla. Cmd/Ctrl+K foca o campo de qualquer página
// sob /dashboard.
export function GlobalSearch({ patients }: { patients: Patient[] }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (e.key === "Escape") {
        setOpen(false);
        inputRef.current?.blur();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const normalizedQuery = query.trim().toLowerCase();
  const results =
    normalizedQuery.length === 0
      ? []
      : patients
          .filter(
            (p) =>
              p.fullName.toLowerCase().includes(normalizedQuery) ||
              p.phone.replace(/\D/g, "").includes(normalizedQuery.replace(/\D/g, "")),
          )
          .slice(0, 6);

  function goToFirst() {
    if (results[0]) {
      router.push(`/dashboard/pacientes/${results[0].id}`);
      setQuery("");
      setOpen(false);
    }
  }

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 100)}
        onKeyDown={(e) => {
          if (e.key === "Enter") goToFirst();
        }}
        placeholder="Buscar paciente... (Ctrl+K)"
        className="input py-1.5 text-sm"
      />
      {open && normalizedQuery.length > 0 && (
        <div className="absolute left-0 right-0 z-50 mt-1 max-h-64 overflow-y-auto rounded-lg border border-border bg-surface shadow-lg">
          {results.length === 0 ? (
            <p className="p-3 text-sm text-muted-soft">Nenhum paciente encontrado.</p>
          ) : (
            results.map((p) => (
              <Link
                key={p.id}
                href={`/dashboard/pacientes/${p.id}`}
                className="block border-b border-border px-3 py-2 text-sm last:border-0 hover:bg-accent-soft"
              >
                <p className="font-medium text-ink">{p.fullName}</p>
                <p className="text-xs text-muted-soft">{p.phone}</p>
              </Link>
            ))
          )}
        </div>
      )}
    </div>
  );
}
