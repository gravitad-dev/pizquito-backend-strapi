/**
 * PDF Generator for Invoices (matrículas) and Payrolls (nóminas)
 */

import PDFDocument from "pdfkit";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

type InvoiceEntity = {
  id: number;
  uid?: string;
  title?: string;
  notes?: string;
  invoiceStatus?: string;
  invoiceType?: string;
  invoiceCategory?: string;
  total?: number;
  IVA?: number;
  amounts?: Record<string, number> | null;
  emissionDate?: string;
  expirationDate?: string;
  enrollment?: any;
  employee?: any;
};

const fetchCompany = async () => {
  const company = await (global as any).strapi.entityService.findMany(
    "api::company.company",
    {
      limit: 1,
      filters: {},
      fields: ["name", "NIF", "address", "code"],
    },
  );
  return Array.isArray(company) ? company[0] : company;
};

const fetchInvoice = async (id: number): Promise<InvoiceEntity | null> => {
  const inv = await (global as any).strapi.entityService.findOne(
    "api::invoice.invoice",
    id,
    {
      populate: {
        enrollment: { populate: { student: true } },
        employee: true,
      },
    },
  );
  return inv ?? null;
};

const currency = (n?: number) =>
  (typeof n === "number" ? n : 0).toLocaleString("es-ES", {
    style: "currency",
    currency: "EUR",
  });

const prettyDate = (d?: string) => (d ? new Date(d).toLocaleDateString("es-ES") : "-");

// Friendly labels (ES)
const prettyStatus = (s?: string) => {
  const map: Record<string, string> = {
    paid: "Pagado",
    pending: "Pendiente",
    cancelled: "Cancelada",
    canceled: "Cancelada",
    unpaid: "No pagado",
  };
  return s ? map[s] ?? s : "-";
};

const prettyCategory = (c?: string) => {
  const map: Record<string, string> = {
    invoice_enrollment: "Factura de matrícula",
    invoice_service: "Factura de servicio",
    invoice_employ: "Nómina",
    invoice: "Factura",
  };
  if (!c) return "-";
  return map[c] ?? c.replace(/_/g, " ").replace(/\binvoice\b/i, "Factura");
};

const addHeader = (doc: PDFDocument, company: any, title: string) => {
  // Header bar
  doc.rect(0, 0, doc.page.width, 80).fill("#2F5597");
  doc.fillColor("#ffffff").fontSize(20).text(company?.name || "", 40, 25, {
    align: "left",
  });
  doc.fontSize(10).text(`NIF: ${company?.NIF || "-"}`, 40, 50);
  doc.fontSize(10).text(company?.address || "", 40, 65);

  // Title
  doc.fillColor("#2F5597").fontSize(26).text(title, 40, 110);

  // Reset to black for body
  doc.fillColor("#000000");
};

const addFooter = (doc: PDFDocument) => {
  const y = doc.page.height - 60;
  doc.strokeColor("#cccccc").moveTo(40, y).lineTo(doc.page.width - 40, y).stroke();
  doc.fontSize(9).fillColor("#666666").text("Generado por Pizquito", 40, y + 10, {
    align: "left",
  });
  doc.fillColor("#666666").text(new Date().toLocaleString("es-ES"), 40, y + 10, {
    align: "right",
  });
  doc.fillColor("#000000");
};

const addKeyValue = (
  doc: PDFDocument,
  label: string,
  value: string,
  x: number,
  y: number,
  width = 250,
) => {
  doc.fontSize(10).fillColor("#666").text(label, x, y);
  doc.fontSize(12).fillColor("#000").text(value, x, y + 14, { width });
};

