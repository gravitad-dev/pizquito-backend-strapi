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
  documentId?: string;
  title?: string;
  notes?: string;
  invoiceStatus?: string;
  invoiceType?: string;
  invoiceCategory?: string;
  registeredBy?: string;
  total?: number;
  IVA?: number;
  amounts?: Record<string, number> | null;
  emissionDate?: string;
  expirationDate?: string;
  enrollment?: any;
  employee?: any;
  guardian?: any; // Guardian directo asociado a la factura
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
        enrollment: {
          populate: {
            student: true,
            guardians: true,
            classroom: true,
          },
        },
        employee: true,
        guardian: true, // Guardian directo asociado a la factura
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

const prettyDate = (d?: string) =>
  d ? new Date(d).toLocaleDateString("es-ES") : "-";

// Mes y año en español con capitalización adecuada (Ej.: "Enero 2024")
const prettyMonthYear = (d?: string) => {
  if (!d) return "-";
  const dt = new Date(d);
  const month = dt.toLocaleDateString("es-ES", { month: "long" });
  const capMonth = month.charAt(0).toUpperCase() + month.slice(1);
  return `${capMonth} ${dt.getFullYear()}`;
};

// Friendly labels (ES)
const prettyStatus = (s?: string) => {
  const map: Record<string, string> = {
    paid: "Pagado",
    pending: "Pendiente",
    cancelled: "Cancelada",
    canceled: "Cancelada",
    unpaid: "No pagado",
  };
  return s ? (map[s] ?? s) : "-";
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

const prettyRegisteredBy = (r?: string) => {
  const map: Record<string, string> = {
    system: "Sistema (Automático)",
    administration: "Administración",
    bank: "Banco",
  };
  // Si no hay valor, asumir que es administración (facturas manuales antiguas)
  const registeredBy = r || "administration";
  return map[registeredBy] ?? registeredBy;
};

/**
 * Obtiene el guardian principal para mostrar en el PDF
 * Prioriza: 1) Guardian directo de la factura, 2) Guardian principal del enrollment
 */
const getPrimaryGuardianForPdf = (inv: InvoiceEntity) => {
  // Prioridad 1: Guardian directo asociado a la factura
  if (inv.guardian) {
    return inv.guardian;
  }
  
  // Prioridad 2: Guardian principal del enrollment (por guardianType)
  const guardians = inv.enrollment?.guardians || [];
  if (guardians.length === 0) return null;
  
  // Orden de prioridad para seleccionar guardian responsable
  const priorityOrder = ['biological_parent', 'adoptive_parent', 'legal_guardian', 'other'];
  
  // Ordenar guardians por prioridad de tipo
  const sortedGuardians = guardians.sort((a: any, b: any) => {
    const aPriority = priorityOrder.indexOf(a.guardianType) !== -1 
      ? priorityOrder.indexOf(a.guardianType) 
      : 999;
    const bPriority = priorityOrder.indexOf(b.guardianType) !== -1 
      ? priorityOrder.indexOf(b.guardianType) 
      : 999;
    return aPriority - bPriority;
  });
  
  return sortedGuardians[0];
};

// Helpers de UI: métricas de página, títulos de sección y badges
const pageMetrics = (doc: PDFDocument) => {
  const left = (doc.page as any).margins?.left ?? 40;
  const right = doc.page.width - ((doc.page as any).margins?.right ?? 40);
  const width = right - left;
  return { left, right, width };
};

const sectionTitle = (
  doc: PDFDocument,
  title: string,
  x: number,
  y: number,
) => {
  doc.fontSize(16).fillColor("#2F5597").text(title, x, y);
  const { left, right } = pageMetrics(doc);
  doc
    .moveTo(left, y + 22)
    .lineTo(right, y + 22)
    .strokeColor("#e0e6ef")
    .lineWidth(1)
    .stroke();
  return y + 28;
};

const addBadge = (
  doc: PDFDocument,
  text: string,
  x: number,
  y: number,
  opts?: { bg?: string; fg?: string },
) => {
  const bg = opts?.bg ?? "#EAF2FB";
  const fg = opts?.fg ?? "#2F5597";
  const padX = 12;
  const padY = 6;
  doc.fontSize(12);
  const tw = doc.widthOfString(text);
  const w = tw + padX * 2;
  const h = 22;
  doc.save();
  // rectángulo redondeado tipo chip
  (doc as any).roundedRect?.(x, y, w, h, 8) ?? doc.rect(x, y, w, h);
  doc.fill(bg);
  (doc as any).roundedRect?.(x, y, w, h, 8) ?? doc.rect(x, y, w, h);
  doc.stroke("#D0E3F7");
  doc.fillColor(fg).text(text, x + padX, y + padY - 1);
  doc.restore();
  return y + h + 10;
};

const addHeader = (
  doc: PDFDocument,
  company: any,
  title: string,
  titleBadge?: string,
) => {
  // Header bar
  doc.rect(0, 0, doc.page.width, 80).fill("#2F5597");
  doc
    .fillColor("#ffffff")
    .fontSize(20)
    .text(company?.name || "", 40, 25, {
      align: "left",
    });
  doc.fontSize(10).text(`NIF: ${company?.NIF || "-"}`, 40, 50);
  doc.fontSize(10).text(`Código: ${company?.code || "-"}`, 200, 50);
  doc.fontSize(10).text(company?.address || "", 40, 65);

  // Title
  doc.fillColor("#2F5597").fontSize(26).text(title, 40, 110);
  if (titleBadge) {
    // Colocar badge a la par del título
    const titleWidth = doc.widthOfString(title);
    const xBadge = 40 + titleWidth + 16;
    const yBadge = 110; // altura alineada con el título
    addBadge(doc, titleBadge, xBadge, yBadge, { bg: "#EAF2FB", fg: "#2F5597" });
  }

  // Reset to black for body
  doc.fillColor("#000000");
};

const addFooter = (doc: PDFDocument, documentId?: string) => {
  // Footer seguro: dibujar sin provocar saltos de página
  const { left, right } = pageMetrics(doc);
  const bottomMargin = (doc.page as any).margins?.bottom ?? 40;
  const y = doc.page.height - bottomMargin - 30;
  const leftText = "Generado por Pizquito";
  const rightText = new Date().toLocaleString("es-ES");
  const centerText = documentId ? documentId : "";

  doc.save();
  doc.strokeColor("#cccccc").moveTo(left, y).lineTo(right, y).stroke();
  doc.fontSize(9).fillColor("#666666");

  // Texto izquierdo
  doc.text(leftText, left, y + 10, { lineBreak: false });

  // Texto derecho
  const rtWidth = doc.widthOfString(rightText);
  doc.text(rightText, right - rtWidth, y + 10, { lineBreak: false });

  // Texto central (documentId) en gris más claro y fuente más pequeña
  if (centerText) {
    doc.fontSize(7).fillColor("#999999");
    const centerWidth = doc.widthOfString(centerText);
    const centerX = left + (right - left) / 2 - centerWidth / 2;
    doc.text(centerText, centerX, y + 12, { lineBreak: false });
  }

  doc.restore();
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
  doc
    .fontSize(10)
    .fillColor("#666")
    .text(label + ":", x, y);
  doc
    .fontSize(10)
    .fillColor("#000")
    .text(value, x + 80, y, { width });
};

const addAmountsTable = (
  doc: PDFDocument,
  amounts: Record<string, number> | null | undefined,
  startY: number,
) => {
  const entries = Object.entries(amounts || {}).filter(
    ([_, v]) => typeof v === "number",
  );
  const left = (doc.page as any).margins?.left ?? 40;
  const right = doc.page.width - ((doc.page as any).margins?.right ?? 40);
  const tableWidth = right - left; // full usable width inside margins
  const x = left;
  const amountColWidth = 200; // width for the amount column
  const col2 = right - amountColWidth; // start position for amount text
  let y = startY;

  // Header
  doc.rect(x, y, tableWidth, 26).fill("#eeeeee");
  doc
    .fillColor("#000")
    .fontSize(12)
    .text("Concepto", x + 10, y + 7);
  doc.text("Importe", col2 + 10, y + 7);
  y += 28;

  // Helper function to format concept names with special cases
  const formatConceptName = (key: string): string => {
    const specialCases: Record<string, string> = {
      subvencion: "Subvención",
      subvencion_comedor: "Subvención Comedor",
      beca: "Beca",
      descuento: "Descuento",
      comedor: "Comedor",
      matricula: "Matrícula",
      transporte: "Transporte",
      material: "Material",
    };

    const normalized = key.toLowerCase().replace(/_/g, "_");
    if (specialCases[normalized]) {
      return specialCases[normalized];
    }

    // Default transformation - capitalizar cada palabra correctamente
    return key
      .replace(/_/g, " ")
      .split(" ")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(" ");
  };

  // Helper function to check if a concept should be subtracted
  const isSubtractionConcept = (key: string): boolean => {
    const subtractionKeywords = [
      "subvencion",
      "beca",
      "descuento",
      "ayuda",
      "rebaja",
      "bonificacion",
    ];
    const normalized = key.toLowerCase();
    return subtractionKeywords.some((keyword) => normalized.includes(keyword));
  };

  // Rows
  entries.forEach(([k, v], i) => {
    if (i % 2 === 0) {
      doc.rect(x, y, tableWidth, 24).fill("#f8f8f8");
      doc.fillColor("#000");
    }
    const label = formatConceptName(k);
    // Si es un concepto de descuento/subvención, convertir a negativo para restar
    const displayValue = isSubtractionConcept(k) ? -Math.abs(v) : v;

    doc.fontSize(11).text(label, x + 10, y + 6);
    doc.text(currency(displayValue), col2 + 10, y + 6, {
      width: amountColWidth - 20,
      align: "right",
    });
    y += 24;
  });

  return y + 10;
};

const bufferFromDoc = (doc: PDFDocument) =>
  new Promise<Buffer>((resolve) => {
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) =>
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
    );
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.end();
  });

