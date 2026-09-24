import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

type Item = { sku: string; title: string; quantity: number };
type Shipment = { id: string; orderIds: string[]; buyer: string; items: Item[] };
type Batch = { id: string; mode: string; dispatch_day: string; shipments: Shipment[] };

function printable(value: unknown) {
  return String(value ?? "").replace(/[\u2018\u2019]/g, "'").replace(/[\u2013\u2014]/g, "-")
    .replace(/[^\x20-\x7e\xa0-\xff]/g, "?");
}

export async function batchPdf(batch: Batch, kind: "control" | "preparation" | "summary") {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const width = 595.28;
  const height = 841.89;
  const margin = 42;
  let page = pdf.addPage([width, height]);
  let y = height - margin;
  const lineHeight = 15;

  if (kind === "preparation") {
    const ink = rgb(0.13, 0.13, 0.13);
    const gray = rgb(0.62, 0.62, 0.62);
    const columns = { check: margin + 6, sku: margin + 38, product: margin + 125, quantity: width - margin - 58 };
    const totals = new Map<string, { title: string; quantity: number }>();
    for (const shipment of batch.shipments) for (const item of shipment.items) {
      const current = totals.get(item.sku) || { title: item.title, quantity: 0 };
      current.quantity += item.quantity;
      totals.set(item.sku, current);
    }
    const header = () => {
      page.drawText("Hoja de preparación", { x: margin, y: height - 62, font: bold, size: 17, color: ink });
      page.drawText("Buscar en depósito · total por producto", { x: margin, y: height - 82, font: regular, size: 10, color: rgb(0.35, 0.35, 0.35) });
      page.drawText(`${batch.mode === "self_service" ? "Flex" : "Colecta"} | Despacho ${batch.dispatch_day} | ${batch.shipments.length} envíos`, { x: margin, y: height - 98, font: regular, size: 8, color: rgb(0.35, 0.35, 0.35) });
      page.drawRectangle({ x: margin, y: height - 128, width: width - 2 * margin, height: 20, color: gray });
      page.drawText("✓", { x: columns.check, y: height - 121, font: bold, size: 9, color: rgb(1, 1, 1) });
      page.drawText("SKU", { x: columns.sku, y: height - 121, font: bold, size: 9, color: rgb(1, 1, 1) });
      page.drawText("PRODUCTO", { x: columns.product, y: height - 121, font: bold, size: 9, color: rgb(1, 1, 1) });
      page.drawText("CANT.", { x: columns.quantity, y: height - 121, font: bold, size: 9, color: rgb(1, 1, 1) });
      y = height - 148;
    };
    header();
    for (const [sku, item] of [...totals].sort(([a], [b]) => a.localeCompare(b))) {
      if (y < margin + 30) { page = pdf.addPage([width, height]); header(); }
      page.drawRectangle({ x: margin + 5, y: y - 7, width: 10, height: 10, borderWidth: 1, borderColor: ink });
      page.drawText(printable(sku), { x: columns.sku, y, font: bold, size: 9, color: ink });
      const product = printable(item.title).slice(0, 58);
      page.drawText(product, { x: columns.product, y, font: regular, size: 9, color: ink });
      page.drawText(String(item.quantity), { x: columns.quantity, y, font: bold, size: 9, color: ink });
      y -= 19;
      page.drawLine({ start: { x: margin, y: y + 5 }, end: { x: width - margin, y: y + 5 }, thickness: 0.5, color: rgb(0.78, 0.78, 0.78) });
    }
    return pdf.save();
  }

  if (kind === "control") {
    const leftX = margin;
    const rightX = 250;
    const rightWidth = width - margin - rightX;
    const gray = rgb(0.62, 0.62, 0.62);
    const ink = rgb(0.13, 0.13, 0.13);
    const wrap = (value: unknown, font: typeof regular, size: number, maxWidth: number) => {
      const lines: string[] = [];
      let segment = "";
      for (const word of printable(value).split(/\s+/)) {
        const candidate = segment ? `${segment} ${word}` : word;
        if (segment && font.widthOfTextAtSize(candidate, size) > maxWidth) { lines.push(segment); segment = word; }
        else segment = candidate;
      }
      if (segment) lines.push(segment);
      return lines;
    };
    const drawLines = (lines: string[], x: number, top: number, font: typeof regular, size: number, spacing: number) => {
      lines.forEach((value, index) => page.drawText(value, { x, y: top - index * spacing, font, size, color: ink }));
    };
    const header = () => {
      page.drawText("Control de preparación de envíos", { x: margin, y: height - 64, font: regular, size: 9, color: ink });
      page.drawText("ADARA", { x: width - margin - 48, y: height - 64, font: bold, size: 11, color: ink });
      page.drawText(`${batch.mode === "self_service" ? "Flex" : "Colecta"}  |  Despacho ${batch.dispatch_day}  |  ${batch.shipments.length} envíos`, { x: margin, y: height - 82, font: regular, size: 8, color: rgb(0.35, 0.35, 0.35) });
      page.drawRectangle({ x: margin, y: height - 124, width: width - 2 * margin, height: 22, color: gray });
      page.drawText("Identificación", { x: leftX + 5, y: height - 117, font: bold, size: 9, color: rgb(1, 1, 1) });
      page.drawText("Productos", { x: rightX + 5, y: height - 117, font: bold, size: 9, color: rgb(1, 1, 1) });
      y = height - 142;
    };
    header();
    for (const shipment of batch.shipments) {
      const leftBuyer = wrap(shipment.buyer, regular, 8, rightX - leftX - 17);
      const leftHeight = 12 + 11 + leftBuyer.length * 10;
      const products = shipment.items.map((item) => ({ item, title: wrap(item.title, bold, 8, rightWidth - 27) }));
      const productsHeight = products.reduce((total, product) => total + product.title.length * 10 + 22 + 7, 0);
      const rowHeight = Math.max(leftHeight, productsHeight) + 12;
      if (y - rowHeight < margin + 12) { page = pdf.addPage([width, height]); header(); }
      const top = y;
      page.drawText(printable(shipment.id), { x: leftX + 5, y: top, font: bold, size: 9, color: ink });
      drawLines(wrap(`Venta: ${shipment.orderIds.join(", ")}`, regular, 8, rightX - leftX - 17), leftX + 5, top - 12, regular, 8, 10);
      drawLines(leftBuyer, leftX + 5, top - 25, regular, 8, 10);
      let productY = top;
      for (const product of products) {
        page.drawRectangle({ x: rightX + 4, y: productY - 7, width: 10, height: 10, borderWidth: 1, borderColor: ink });
        drawLines(product.title, rightX + 21, productY, bold, 8, 10);
        productY -= product.title.length * 10 + 2;
        page.drawText(`SKU: ${printable(product.item.sku)}`, { x: rightX + 21, y: productY, font: regular, size: 8, color: ink });
        page.drawText(`Cantidad: ${product.item.quantity}`, { x: rightX + 21, y: productY - 10, font: regular, size: 8, color: ink });
        productY -= 29;
      }
      y = top - rowHeight;
      page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 0.6, color: rgb(0.76, 0.76, 0.76) });
      y -= 14;
    }
    for (const [index, sheet] of pdf.getPages().entries()) {
      sheet.drawText("Control generado por ADARA; no es la hoja oficial de Mercado Libre.", { x: margin, y: 25, font: regular, size: 7, color: rgb(0.42, 0.42, 0.42) });
      sheet.drawText(`${index + 1} / ${pdf.getPageCount()}`, { x: width - margin - 24, y: 25, font: regular, size: 7, color: rgb(0.42, 0.42, 0.42) });
    }
    return pdf.save();
  }

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
  line("RESUMEN DE PEDIDOS", true, 17);
  y -= 4;
  line(`Lote: ${batch.id}`);
  line(`Modalidad: ${batch.mode === "self_service" ? "Flex" : "Colecta"}  |  Despacho: ${batch.dispatch_day}  |  Envios: ${batch.shipments.length}`);
  y -= 12;

  {
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
    line(`Envio ${shipment.id}  |  Venta ${shipment.orderIds.join(", ")}`, true, 11);
    line(`Cliente: ${shipment.buyer}`, false, 9, 12);
    for (const item of shipment.items) {
      line(`${item.quantity} x ${item.sku} - ${item.title}`, false, 10, 12);
    }
    y -= 4;
  }
  return pdf.save();
}