const addAmountsTable = (
  doc: PDFDocument,
  amounts: Record<string, number> | null | undefined,
  startY: number,
) => {
  const entries = Object.entries(amounts || {}).filter(([_, v]) => typeof v === "number");
  const left = (doc.page as any).margins?.left ?? 40;
  const right = doc.page.width - ((doc.page as any).margins?.right ?? 40);
  const tableWidth = right - left; // full usable width inside margins
  const x = left;
  const amountColWidth = 200; // width for the amount column
  const col2 = right - amountColWidth - 10; // start position for amount text
  let y = startY;

  // Header
  doc.rect(x, y, tableWidth, 24).fill("#eeeeee");
  doc.fillColor("#000").fontSize(12).text("Concepto", x + 10, y + 6);
  doc.text("Importe", col2 + 10, y + 6);
  y += 30;

  // Helper function to format concept names with special cases
  const formatConceptName = (key: string): string => {
    const specialCases: Record<string, string> = {
      'subvencion': 'Subvención',
      'subvencion_comedor': 'Subvención Comedor',
      'beca': 'Beca',
      'descuento': 'Descuento',
      'comedor': 'Comedor',
      'matricula': 'Matrícula',
      'transporte': 'Transporte',
      'material': 'Material',
    };
    
    const normalized = key.toLowerCase().replace(/_/g, '_');
    if (specialCases[normalized]) {
      return specialCases[normalized];
    }
    
    // Default transformation - capitalizar cada palabra correctamente
    return key
      .replace(/_/g, " ")
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  };

  // Helper function to check if a concept should be subtracted
  const isSubtractionConcept = (key: string): boolean => {
    const subtractionKeywords = ['subvencion', 'beca', 'descuento', 'ayuda', 'rebaja', 'bonificacion'];
    const normalized = key.toLowerCase();
    return subtractionKeywords.some(keyword => normalized.includes(keyword));
  };

  // Rows
  entries.forEach(([k, v], i) => {
    if (i % 2 === 0) {
      doc.rect(x, y - 6, tableWidth, 24).fill("#f8f8f8");
      doc.fillColor("#000");
    }
    const label = formatConceptName(k);
    // Si es un concepto de descuento/subvención, convertir a negativo para restar
    const displayValue = isSubtractionConcept(k) ? -Math.abs(v) : v;
    
    doc.fontSize(11).text(label, x + 10, y);
    doc.text(currency(displayValue), col2 + 10, y, { width: amountColWidth, align: "right" });
    y += 24;
  });

  return y + 10;
};

const bufferFromDoc = (doc: PDFDocument) =>
  new Promise<Buffer>((resolve) => {
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.end();
  });

const uploadBufferAsFile = async (buf: Buffer, fileName: string, mime = "application/pdf") => {
  const tmpFilePath = path.join(os.tmpdir(), `upload-${Date.now()}-${fileName}`);
  await fs.promises.writeFile(tmpFilePath, buf);
  let uploaded;
  try {
    const uploadService = (global as any).strapi.plugin("upload").service("upload");
    [uploaded] = await uploadService.upload({
      files: {
        filepath: tmpFilePath,
        originalFilename: fileName,
        mimetype: mime,
        size: buf.length,
      },
      data: {
        fileInfo: {
          name: fileName,
          caption: fileName,
          alternativeText: fileName,
        },
      },
    });
  } finally {
    try {
      await fs.promises.unlink(tmpFilePath);
    } catch {}
  }
  return uploaded;
};

