/**
 * Controller for Reports module: XLSX generation (Invoice lists by employee documentId)
 */

import { Context } from "koa";
import ExcelJS from "exceljs";

export default {
  async employees(ctx: Context) {
    return await generateEmployee(ctx);
  },
  async enrollments(ctx: Context) {
    return await generateEnrollment(ctx);
  },
  async general(ctx: Context) {
    return await generateGlobal(ctx, "invoice_general", "Facturas Generales");
  },
  async services(ctx: Context) {
    return await generateGlobal(
      ctx,
      "invoice_service",
      "Facturas de Servicios",
    );
  },
};

async function generateEmployee(ctx: Context) {
  const fixedCategory = "invoice_employ";
  const { id } = ctx.params as { id: string };
  const { startDate, endDate, status } = ctx.query as Record<string, string>;

  // Intentar encontrar el empleado por documentId (publicado)
  const employee = await strapi
    .documents("api::employee.employee")
    .findOne({ documentId: id, status: "published" })
    .catch(() => null);

  // Filtros por categoría y por el identificador suministrado
  // Incluye fallback por campos de snapshot/documentId para evitar 404 cuando el empleado fue eliminado
  const filters: any = {
    invoiceCategory: { $eq: fixedCategory },
    $or: [
      { employee: { documentId: { $eq: id } } },
      { employeeDocumentId: { $eq: id } },
    ],
  };
  if (startDate || endDate) {
    filters.emissionDate = {};
    if (startDate) filters.emissionDate.$gte = new Date(startDate);
    if (endDate) filters.emissionDate.$lte = new Date(endDate);
  }
  if (status) filters.invoiceStatus = { $eq: status };

  strapi.log.info(
    `Reports XLSX → Empleado docId=${id} | categoría=${fixedCategory} | empleado ${employee ? "existe" : "ELIMINADO/no publicado"}`,
  );

  const invoices = await strapi.entityService.findMany("api::invoice.invoice", {
    filters,
    sort: { emissionDate: "desc" },
    populate: ["files"],
    limit: 1000,
  });
  const invoicesList: any[] = Array.isArray(invoices)
    ? invoices
    : invoices
      ? [invoices as any]
      : [];

  const {
    workbook,
    worksheet,
    categoryMap,
    statusMap,
    typeMap,
    registeredByMap,
  } = setupWorkbook();

  for (const invoice of invoicesList) {
    const invoiceTotal = parseFloat(String(invoice.total || "0"));
    const invoiceIVA = parseFloat(String(invoice.IVA || "0"));
    const subtotal = invoiceTotal - invoiceIVA;
    const row = worksheet.addRow([
      invoice.id,
      invoice.title || "",
      invoice.emissionDate ? new Date(invoice.emissionDate) : null,
      invoice.expirationDate ? new Date(invoice.expirationDate) : null,
      statusMap[invoice.invoiceStatus || ""] || invoice.invoiceStatus || "",
      categoryMap[invoice.invoiceCategory || ""] ||
        invoice.invoiceCategory ||
        "",
      typeMap[invoice.invoiceType || ""] || invoice.invoiceType || "",
      subtotal.toFixed(2),
      invoiceIVA.toFixed(2),
      invoiceTotal.toFixed(2),
      registeredByMap[invoice.registeredBy || ""] || invoice.registeredBy || "",
      invoice.notes || "",
    ]);
    if (worksheet.rowCount % 2 === 0) {
      row.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "F8F9FA" },
      };
    }
  }

  addTotalsRow(worksheet, invoicesList);

  // Encabezado informativo para empleado (con fallback si el empleado fue eliminado)
  const empHeader =
    employee || (invoicesList[0]?.partySnapshot?.employee as any) || {};
  worksheet.insertRow(1, []);
  worksheet.insertRow(1, [
    `Empleado: ${[empHeader?.name, empHeader?.lastname].filter(Boolean).join(" ") || "N/A"}`,
  ]);
  worksheet.insertRow(2, [
    `DNI: ${empHeader?.DNI || "N/A"}`,
    `NIF: ${empHeader?.NIF || "N/A"}`,
  ]);
  worksheet.insertRow(3, [
    `BIC: ${(employee as any)?.BIC || "N/A"}`,
    `SWIFT: ${(employee as any)?.SWIFT || "N/A"}`,
  ]);
  worksheet.insertRow(4, [`Categoría: ${categoryMap[fixedCategory]}`]);
  worksheet.insertRow(5, [
    `Fecha de exportación: ${new Date().toLocaleDateString("es-ES")}`,
  ]);
  worksheet.insertRow(6, []);
  for (let i = 1; i <= 5; i++) worksheet.getRow(i).font = { bold: true };

  const fileName = `historial_facturas_${employee.name}_${employee.lastname}_${new Date().toISOString().split("T")[0]}.xlsx`;
  setDownloadHeaders(ctx, fileName);
  applyAutoFilter(worksheet);
  const buffer = await (setupWorkbook as any).workbookWriteBuffer(workbook);
  ctx.body = buffer;
  strapi.log.info(
    `📊 Reports XLSX generado (empleado): ${fileName} - ${invoicesList.length} facturas`,
  );
}

