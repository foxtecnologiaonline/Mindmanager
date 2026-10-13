import { NextResponse, type NextRequest } from "next/server";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/tenant";
import { can } from "@/lib/permissions";
import { stripDiacritics } from "@/lib/text";
import { formatCents } from "@/lib/billing/money";
import { methodLabel } from "@/lib/billing/payment-method";

const BR_DATE = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" });

const STATUS_LABEL: Record<string, string> = {
  pending: "Pendente",
  paid: "Pago",
  cancelled: "Cancelado",
};

// Mesma limitação do recibo (migration do recibo, fase C): Helvetica
// padrão só cobre Latin-1.
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

const PAGE_WIDTH = 560;
const PAGE_HEIGHT = 760;
const MARGIN = 40;
const ROW_HEIGHT = 20;

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: patientId } = await params;
  const { tenantName, role } = await getTenantContext();

  if (!can(role, "finance")) {
    return new NextResponse("Sem permissão.", { status: 403 });
  }

  const supabase = await createClient();

  const [{ data: patient }, { data: invoices }] = await Promise.all([
    supabase
      .from("patients")
      .select("full_name")
      .eq("id", patientId)
      .is("deleted_at", null)
      .single(),
    supabase
      .from("invoices")
      .select("amount_cents, status, method, paid_at, notes, created_at")
      .eq("patient_id", patientId)
      .order("created_at", { ascending: true }),
  ]);

  if (!patient) {
    return new NextResponse("Paciente não encontrado.", { status: 404 });
  }

  const rows = invoices ?? [];
  const pendingTotal = rows.filter((r) => r.status === "pending").reduce((s, r) => s + r.amount_cents, 0);
  const paidTotal = rows.filter((r) => r.status === "paid").reduce((s, r) => s + r.amount_cents, 0);

  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.08, 0.14, 0.12);
  const muted = rgb(0.42, 0.48, 0.46);
  const amber = rgb(0.6, 0.42, 0.05);

  function drawHeader(): { page: PDFPage; y: number } {
    const newPage = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    let cursorY = PAGE_HEIGHT - MARGIN;
    newPage.drawText(safeText(bold, tenantName ?? "Clínica"), { x: MARGIN, y: cursorY, size: 16, font: bold, color: ink });
    cursorY -= 20;
    newPage.drawText(safeText(bold, `Fatura — ${patient!.full_name}`), {
      x: MARGIN,
      y: cursorY,
      size: 13,
      font: bold,
      color: ink,
    });
    cursorY -= 16;
    newPage.drawText(`Gerada em ${BR_DATE.format(new Date())}`, { x: MARGIN, y: cursorY, size: 9, font: regular, color: muted });
    cursorY -= 20;
    newPage.drawLine({ start: { x: MARGIN, y: cursorY }, end: { x: PAGE_WIDTH - MARGIN, y: cursorY }, thickness: 0.5, color: muted });
    cursorY -= 18;

    const headers: [string, number][] = [["Data", 0], ["Descrição", 90], ["Forma", 320], ["Status", 400], ["Valor", 470]];
    for (const [label, x] of headers) {
      newPage.drawText(label, { x: MARGIN + x, y: cursorY, size: 9, font: bold, color: muted });
    }
    cursorY -= 14;
    return { page: newPage, y: cursorY };
  }

  let page: PDFPage;
  let y: number;
  ({ page, y } = drawHeader());

  for (const inv of rows) {
    if (y < MARGIN + 60) {
      ({ page, y } = drawHeader());
    }

    const statusColor = inv.status === "paid" ? ink : inv.status === "cancelled" ? muted : amber;
    const description = inv.notes ? safeText(regular, inv.notes).slice(0, 38) : "Cobrança";

    page.drawText(BR_DATE.format(new Date(inv.created_at)), { x: MARGIN, y, size: 9, font: regular, color: ink });
    page.drawText(description, { x: MARGIN + 90, y, size: 9, font: regular, color: ink });
    page.drawText(inv.status === "paid" ? methodLabel(inv.method) : "—", {
      x: MARGIN + 320,
      y,
      size: 9,
      font: regular,
      color: ink,
    });
    page.drawText(STATUS_LABEL[inv.status] ?? inv.status, { x: MARGIN + 400, y, size: 9, font: regular, color: statusColor });
    const amount = formatCents(inv.amount_cents);
    page.drawText(amount, { x: PAGE_WIDTH - MARGIN - bold.widthOfTextAtSize(amount, 9), y, size: 9, font: bold, color: ink });

    y -= ROW_HEIGHT;
  }

  if (rows.length === 0) {
    page.drawText("Nenhuma cobrança registrada para este paciente.", { x: MARGIN, y, size: 10, font: regular, color: muted });
    y -= ROW_HEIGHT;
  }

  if (y < MARGIN + 60) {
    ({ page, y } = drawHeader());
  }
  y -= 10;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_WIDTH - MARGIN, y }, thickness: 0.5, color: muted });
  y -= 18;

  const totals: [string, string][] = [
    ["Total pendente", formatCents(pendingTotal)],
    ["Total pago (histórico)", formatCents(paidTotal)],
  ];
  for (const [label, value] of totals) {
    page.drawText(label, { x: MARGIN, y, size: 10, font: regular, color: muted });
    const v = safeText(bold, value);
    page.drawText(v, { x: PAGE_WIDTH - MARGIN - bold.widthOfTextAtSize(v, 11), y, size: 11, font: bold, color: ink });
    y -= 18;
  }

  const bytes = await pdf.save();
  const fileName = `fatura-${stripDiacritics(patient.full_name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}.pdf`;

  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