const uploadBufferAsFile = async (
  buf: Buffer,
  fileName: string,
  folder: string,
  mime = "application/pdf",
) => {
  const tmpFilePath = path.join(
    os.tmpdir(),
    `upload-${Date.now()}-${fileName}`,
  );
  await fs.promises.writeFile(tmpFilePath, buf);

  try {
    const cloudinary = require("cloudinary").v2;
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_NAME,
      api_key: process.env.CLOUDINARY_KEY,
      api_secret: process.env.CLOUDINARY_SECRET,
    });

    const uploadResult = await cloudinary.uploader.upload(tmpFilePath, {
      folder,
      resource_type: "auto",
      use_filename: false,
      unique_filename: false,
      public_id: fileName.replace('.pdf', ''), // Usar el nombre sin extensión como public_id
    });

    const sizeKB = parseFloat(((buf.length || 0) / 1024).toFixed(2));
    const ext = ".pdf";
    const fileData = {
      name: fileName,
      alternativeText: null,
      caption: null,
      width: uploadResult.width || null,
      height: uploadResult.height || null,
      formats: null,
      hash: (uploadResult.public_id || "").split("/").pop() || undefined,
      ext,
      mime,
      size: sizeKB,
      url: uploadResult.secure_url || uploadResult.url,
      previewUrl: null,
      provider: "cloudinary",
      provider_metadata: {
        public_id: uploadResult.public_id,
        resource_type: uploadResult.resource_type,
      },
      folderPath: folder,
    } as any;

    const savedFile = await (global as any).strapi.entityService.create(
      "plugin::upload.file",
      { data: fileData },
    );
    return savedFile;
  } finally {
    try {
      await fs.promises.unlink(tmpFilePath);
    } catch {}
  }
};