async function generateEnrollment(ctx: Context) {
  const fixedCategory = "invoice_enrollment";
  const { id } = ctx.params as { id: string };
  const { startDate, endDate, status } = ctx.query as Record<string, string>;

  // Intentar cargar matrícula por documentId; si no existe, continuar con filtros por snapshot/documentId
  const enrollment = await strapi
    .documents("api::enrollment.enrollment")
    .findOne({
      documentId: id,
      status: "published",
      populate: {
        student: true,
        guardians: true,
        classroom: true,
        school_period: true,
      },
    })
    .catch(() => null);

  const filters: any = {
    invoiceCategory: { $eq: fixedCategory },
    $or: [
      { enrollment: { documentId: { $eq: id } } },
      { enrollmentDocumentId: { $eq: id } },
    ],
  };
  if (startDate || endDate) {
    filters.emissionDate = {};
    if (startDate) filters.emissionDate.$gte = new Date(startDate);
    if (endDate) filters.emissionDate.$lte = new Date(endDate);
  }
  if (status) filters.invoiceStatus = { $eq: status };

  strapi.log.info(
    `Reports XLSX → Matrícula docId=${id} | categoría=${fixedCategory} | matrícula ${enrollment ? "existe" : "ELIMINADA/no publicada"}`,
  );

  const invoices = await strapi.entityService.findMany("api::invoice.invoice", {
    filters,
    sort: { emissionDate: "desc" },
    populate: ["files"],
    limit: 1000,
  });
  const invoicesList: any[] = Array.isArray(invoices)
    ? invoices
    : invoices
      ? [invoices as any]
      : [];

  const {
    workbook,
    worksheet,
    categoryMap,
    statusMap,
    typeMap,
    registeredByMap,
  } = setupWorkbook();

  for (const invoice of invoicesList) {
    const invoiceTotal = parseFloat(String(invoice.total || "0"));
    const invoiceIVA = parseFloat(String(invoice.IVA || "0"));
    const subtotal = invoiceTotal - invoiceIVA;
    const row = worksheet.addRow([
      invoice.id,
      invoice.title || "",
      invoice.emissionDate ? new Date(invoice.emissionDate) : null,
      invoice.expirationDate ? new Date(invoice.expirationDate) : null,
      statusMap[invoice.invoiceStatus || ""] || invoice.invoiceStatus || "",
      categoryMap[invoice.invoiceCategory || ""] ||
        invoice.invoiceCategory ||
        "",
      typeMap[invoice.invoiceType || ""] || invoice.invoiceType || "",
      subtotal.toFixed(2),
      invoiceIVA.toFixed(2),
      invoiceTotal.toFixed(2),
      registeredByMap[invoice.registeredBy || ""] || invoice.registeredBy || "",
      invoice.notes || "",
    ]);
    if (worksheet.rowCount % 2 === 0) {
      row.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "F8F9FA" },
      };
    }
  }

  addTotalsRow(worksheet, invoicesList);

  // Cabecera enriquecida: alumno, tutores, aula, período (fallback a snapshot si la matrícula no existe)
  const snap = (invoicesList[0]?.partySnapshot as any) || {};
  const student: any = (enrollment as any)?.student || snap?.student || {};
  const classroom: any =
    (enrollment as any)?.classroom || snap?.classroom || {};
  const schoolPeriod: any =
    (enrollment as any)?.school_period || snap?.schoolPeriod || {};
  const guardians: any[] = Array.isArray((enrollment as any)?.guardians)
    ? (enrollment as any).guardians
    : snap?.guardian
      ? [snap.guardian]
      : [];

  const studentFullName = [student?.name, student?.lastname]
    .filter(Boolean)
    .join(" ");
  const studentDNI = student?.DNI || "N/A";
  const classroomTitle = classroom?.title || "N/A";
  const schoolPeriodTitle = schoolPeriod?.title || schoolPeriod?.name || "N/A";
  const guardiansText =
    guardians.length > 0
      ? guardians
          .map(
            (g) =>
              `${[g?.name, g?.lastname].filter(Boolean).join(" ")} (DNI/NIF: ${g?.DNI || g?.NIF || "N/A"})`,
          )
          .join(", ")
      : "N/A";

  worksheet.insertRow(1, []);
  worksheet.insertRow(1, [`Matrícula ID: ${id}`]);
  worksheet.getRow(1).font = { bold: true };
  worksheet.insertRow(2, [`Estudiante: ${studentFullName || "N/A"}`]);
  worksheet.getRow(2).font = { bold: true };
  worksheet.insertRow(3, [`DNI Alumno: ${studentDNI}`]);
  worksheet.getRow(3).font = { bold: true };
  // Bloque de Padres/Tutores con más datos
  worksheet.insertRow(4, ["Padres/Tutores:"]);
  worksheet.getRow(4).font = { bold: true };
  const guardianTypeMap: Record<string, string> = {
    biological_parent: "Padre/Madre",
    adoptive_parent: "Padre/Madre adoptivo",
    legal_guardian: "Tutor legal",
    other: "Otro",
  };
  let currentRow = 5;
  for (const g of guardians) {
    const gName = [g?.name, g?.lastname].filter(Boolean).join(" ") || "N/A";
    const gType = guardianTypeMap[g?.guardianType || ""] || "N/A";
    const gDNI = g?.DNI || "N/A";
    const gNIF = g?.NIF || "N/A";
    const gPhone = g?.phone || "N/A";
    const gMail = g?.mail || "N/A";
    const addressParts = [g?.address, g?.city, g?.postcode, g?.country]
      .filter((x) => !!x)
      .join(", ");
    const gAddress = addressParts || "N/A";
    worksheet.insertRow(currentRow++, [`- ${gName} (${gType})`]);
    worksheet.insertRow(currentRow++, [`  DNI: ${gDNI} | NIF: ${gNIF}`]);
    worksheet.insertRow(currentRow++, [
      `  Teléfono: ${gPhone} | Email: ${gMail}`,
    ]);
    worksheet.insertRow(currentRow++, [`  Dirección: ${gAddress}`]);
  }
  // Período
  worksheet.insertRow(currentRow, [`Periodo escolar: ${schoolPeriodTitle}`]);
  worksheet.getRow(currentRow++).font = { bold: true };
  // Fecha de exportación
  worksheet.insertRow(currentRow, [
    `Fecha de exportación: ${new Date().toLocaleDateString("es-ES")}`,
  ]);
  worksheet.getRow(currentRow++).font = { bold: true };
  worksheet.insertRow(currentRow++, []);

  const fileName = `historial_matriculas_${id}_${new Date().toISOString().split("T")[0]}.xlsx`;
  setDownloadHeaders(ctx, fileName);
  applyAutoFilter(worksheet);
  const buffer = await (setupWorkbook as any).workbookWriteBuffer(workbook);
  ctx.body = buffer;
  strapi.log.info(
    `📊 Reports XLSX generado (matrícula): ${fileName} - ${invoicesList.length} facturas`,
  );
}