export default {
  async generateInvoicePdf(id: number) {
    const company = await fetchCompany();
    const inv = await fetchInvoice(id);
    if (!inv) {
      return { stored: false, url: null, message: `Invoice ${id} not found` };
    }

    const doc = new PDFDocument({ size: "A4", margin: 40 });
    addHeader(doc, company, inv.invoiceCategory === "invoice_employ" ? "Nómina" : "Factura");

    // Meta block
    let y = 150;
    addKeyValue(doc, "Número", inv.uid || String(inv.id), 40, y);
    addKeyValue(doc, "Fecha emisión", prettyDate(inv.emissionDate), 300, y);
    y += 40;
    addKeyValue(doc, "Estado", prettyStatus(inv.invoiceStatus), 40, y);
    addKeyValue(doc, "Tipo", prettyCategory(inv.invoiceCategory), 300, y);
    y += 50;

    // Subject details
    if (inv.invoiceCategory === "invoice_enrollment") {
      const student = inv.enrollment?.student;
      doc.fontSize(16).fillColor("#2F5597").text("Alumno", 40, y);
      doc.fillColor("#000");
      y += 24;
      addKeyValue(doc, "Nombre", `${student?.name || ""} ${student?.lastname || ""}`, 40, y);
      addKeyValue(doc, "DNI", student?.dni || student?.DNI || "-", 300, y);
      y += 40;
    } else if (inv.invoiceCategory === "invoice_employ") {
      const emp = inv.employee;
      doc.fontSize(16).fillColor("#2F5597").text("Empleado", 40, y);
      doc.fillColor("#000");
      y += 24;
      addKeyValue(doc, "Nombre", `${emp?.name || ""} ${emp?.lastname || ""}`, 40, y);
      addKeyValue(doc, "DNI", emp?.DNI || "-", 300, y);
      y += 40;
    }

    // Amounts table
    y = addAmountsTable(doc, inv.amounts || {}, y + 10);

    // Totals
    doc.fontSize(12).fillColor("#000").text(`IVA: ${currency(inv.IVA)}`, 40, y + 10);
    doc.fontSize(16).fillColor("#000").text(`Total: ${currency(inv.total)}`, 300, y + 6, { align: "right" });

    addFooter(doc);

    const buf = await bufferFromDoc(doc);
    const fileName = `${inv.invoiceCategory === "invoice_employ" ? "nomina" : "factura"}_${inv.uid || inv.id}.pdf`;
    const uploaded = await uploadBufferAsFile(buf, fileName);

    return {
      stored: true,
      url: uploaded?.url || null,
      cloudinary: uploaded?.provider_metadata || null,
      meta: {
        fileName,
        invoiceId: inv.id,
        category: inv.invoiceCategory,
      },
    };
  },
  async generateInvoicePdfBuffer(id: number) {
    const company = await fetchCompany();
    const inv = await fetchInvoice(id);
    if (!inv) {
      return { buffer: null, fileName: null, message: `Invoice ${id} not found` };
    }

    const doc = new PDFDocument({ size: "A4", margin: 40 });
    addHeader(doc, company, inv.invoiceCategory === "invoice_employ" ? "Nómina" : "Factura");

    // Meta block
    let y = 150;
    addKeyValue(doc, "Número", inv.uid || String(inv.id), 40, y);
    addKeyValue(doc, "Fecha emisión", prettyDate(inv.emissionDate), 300, y);
    y += 40;
    addKeyValue(doc, "Estado", prettyStatus(inv.invoiceStatus), 40, y);
    addKeyValue(doc, "Tipo", prettyCategory(inv.invoiceCategory), 300, y);
    y += 50;

    // Subject details
    if (inv.invoiceCategory === "invoice_enrollment") {
      const student = inv.enrollment?.student;
      doc.fontSize(16).fillColor("#2F5597").text("Alumno", 40, y);
      doc.fillColor("#000");
      y += 24;
      addKeyValue(doc, "Nombre", `${student?.name || ""} ${student?.lastname || ""}`, 40, y);
      addKeyValue(doc, "DNI", student?.dni || student?.DNI || "-", 300, y);
      y += 40;
    } else if (inv.invoiceCategory === "invoice_employ") {
      const emp = inv.employee;
      doc.fontSize(16).fillColor("#2F5597").text("Empleado", 40, y);
      doc.fillColor("#000");
      y += 24;
      addKeyValue(doc, "Nombre", `${emp?.name || ""} ${emp?.lastname || ""}`, 40, y);
      addKeyValue(doc, "DNI", emp?.DNI || "-", 300, y);
      y += 40;
    }

    // Amounts table
    y = addAmountsTable(doc, inv.amounts || {}, y + 10);

    // Totals
    doc.fontSize(12).fillColor("#000").text(`IVA: ${currency(inv.IVA)}`, 40, y + 10);
    doc.fontSize(16).fillColor("#000").text(`Total: ${currency(inv.total)}`, 300, y + 6, { align: "right" });

    addFooter(doc);

    const buf = await bufferFromDoc(doc);
    const fileName = `${inv.invoiceCategory === "invoice_employ" ? "nomina" : "factura"}_${inv.uid || inv.id}.pdf`;
    return { buffer: buf, fileName, meta: { invoiceId: inv.id, category: inv.invoiceCategory } };
  },
};