export default {
  async generateInvoicePdf(id: number, reportType?: string) {
    const company = await fetchCompany();
    const inv = await fetchInvoice(id);
    if (!inv) {
      return { stored: false, url: null, message: `Invoice ${id} not found` };
    }

    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const mainTitle =
      inv.invoiceCategory === "invoice_employ" ? "Nómina" : "Factura";
    const titleBadge =
      inv.invoiceCategory === "invoice_employ" ||
      inv.invoiceCategory === "invoice_enrollment"
        ? prettyMonthYear(inv.emissionDate)
        : undefined;
    addHeader(doc, company, mainTitle, titleBadge);

    // Meta block
    let y = 150;
    addKeyValue(doc, "Número", inv.uid || String(inv.id), 40, y);
    addKeyValue(doc, "Fecha emisión", prettyDate(inv.emissionDate), 300, y);
    y += 15;
    addKeyValue(doc, "Estado", prettyStatus(inv.invoiceStatus), 40, y);
    addKeyValue(doc, "Tipo", prettyCategory(inv.invoiceCategory), 300, y);
    y += 15;
    addKeyValue(
      doc,
      "Registrado por",
      prettyRegisteredBy(inv.registeredBy),
      40,
      y,
    );
    y += 25;

    // Espacio adicional antes de los datos del alumno
    y += 15;

    // Subject details
    if (inv.invoiceCategory === "invoice_enrollment") {
      const student = inv.enrollment?.student;
      const classroom = inv.enrollment?.classroom;
      const guardians = inv.enrollment?.guardians;
      const primaryGuardian = getPrimaryGuardianForPdf(inv); // Prioriza guardian directo o principal del enrollment

      y = sectionTitle(doc, "Alumno", 40, y);
      doc.fillColor("#000");
      addKeyValue(
        doc,
        "Nombre",
        `${student?.name || ""} ${student?.lastname || ""}`,
        40,
        y,
      );
      addKeyValue(doc, "DNI", student?.dni || student?.DNI || "-", 300, y);
      y += 20;

      // Información del curso
      if (classroom?.name) {
        addKeyValue(doc, "Curso", classroom.name, 40, y);
        y += 20;
      }

      // Espacio adicional antes de la sección del padre/tutor
      y += 15;

      // Información del guardian principal
      if (primaryGuardian) {
        y = sectionTitle(doc, "Padre/Tutor", 40, y);
        doc.fillColor("#000");
        addKeyValue(
          doc,
          "Nombre",
          `${primaryGuardian.name || ""} ${primaryGuardian.lastname || ""}`,
          40,
          y,
        );
        addKeyValue(
          doc,
          "DNI",
          primaryGuardian.DNI || primaryGuardian.dni || "-",
          300,
          y,
        );
        y += 20;
      }

      y += 20; // Espacio adicional antes de la siguiente sección

      // Periodo se muestra junto al título en el encabezado
    } else if (inv.invoiceCategory === "invoice_employ") {
      const emp = inv.employee;
      y = sectionTitle(doc, "Empleado", 40, y);
      doc.fillColor("#000");
      addKeyValue(
        doc,
        "Nombre",
        `${emp?.name || ""} ${emp?.lastname || ""}`,
        40,
        y,
      );
      addKeyValue(doc, "DNI", emp?.DNI || "-", 300, y);
      y += 20;

      // Fecha de nacimiento del empleado
      if (emp?.birthdate) {
        addKeyValue(
          doc,
          "Fecha de Nacimiento",
          prettyDate(emp.birthdate),
          40,
          y,
        );
        y += 20;
      }

      y += 20; // Espacio adicional antes de la siguiente sección

      // Periodo se muestra junto al título en el encabezado
    }

    // Amounts table
    y = addAmountsTable(doc, inv.amounts || {}, y + 10);

    // Totals
    doc
      .fontSize(12)
      .fillColor("#000")
      .text(`IVA: ${currency(inv.IVA)}`, 40, y + 10);
    doc
      .fontSize(16)
      .fillColor("#000")
      .text(`Total: ${currency(inv.total)}`, 300, y + 6, { align: "right" });

    addFooter(doc, inv.documentId || `ID: ${inv.id}`);

    const buf = await bufferFromDoc(doc);
    // Determinar el tipo de archivo basado en reportType o invoiceCategory
    let fileType = reportType || "invoice";
    if (!reportType) {
      // Fallback basado en invoiceCategory
      if (inv.invoiceCategory === "invoice_employ") fileType = "payroll";
      else if (inv.invoiceCategory === "invoice_service") fileType = "service";
      else if (inv.invoiceCategory === "invoice_general") fileType = "general";
      else fileType = "invoice";
    }
    const fileName = `${fileType}_${inv.documentId || inv.id}.pdf`;
    const base = process.env.CLOUDINARY_BASE_FOLDER || "Strapi/pizquito";
    const date = inv.emissionDate ? new Date(inv.emissionDate) : new Date();
    const YYYY = String(date.getFullYear());
    const MM = String(date.getMonth() + 1).padStart(2, "0");
    const folder = `${base}/invoices/${YYYY}/${MM}`;
    const uploaded = await uploadBufferAsFile(buf, fileName, folder);

    return {
      stored: true,
      url: uploaded?.url || null,
      cloudinary: uploaded?.provider_metadata || null,
      meta: {
        fileName,
        folder,
        invoiceId: inv.id,
        category: inv.invoiceCategory,
      },
    };
  },
  async generateInvoicePdfBuffer(id: number, reportType?: string) {
    const company = await fetchCompany();
    const inv = await fetchInvoice(id);
    if (!inv) {
      return {
        buffer: null,
        fileName: null,
        message: `Invoice ${id} not found`,
      };
    }

    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const mainTitle =
      inv.invoiceCategory === "invoice_employ" ? "Nómina" : "Factura";
    const titleBadge =
      inv.invoiceCategory === "invoice_employ" ||
      inv.invoiceCategory === "invoice_enrollment"
        ? prettyMonthYear(inv.emissionDate)
        : undefined;
    addHeader(doc, company, mainTitle, titleBadge);

    // Meta block
    let y = 150;
    addKeyValue(doc, "Número", inv.uid || String(inv.id), 40, y);
    addKeyValue(doc, "Fecha emisión", prettyDate(inv.emissionDate), 300, y);
    y += 15;
    addKeyValue(doc, "Estado", prettyStatus(inv.invoiceStatus), 40, y);
    addKeyValue(doc, "Tipo", prettyCategory(inv.invoiceCategory), 300, y);
    y += 15;
    addKeyValue(
      doc,
      "Registrado por",
      prettyRegisteredBy(inv.registeredBy),
      40,
      y,
    );
    y += 25;

    // Espacio adicional antes de los datos del alumno
    y += 15;

    // Subject details
    if (inv.invoiceCategory === "invoice_enrollment") {
      const student = inv.enrollment?.student;
      const classroom = inv.enrollment?.classroom;
      const guardians = inv.enrollment?.guardians;
      const primaryGuardian = getPrimaryGuardianForPdf(inv); // Prioriza guardian directo o principal del enrollment

      y = sectionTitle(doc, "Alumno", 40, y);
      doc.fillColor("#000");
      addKeyValue(
        doc,
        "Nombre",
        `${student?.name || ""} ${student?.lastname || ""}`,
        40,
        y,
      );
      addKeyValue(doc, "DNI", student?.dni || student?.DNI || "-", 300, y);
      y += 20;

      // Información del curso
      if (classroom?.name) {
        addKeyValue(doc, "Curso", classroom.name, 40, y);
        y += 20;
      }

      // Espacio adicional antes de la sección del padre/tutor
      y += 15;

      // Información del guardian principal
      if (primaryGuardian) {
        y = sectionTitle(doc, "Padre/Tutor", 40, y);
        doc.fillColor("#000");
        addKeyValue(
          doc,
          "Nombre",
          `${primaryGuardian.name || ""} ${primaryGuardian.lastname || ""}`,
          40,
          y,
        );
        addKeyValue(
          doc,
          "DNI",
          primaryGuardian.DNI || primaryGuardian.dni || "-",
          300,
          y,
        );
        y += 20;
      }

      y += 20; // Espacio adicional antes de la siguiente sección

      // Periodo se muestra junto al título en el encabezado
    } else if (inv.invoiceCategory === "invoice_employ") {
      const emp = inv.employee;
      y = sectionTitle(doc, "Empleado", 40, y);
      doc.fillColor("#000");
      addKeyValue(
        doc,
        "Nombre",
        `${emp?.name || ""} ${emp?.lastname || ""}`,
        40,
        y,
      );
      addKeyValue(doc, "DNI", emp?.DNI || "-", 300, y);
      y += 40;

      // Periodo se muestra junto al título en el encabezado
    }

    // Amounts table
    y = addAmountsTable(doc, inv.amounts || {}, y + 10);

    // Totals
    doc
      .fontSize(12)
      .fillColor("#000")
      .text(`IVA: ${currency(inv.IVA)}`, 40, y + 10);
    doc
      .fontSize(16)
      .fillColor("#000")
      .text(`Total: ${currency(inv.total)}`, 300, y + 6, { align: "right" });

    addFooter(doc, inv.documentId || `ID: ${inv.id}`);

    const buf = await bufferFromDoc(doc);
    // Determinar el tipo de archivo basado en reportType o invoiceCategory
    let fileType = reportType || "invoice";
    if (!reportType) {
      // Fallback basado en invoiceCategory
      if (inv.invoiceCategory === "invoice_employ") fileType = "payroll";
      else if (inv.invoiceCategory === "invoice_service") fileType = "service";
      else if (inv.invoiceCategory === "invoice_general") fileType = "general";
      else fileType = "invoice";
    }
    const fileName = `${fileType}_${inv.documentId || inv.id}.pdf`;
    return {
      buffer: buf,
      fileName,
      meta: { invoiceId: inv.id, category: inv.invoiceCategory },
    };
  },
};