async function generateGlobal(
  ctx: Context,
  fixedCategory: string,
  title: string,
) {
  const {
    startDate,
    endDate,
    status,
    sortBy,
    sortOrder,
    invoiceType,
    registeredBy,
  } = ctx.query as Record<string, string>;

  const filters: any = {
    invoiceCategory: { $eq: fixedCategory },
  };
  if (startDate || endDate) {
    filters.emissionDate = {};
    if (startDate) filters.emissionDate.$gte = new Date(startDate);
    if (endDate) filters.emissionDate.$lte = new Date(endDate);
  }
  if (status) filters.invoiceStatus = { $eq: status };
  if (invoiceType) filters.invoiceType = { $eq: invoiceType };
  if (registeredBy) filters.registeredBy = { $eq: registeredBy };

  const sortField = sortBy || "emissionDate";
  const sortDir =
    sortOrder === "asc" || sortOrder === "desc" ? sortOrder : "desc";

  strapi.log.info(
    `Reports XLSX → Global | categoría=${fixedCategory} | sort=${sortField} ${sortDir}`,
  );

  const invoices = await strapi.entityService.findMany("api::invoice.invoice", {
    filters,
    sort: { [sortField]: sortDir },
    populate: ["files"],
    limit: 1000,
  });
  const invoicesList: any[] = Array.isArray(invoices)
    ? invoices
    : invoices
      ? [invoices as any]
      : [];

  const {
    workbook,
    worksheet,
    categoryMap,
    statusMap,
    typeMap,
    registeredByMap,
  } = setupWorkbook();

  for (const invoice of invoicesList) {
    const invoiceTotal = parseFloat(String(invoice.total || "0"));
    const invoiceIVA = parseFloat(String(invoice.IVA || "0"));
    const subtotal = invoiceTotal - invoiceIVA;
    const row = worksheet.addRow([
      invoice.id,
      invoice.title || "",
      invoice.emissionDate ? new Date(invoice.emissionDate) : null,
      invoice.expirationDate ? new Date(invoice.expirationDate) : null,
      statusMap[invoice.invoiceStatus || ""] || invoice.invoiceStatus || "",
      categoryMap[invoice.invoiceCategory || ""] ||
        invoice.invoiceCategory ||
        "",
      typeMap[invoice.invoiceType || ""] || invoice.invoiceType || "",
      subtotal.toFixed(2),
      invoiceIVA.toFixed(2),
      invoiceTotal.toFixed(2),
      registeredByMap[invoice.registeredBy || ""] || invoice.registeredBy || "",
      invoice.notes || "",
    ]);
    if (worksheet.rowCount % 2 === 0) {
      row.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "F8F9FA" },
      };
    }
  }

  addTotalsRow(worksheet, invoicesList);

  worksheet.insertRow(1, []);
  worksheet.insertRow(1, [title]);
  worksheet.insertRow(2, [
    `Fecha de exportación: ${new Date().toLocaleDateString("es-ES")}`,
  ]);
  worksheet.insertRow(3, []);
  for (let i = 1; i <= 2; i++) worksheet.getRow(i).font = { bold: true };

  const fileName = `${title.replace(/\s+/g, "_").toLowerCase()}_${new Date().toISOString().split("T")[0]}.xlsx`;
  setDownloadHeaders(ctx, fileName);
  applyAutoFilter(worksheet);
  const buffer = await (setupWorkbook as any).workbookWriteBuffer(workbook);
  ctx.body = buffer;
  strapi.log.info(
    `📊 Reports XLSX generado (global ${fixedCategory}): ${fileName} - ${invoicesList.length} facturas`,
  );
}

