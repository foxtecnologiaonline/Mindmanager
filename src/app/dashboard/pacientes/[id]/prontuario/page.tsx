import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/tenant";
import { can, requireCapability } from "@/lib/permissions";
import { Toast } from "@/components/toast";
import { SubmitButton } from "@/components/submit-button";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { EmptyState } from "@/components/empty-state";
import { formatBytes } from "@/lib/clinical/files";
import {
  deleteDraft,
  registerConsent,
  removeAttachment,
  saveNote,
  uploadAttachment,
} from "@/lib/clinical/actions";

export const metadata: Metadata = { title: "Prontuário" };

const FIELDS = [
  { name: "subjective", label: "S — Subjetivo", hint: "Queixa e relato do paciente" },
  { name: "objective", label: "O — Objetivo", hint: "Observações, exame, testes" },
  { name: "assessment", label: "A — Avaliação", hint: "Hipótese, análise, evolução" },
  { name: "plan", label: "P — Plano", hint: "Conduta, orientações, retorno" },
] as const;

const AUDIT_LABEL: Record<string, string> = {
  "record.view": "Abriu o prontuário",
  "attachment.download": "Baixou anexo",
  "attachment.upload": "Anexou arquivo",
  "attachment.remove": "Removeu anexo da lista",
  "note.create": "Criou evolução",
  "note.update": "Editou rascunho",
  "note.sign": "Assinou evolução",
  "note.delete_draft": "Apagou rascunho",
  "patient.consent": "Registrou consentimento",
};

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  });
}

type Note = {
  id: string;
  parent_id: string | null;
  appointment_id: string | null;
  author_id: string;
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  status: string;
  signed_at: string | null;
  content_hash: string | null;
  created_at: string;
};

function NoteFieldsInputs({ note }: { note?: Note }) {
  return (
    <>
      {FIELDS.map((f) => (
        <div key={f.name} className="space-y-1">
          <label htmlFor={`${f.name}-${note?.id ?? "new"}`} className="text-sm font-medium text-ink">
            {f.label} <span className="font-normal text-muted-soft">· {f.hint}</span>
          </label>
          <textarea
            id={`${f.name}-${note?.id ?? "new"}`}
            name={f.name}
            rows={3}
            maxLength={20000}
            defaultValue={note?.[f.name] ?? ""}
            className="input w-full"
          />
        </div>
      ))}
    </>
  );
}

