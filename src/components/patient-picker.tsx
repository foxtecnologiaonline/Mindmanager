"use client";

import { useRef, useState } from "react";

type Patient = { id: string; fullName: string; phone: string; email: string | null };

// Combina "escolher da lista" com "digitar na mão": selecionar um
// paciente cadastrado preenche nome/telefone/e-mail nos mesmos campos
// que o agendamento manual já usava — continuam editáveis (paciente
// novo, ou dado desatualizado) e são o que o form realmente envia pro
// server action, sem mudar o shape do FormData.
export function PatientPicker({
  patients,
  initialPatientId,
}: {
  patients: Patient[];
  initialPatientId?: string;
}) {
  const nameRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const [selectedId, setSelectedId] = useState(initialPatientId ?? "");
  const initialPatient = patients.find((p) => p.id === initialPatientId);

  function handleSelect(id: string) {
    setSelectedId(id);
    const patient = patients.find((p) => p.id === id);
    if (!patient || !nameRef.current || !phoneRef.current || !emailRef.current) {
      return;
    }
    nameRef.current.value = patient.fullName;
    phoneRef.current.value = patient.phone;
    emailRef.current.value = patient.email ?? "";
  }

  return (
    <>
      <div className="col-span-2 space-y-1">
        <label className="font-medium text-ink">Paciente cadastrado (opcional)</label>
        <select
          value={selectedId}
          onChange={(e) => handleSelect(e.target.value)}
          className="input"
        >
          <option value="">Novo paciente — preencher abaixo</option>
          {patients.map((p) => (
            <option key={p.id} value={p.id}>
              {p.fullName} — {p.phone}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <label className="font-medium text-ink">Nome do paciente</label>
        <input
          ref={nameRef}
          name="patientName"
          required
          defaultValue={initialPatient?.fullName}
          className="input"
        />
      </div>
      <div className="space-y-1">
        <label className="font-medium text-ink">Telefone</label>
        <input
          ref={phoneRef}
          name="patientPhone"
          required
          placeholder="55119..."
          defaultValue={initialPatient?.phone}
          className="input"
        />
      </div>
      <div className="space-y-1">
        <label className="font-medium text-ink">E-mail (opcional)</label>
        <input
          ref={emailRef}
          name="patientEmail"
          type="email"
          defaultValue={initialPatient?.email ?? ""}
          className="input"
        />
      </div>
    </>
  );
}