function setupWorkbook() {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Historial de Facturas");
  workbook.creator = "Sistema Pizquito";
  workbook.lastModifiedBy = "Sistema Pizquito";
  workbook.created = new Date();
  workbook.modified = new Date();

  const headers = [
    "ID Recibo",
    "Título",
    "Fecha Emisión",
    "Fecha Vencimiento",
    "Estado",
    "Categoría",
    "Tipo",
    "Subtotal",
    "IVA",
    "Total",
    "Origen",
    "Notas",
  ];
  const headerRow = worksheet.addRow(headers);
  headerRow.font = { bold: true, color: { argb: "FFFFFF" } };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "366092" },
  };

  worksheet.columns = [
    { width: 12 },
    { width: 25 },
    { width: 15 },
    { width: 15 },
    { width: 12 },
    { width: 18 },
    { width: 12 },
    { width: 12 },
    { width: 10 },
    { width: 12 },
    { width: 15 },
    { width: 25 },
  ];

  // Formato de fecha para columnas de Fecha Emisión (C) y Fecha Vencimiento (D)
  worksheet.getColumn(3).numFmt = "dd/mm/yyyy";
  worksheet.getColumn(4).numFmt = "dd/mm/yyyy";

  const statusMap: Record<string, string> = {
    unpaid: "Pendiente",
    inprocess: "En proceso",
    paid: "Pagada",
    canceled: "Cancelada",
  };
  const categoryMap: Record<string, string> = {
    invoice_employ: "Nómina empleado",
    invoice_enrollment: "Matrícula",
    invoice_general: "General",
    invoice_service: "Servicio",
  };
  const typeMap: Record<string, string> = {
    charge: "Cargo",
    payment: "Pago",
    income: "Ingreso",
    expense: "Gasto",
  };
  const registeredByMap: Record<string, string> = {
    administration: "Administración",
    bank: "Banco",
    system: "Sistema",
  };

  // helper para escribir buffer (para reutilizar en funciones)
  (setupWorkbook as any).workbookWriteBuffer = async (wb: ExcelJS.Workbook) =>
    wb.xlsx.writeBuffer();

  return {
    workbook,
    worksheet,
    statusMap,
    categoryMap,
    typeMap,
    registeredByMap,
  };
}