export default async function ProntuarioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: patientId } = await params;
  const { tenantId, userId, role } = await getTenantContext();
  requireCapability(role, "clinical");
  const supabase = await createClient();

  const { data: patient } = await supabase
    .from("patients")
    .select("id, full_name, consent_at")
    .eq("id", patientId)
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .single();

  if (!patient) notFound();

  // Abrir o prontuário é um acesso a dado de saúde: fica na trilha
  // (o banco agrupa aberturas repetidas em 5 minutos).
  await supabase.rpc("log_access", {
    p_action: "record.view",
    p_entity: "patient",
    p_entity_id: patientId,
    p_patient_id: patientId,
  });

  const isAdmin = can(role, "audit");

  const [{ data: notes }, { data: integrity }, { data: attachments }, { data: appointments }, auditResult, membersResult] =
    await Promise.all([
      supabase
        .from("clinical_notes")
        .select(
          "id, parent_id, appointment_id, author_id, subjective, objective, assessment, plan, status, signed_at, content_hash, created_at",
        )
        .eq("patient_id", patientId)
        .order("created_at", { ascending: false }),
      supabase.rpc("verify_patient_notes", { p_patient_id: patientId }),
      supabase
        .from("patient_attachments")
        .select("id, file_name, mime_type, size_bytes, description, created_at")
        .eq("patient_id", patientId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false }),
      supabase
        .from("appointments")
        .select("id, starts_at, status")
        .eq("patient_id", patientId)
        .neq("status", "cancelled")
        .order("starts_at", { ascending: false })
        .limit(20),
      isAdmin
        ? supabase
            .from("audit_log")
            .select("id, user_id, action, created_at, metadata")
            .eq("patient_id", patientId)
            .order("created_at", { ascending: false })
            .limit(30)
        : Promise.resolve({ data: null }),
      supabase.from("profiles").select("id, full_name").eq("tenant_id", tenantId),
    ]);

  const nameById = new Map((membersResult.data ?? []).map((m) => [m.id as string, m.full_name as string]));
  const intactById = new Map(((integrity ?? []) as { note_id: string; intact: boolean }[]).map((r) => [r.note_id, r.intact]));
  const allNotes = (notes ?? []) as Note[];
  const addendaByParent = new Map<string, Note[]>();
  for (const n of allNotes) {
    if (n.parent_id) addendaByParent.set(n.parent_id, [...(addendaByParent.get(n.parent_id) ?? []), n]);
  }
  const rootNotes = allNotes.filter((n) => !n.parent_id);
  const apptLabel = (id: string | null) => {
    const a = (appointments ?? []).find((x) => x.id === id);
    return a ? `Consulta de ${formatDateTime(a.starts_at)}` : null;
  };

  function renderNoteBody(note: Note) {
    return (
      <dl className="space-y-2 text-sm">
        {note.parent_id ? (
          <p className="whitespace-pre-wrap text-ink">
            {[note.subjective, note.objective, note.assessment, note.plan].filter(Boolean).join("\n\n")}
          </p>
        ) : (
          FIELDS.filter((f) => note[f.name]).map((f) => (
            <div key={f.name}>
              <dt className="text-xs font-medium text-muted-soft">{f.label}</dt>
              <dd className="whitespace-pre-wrap text-ink">{note[f.name]}</dd>
            </div>
          ))
        )}
      </dl>
    );
  }

  return (
    <main className="flex-1 p-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="heading text-2xl">Prontuário</h1>
            <p className="text-sm text-muted">{patient.full_name}</p>
          </div>
          <Link href={`/dashboard/pacientes/${patientId}`} className="link-accent text-sm">
            Cadastro do paciente
          </Link>
        </div>

        <Suspense fallback={null}>
          <Toast />
        </Suspense>

        {!patient.consent_at ? (
          <form action={registerConsent} className="card space-y-3 border-amber-300 p-4">
            <input type="hidden" name="patientId" value={patientId} />
            <p className="text-sm font-medium text-ink">Consentimento (LGPD) pendente</p>
            <label className="flex items-start gap-2 text-sm text-muted">
              <input type="checkbox" name="confirm" className="mt-1" />
              O paciente foi informado sobre o tratamento dos seus dados de saúde e concordou com o
              registro neste sistema.
            </label>
            <SubmitButton pendingText="Registrando..." className="btn-primary px-3 py-1.5 text-sm">
              Registrar consentimento
            </SubmitButton>
            <p className="text-xs text-muted-soft">
              Sem o consentimento registrado não é possível criar evoluções.
            </p>
          </form>
        ) : (
          <p className="text-xs text-muted-soft">
            Consentimento registrado em {formatDateTime(patient.consent_at)}. Evoluções assinadas não podem
            ser alteradas nem apagadas — correções são feitas por adendo.
          </p>
        )}

        {patient.consent_at && (
          <form action={saveNote} className="card space-y-3 p-4">
            <input type="hidden" name="patientId" value={patientId} />
            <h2 className="font-medium text-ink">Nova evolução</h2>
            <div className="space-y-1">
              <label htmlFor="appointmentId" className="text-sm font-medium text-ink">
                Consulta relacionada <span className="font-normal text-muted-soft">(opcional)</span>
              </label>
              <select id="appointmentId" name="appointmentId" className="input w-full">
                <option value="">—</option>
                {(appointments ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {formatDateTime(a.starts_at)}
                  </option>
                ))}
              </select>
            </div>
            <NoteFieldsInputs />
            <div className="flex flex-wrap gap-2">
              <SubmitButton name="intent" value="draft" pendingText="Salvando..." className="btn-secondary px-3 py-1.5 text-sm">
                Salvar rascunho
              </SubmitButton>
              <SubmitButton name="intent" value="sign" pendingText="Assinando..." className="btn-primary px-3 py-1.5 text-sm">
                Assinar evolução
              </SubmitButton>
            </div>
          </form>
        )}

        <section className="space-y-3">
          <h2 className="font-medium text-ink">Evoluções</h2>
          {rootNotes.length === 0 ? (
            <EmptyState
              title="Nenhuma evolução registrada"
              description="Registre a primeira evolução acima, depois de confirmar o consentimento."
            />
          ) : (
            rootNotes.map((note) => {
              const addenda = (addendaByParent.get(note.id) ?? []).slice().reverse();
              const mine = note.author_id === userId;

              return (
                <article key={note.id} className="card space-y-3 p-4">
                  <header className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-soft">
                    <span>
                      {formatDateTime(note.created_at)} · {nameById.get(note.author_id) ?? "—"}
                      {apptLabel(note.appointment_id) && ` · ${apptLabel(note.appointment_id)}`}
                    </span>
                    {note.status === "signed" ? (
                      <span className={intactById.get(note.id) === false ? "font-medium text-red-600" : "font-medium text-accent"}>
                        {intactById.get(note.id) === false
                          ? "⚠ Integridade violada"
                          : `✓ Assinada em ${formatDateTime(note.signed_at!)}`}
                      </span>
                    ) : (
                      <span className="font-medium text-amber-700">Rascunho</span>
                    )}
                  </header>

                  {note.status === "draft" && mine ? (
                    <form action={saveNote} className="space-y-3">
                      <input type="hidden" name="patientId" value={patientId} />
                      <input type="hidden" name="noteId" value={note.id} />
                      <NoteFieldsInputs note={note} />
                      <div className="flex flex-wrap gap-2">
                        <SubmitButton name="intent" value="draft" pendingText="Salvando..." className="btn-secondary px-3 py-1.5 text-sm">
                          Salvar rascunho
                        </SubmitButton>
                        <SubmitButton name="intent" value="sign" pendingText="Assinando..." className="btn-primary px-3 py-1.5 text-sm">
                          Assinar evolução
                        </SubmitButton>
                      </div>
                    </form>
                  ) : (
                    renderNoteBody(note)
                  )}

                  {note.status === "draft" && mine && (
                    <form action={deleteDraft}>
                      <input type="hidden" name="patientId" value={patientId} />
                      <input type="hidden" name="noteId" value={note.id} />
                      <ConfirmSubmitButton
                        confirmMessage="Apagar este rascunho?"
                        pendingText="..."
                        className="text-xs font-medium text-red-600 hover:text-red-700"
                      >
                        apagar rascunho
                      </ConfirmSubmitButton>
                    </form>
                  )}

                  {note.status === "signed" && (
                    <p className="break-all text-[11px] text-muted-soft">SHA-256: {note.content_hash}</p>
                  )}

                  {addenda.map((ad) => (
                    <div key={ad.id} className="space-y-2 border-l-2 border-accent-soft pl-3">
                      <p className="text-xs text-muted-soft">
                        Adendo · {formatDateTime(ad.created_at)} · {nameById.get(ad.author_id) ?? "—"}
                        {ad.status === "signed" ? (
                          <span className={intactById.get(ad.id) === false ? " font-medium text-red-600" : " text-accent"}>
                            {intactById.get(ad.id) === false ? " · ⚠ Integridade violada" : " · ✓ assinado"}
                          </span>
                        ) : (
                          " · rascunho"
                        )}
                      </p>
                      {ad.status === "draft" && ad.author_id === userId ? (
                        <form action={saveNote} className="space-y-2">
                          <input type="hidden" name="patientId" value={patientId} />
                          <input type="hidden" name="noteId" value={ad.id} />
                          <textarea name="subjective" rows={3} maxLength={20000} defaultValue={ad.subjective} className="input w-full" aria-label="Texto do adendo" />
                          <div className="flex gap-2">
                            <SubmitButton name="intent" value="draft" pendingText="..." className="btn-secondary px-2 py-1 text-xs">
                              Salvar
                            </SubmitButton>
                            <SubmitButton name="intent" value="sign" pendingText="..." className="btn-primary px-2 py-1 text-xs">
                              Assinar adendo
                            </SubmitButton>
                          </div>
                        </form>
                      ) : (
                        renderNoteBody(ad)
                      )}
                    </div>
                  ))}

                  {note.status === "signed" && (
                    <details className="text-sm">
                      <summary className="cursor-pointer text-xs font-medium text-accent">Adicionar adendo</summary>
                      <form action={saveNote} className="mt-2 space-y-2">
                        <input type="hidden" name="patientId" value={patientId} />
                        <input type="hidden" name="parentId" value={note.id} />
                        <textarea
                          name="subjective"
                          rows={3}
                          maxLength={20000}
                          required
                          className="input w-full"
                          aria-label="Texto do adendo"
                          placeholder="Complemento ou correção desta evolução"
                        />
                        <div className="flex gap-2">
                          <SubmitButton name="intent" value="draft" pendingText="..." className="btn-secondary px-2 py-1 text-xs">
                            Salvar rascunho
                          </SubmitButton>
                          <SubmitButton name="intent" value="sign" pendingText="..." className="btn-primary px-2 py-1 text-xs">
                            Assinar adendo
                          </SubmitButton>
                        </div>
                      </form>
                    </details>
                  )}
                </article>
              );
            })
          )}
        </section>

        <section className="card space-y-3 p-4">
          <h2 className="font-medium text-ink">Anexos</h2>
          {(attachments ?? []).length === 0 ? (
            <p className="text-sm text-muted-soft">Nenhum arquivo anexado.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {(attachments ?? []).map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div>
                    <a
                      href={`/dashboard/pacientes/${patientId}/prontuario/anexo/${a.id}`}
                      className="font-medium text-accent hover:underline"
                    >
                      {a.file_name}
                    </a>
                    <p className="text-xs text-muted-soft">
                      {formatBytes(a.size_bytes)} · {formatDateTime(a.created_at)}
                      {a.description && ` · ${a.description}`}
                    </p>
                  </div>
                  <form action={removeAttachment}>
                    <input type="hidden" name="patientId" value={patientId} />
                    <input type="hidden" name="id" value={a.id} />
                    <ConfirmSubmitButton
                      confirmMessage="Remover este anexo da lista? O arquivo é mantido por exigência de retenção."
                      pendingText="..."
                      className="text-xs font-medium text-red-600 hover:text-red-700"
                    >
                      remover
                    </ConfirmSubmitButton>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <form action={uploadAttachment} className="flex flex-wrap items-end gap-3 border-t border-border pt-3">
            <input type="hidden" name="patientId" value={patientId} />
            <div className="space-y-1">
              <label htmlFor="file" className="text-xs font-medium text-ink">
                Arquivo (PDF, PNG, JPG ou WEBP, até 10 MB)
              </label>
              <input id="file" name="file" type="file" required accept="application/pdf,image/png,image/jpeg,image/webp" className="block text-sm" />
            </div>
            <div className="min-w-40 flex-1 space-y-1">
              <label htmlFor="description" className="text-xs font-medium text-ink">
                Descrição (opcional)
              </label>
              <input id="description" name="description" maxLength={300} className="input w-full" />
            </div>
            <SubmitButton pendingText="Enviando..." className="btn-secondary px-3 py-1.5 text-sm">
              Anexar
            </SubmitButton>
          </form>
        </section>

        {isAdmin && (
          <section className="card space-y-2 p-4">
            <h2 className="font-medium text-ink">Trilha de acessos</h2>
            <p className="text-xs text-muted-soft">
              Registro imutável de quem abriu, baixou ou alterou o prontuário deste paciente (últimos 30).
            </p>
            <ul className="divide-y divide-border text-sm">
              {(auditResult.data ?? []).map((e) => (
                <li key={e.id} className="flex justify-between gap-3 py-1.5">
                  <span className="text-ink">
                    {nameById.get(e.user_id as string) ?? "Sistema"} · {AUDIT_LABEL[e.action as string] ?? e.action}
                  </span>
                  <span className="shrink-0 text-xs text-muted-soft">{formatDateTime(e.created_at as string)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}
