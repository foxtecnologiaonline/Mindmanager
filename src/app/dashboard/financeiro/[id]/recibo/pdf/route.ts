import { NextResponse, type NextRequest } from "next/server";
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/tenant";
import { can } from "@/lib/permissions";
import { stripDiacritics } from "@/lib/text";
import { methodLabel } from "@/lib/billing/payment-method";

const BR_DATE = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" });

// Helvetica padrão do PDF só cobre Latin-1: caractere fora disso (ex: emoji
// no nome) derrubaria a geração — troca por "?" em vez de falhar o recibo.
function safeText(font: PDFFont, text: string): string {
  return Array.from(text)
    .map((ch) => {
      try {
        font.encodeText(ch);
        return ch;
      } catch {
        return "?";
      }
    })
    .join("");
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { tenantName, role } = await getTenantContext();

  if (!can(role, "finance")) {
    return new NextResponse("Sem permissão.", { status: 403 });
  }

  const supabase = await createClient();
  const { data: invoice } = await supabase
    .from("invoices")
    .select(
      "id, amount_cents, method, paid_at, patients ( full_name ), appointments ( starts_at, service_types ( name ) )",
    )
    .eq("id", id)
    .eq("status", "paid")
    .single();

  if (!invoice) {
    return new NextResponse("Recibo não encontrado.", { status: 404 });
  }

  const patient = Array.isArray(invoice.patients) ? invoice.patients[0] : invoice.patients;
  const appt = Array.isArray(invoice.appointments) ? invoice.appointments[0] : invoice.appointments;
  const service = appt
    ? Array.isArray(appt.service_types)
      ? appt.service_types[0]
      : appt.service_types
    : null;

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([420, 520]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.08, 0.14, 0.12);
  const muted = rgb(0.42, 0.48, 0.46);

  const centered = (text: string, y: number, size: number, font: PDFFont, color = ink) => {
    const t = safeText(font, text);
    page.drawText(t, { x: (420 - font.widthOfTextAtSize(t, size)) / 2, y, size, font, color });
  };

  centered(tenantName ?? "Clínica", 470, 18, bold);
  centered("Recibo de pagamento", 450, 11, regular, muted);
  page.drawLine({ start: { x: 40, y: 435 }, end: { x: 380, y: 435 }, thickness: 0.5, color: muted });

  const rows: [string, string][] = [
    ["Paciente", patient?.full_name ?? "—"],
    ...(service?.name ? ([["Serviço", service.name]] as [string, string][]) : []),
    ...(appt?.starts_at ? ([["Data da consulta", BR_DATE.format(new Date(appt.starts_at))]] as [string, string][]) : []),
    ["Forma de pagamento", methodLabel(invoice.method)],
    ["Pago em", invoice.paid_at ? BR_DATE.format(new Date(invoice.paid_at)) : "—"],
  ];

  let y = 405;
  for (const [label, value] of rows) {
    page.drawText(safeText(regular, label), { x: 40, y, size: 10, font: regular, color: muted });
    const v = safeText(bold, value);
    page.drawText(v, { x: 380 - bold.widthOfTextAtSize(v, 11), y, size: 11, font: bold, color: ink });
    y -= 26;
  }

  page.drawLine({ start: { x: 40, y: y + 12 }, end: { x: 380, y: y + 12 }, thickness: 0.5, color: muted });
  const amount = (invoice.amount_cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  page.drawText("Valor", { x: 40, y: y - 8, size: 12, font: bold, color: ink });
  const a = safeText(bold, amount);
  page.drawText(a, { x: 380 - bold.widthOfTextAtSize(a, 16), y: y - 10, size: 16, font: bold, color: ink });

  centered(`Recibo gerado por ${tenantName ?? "a clínica"} via MindManager.`, 40, 8, regular, muted);

  const bytes = await pdf.save();
  const fileName = `recibo-${stripDiacritics(patient?.full_name ?? "paciente")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}-${invoice.id.slice(0, 8)}.pdf`;

  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