function addTotalsRow(worksheet: ExcelJS.Worksheet, invoicesList: any[]) {
  let totalAmount = 0;
  let totalIVA = 0;
  for (const inv of invoicesList) {
    const invoiceTotal = parseFloat(String(inv.total || "0"));
    const invoiceIVA = parseFloat(String(inv.IVA || "0"));
    totalAmount += invoiceTotal;
    totalIVA += invoiceIVA;
  }
  if (invoicesList.length > 0) {
    worksheet.addRow([]);
    const totalRow = worksheet.addRow([
      "",
      "",
      "",
      "",
      "",
      "",
      "TOTALES:",
      (totalAmount - totalIVA).toFixed(2),
      totalIVA.toFixed(2),
      totalAmount.toFixed(2),
      "",
      "",
    ]);
    totalRow.font = { bold: true };
    totalRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "E3F2FD" },
    };
  }
}

// Aplica AutoFilter a la fila de encabezados (muestra la flechita para ordenar/filtrar)
function applyAutoFilter(worksheet: ExcelJS.Worksheet) {
  // Buscar la fila que contiene el encabezado "ID Recibo" en la primera columna
  let headerRowIndex = 1;
  for (let i = 1; i <= worksheet.rowCount; i++) {
    const cellVal = worksheet.getRow(i).getCell(1).value;
    if (cellVal === "ID Recibo") {
      headerRowIndex = i;
      break;
    }
  }
  // Rango A..L en la fila detectada
  worksheet.autoFilter = `A${headerRowIndex}:L${headerRowIndex}`;
}

function setDownloadHeaders(ctx: Context, fileName: string) {
  ctx.set({
    "Content-Type":
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="${fileName}"`,
    "Access-Control-Expose-Headers": "Content-Disposition",
  });
}
