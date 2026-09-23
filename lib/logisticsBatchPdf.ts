import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

type Item = { sku: string; title: string; quantity: number };
type Shipment = { id: string; orderIds: string[]; buyer: string; items: Item[] };
type Batch = { id: string; mode: string; dispatch_day: string; shipments: Shipment[] };

function printable(value: unknown) {
  return String(value ?? "").replace(/[\u2018\u2019]/g, "'").replace(/[\u2013\u2014]/g, "-")
    .replace(/[^\x20-\x7e\xa0-\xff]/g, "?");
}

export async function batchPdf(batch: Batch, kind: "control" | "summary") {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const width = 595.28;
  const height = 841.89;
  const margin = 42;
  let page = pdf.addPage([width, height]);
  let y = height - margin;
  const lineHeight = 15;

  function nextPage() {
    page = pdf.addPage([width, height]);
    y = height - margin;
  }
  function line(value: unknown, emphasis = false, size = 10, indent = 0) {
    const font = emphasis ? bold : regular;
    const maxWidth = width - 2 * margin - indent;
    const words = printable(value).split(/\s+/);
    let segment = "";
    const draw = (text: string) => {
      if (y < margin + lineHeight) nextPage();
      page.drawText(text, { x: margin + indent, y, font, size, color: rgb(0.08, 0.1, 0.14) });
      y -= lineHeight;
    };
    for (const word of words) {
      const candidate = segment ? `${segment} ${word}` : word;
      if (segment && font.widthOfTextAtSize(candidate, size) > maxWidth) { draw(segment); segment = word; }
      else segment = candidate;
    }
    if (segment) draw(segment);
  }
  const control = kind === "control";
  line(control ? "HOJA DE CONTROL ADARA" : "RESUMEN DE PEDIDOS", true, 17);
  y -= 4;
  if (control) line("Documento ADARA: no reemplaza la hoja oficial de Mercado Libre.", false, 9);
  line(`Lote: ${batch.id}`);
  line(`Modalidad: ${batch.mode === "self_service" ? "Flex" : "Colecta"}  |  Despacho: ${batch.dispatch_day}  |  Envios: ${batch.shipments.length}`);
  y -= 12;

  if (!control) {
    const totals = new Map<string, { title: string; quantity: number }>();
    for (const shipment of batch.shipments) for (const item of shipment.items) {
      const current = totals.get(item.sku) || { title: item.title, quantity: 0 };
      current.quantity += item.quantity;
      totals.set(item.sku, current);
    }
    line("TOTAL POR PRODUCTO", true, 12);
    for (const [sku, item] of [...totals].sort(([a], [b]) => a.localeCompare(b))) {
      line(`${item.quantity} x ${sku} - ${item.title}`, false, 10, 12);
    }
    y -= 12;
    line("DETALLE POR ENVIO", true, 12);
  }

  for (const shipment of batch.shipments) {
    if (y < margin + 80) nextPage();
    y -= 8;
    line(`${control ? "[ ] " : ""}Envio ${shipment.id}  |  Venta ${shipment.orderIds.join(", ")}`, true, 11);
    line(`Cliente: ${shipment.buyer}`, false, 9, 12);
    for (const item of shipment.items) {
      line(`${control ? "[ ] " : ""}${item.quantity} x ${item.sku} - ${item.title}`, false, 10, 12);
    }
    y -= 4;
  }
  return pdf.save();
}
