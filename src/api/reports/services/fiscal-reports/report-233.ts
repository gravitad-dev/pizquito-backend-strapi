import ExcelJS from "exceljs";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { errors } from "@strapi/utils";

/**
 * Fiscal Report Service: Modelo 233
 * Obtiene datos reales desde la BD (enrollments, invoices, student, guardians, school_period)
 * y construye la salida usada por los endpoints de preview/generate.
 *
 * Nota: Implementación enfocada a compilar y funcionar con datos existentes.
 */

type Quarter = "Q1" | "Q2" | "Q3" | "Q4";

type PreviewParams = {
  year: number;
  quarter?: Quarter;
  concept?: "matricula" | "comedor" | "all";
  studentId?: number;
  includeMonths?: boolean;
  page?: number;
  pageSize?: number;
};

type GenerateParams = PreviewParams & {
  format: "csv" | "xlsx" | "pdf";
  centerCode?: string;
};

type SumsByConcept = {
  matricula: number;
  comedor: number;
  subsidized: number; // importes subvencionados (subvención/beca/ayuda)
  totalOnly: number; // importes que no están etiquetados explícitamente como matrícula o comedor
};

const monthIndex = (d: Date) => d.getMonth(); // 0..11

const inRange = (date: Date, year: number, quarter?: Quarter) => {
  const y = date.getFullYear();
  if (y !== year) return false;
  if (!quarter) return true;
  const m = date.getMonth();
  if (quarter === "Q1") return m >= 0 && m <= 2;
  if (quarter === "Q2") return m >= 3 && m <= 5;
  if (quarter === "Q3") return m >= 6 && m <= 8;
  if (quarter === "Q4") return m >= 9 && m <= 11;
  return true;
};

const csvEscape = (value: unknown) => {
  const s = String(value ?? "");
  if (s.includes(",") || s.includes("\n") || s.includes('"')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
};

const ensureNumber = (v: any): number => {
  const n =
    typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : 0;
  return isNaN(n) ? 0 : n;
};

const monthFlag = (monthsWithInvoice: Set<number>, idx: number) =>
  monthsWithInvoice.has(idx) ? "S" : "";

export default {
  async preview(params: PreviewParams) {
    const {
      year,
      quarter,
      concept = "all",
      studentId,
      includeMonths = false,
      page = 1,
      pageSize = 25,
    } = params || ({} as PreviewParams);

    if (!year || typeof year !== "number") {
      throw new Error("Year is required and must be a number");
    }

    // Obtener company para centerCode/NIF
    let centerCode: string | undefined;
    let declarantNIF: string | undefined;
    try {
      const company = await (global as any).strapi.entityService.findMany(
        "api::company.company",
        {
          limit: 1,
        },
      );
      console.log("company:", company);
      if (company) {
        centerCode = company.code || company.NIF || undefined;
        declarantNIF = company.NIF || undefined;
      }
    } catch {}

    // Validar NIF declarante (obligatorio para el 233)
    if (!declarantNIF) {
      throw new errors.ValidationError(
        "El NIF del declarante (Company.NIF) es obligatorio para generar el Modelo 233",
      );
    }

    // Buscar enrollments con relaciones
    const filters: any = {};
    if (studentId) {
      filters.student = { id: studentId };
    }

    const enrollments = await (global as any).strapi.entityService.findMany(
      "api::enrollment.enrollment",
      {
        filters,
        populate: {
          student: true,
          guardians: true,
          school_period: true,
          invoices: true,
        },
        page,
        pageSize,
      },
    );

    const processed = (Array.isArray(enrollments) ? enrollments : []).map(
      (enr: any) => {
        const student = enr.student || {};
        const guardians = Array.isArray(enr.guardians) ? enr.guardians : [];
        const schoolPeriod = enr.school_period || {};
        const invoices = Array.isArray(enr.invoices) ? enr.invoices : [];

        const monthsWith = new Set<number>();
        const sums: SumsByConcept = {
          matricula: 0,
          comedor: 0,
          subsidized: 0,
          totalOnly: 0,
        };

        invoices.forEach((inv: any) => {
          const emission = inv.emissionDate ? new Date(inv.emissionDate) : null;
          if (!emission || !inRange(emission, year, quarter)) return;
          monthsWith.add(monthIndex(emission));

          // Usar el total de la factura (que incluye IVA) en lugar de amounts
          const invoiceTotal = ensureNumber(inv.total);
          const amounts = inv.amounts || {};
          const keys = Object.keys(amounts);
          
          if (keys.length === 0) {
            // Si no hay amounts, todo va a totalOnly
            sums.totalOnly += invoiceTotal;
          } else {
            // Calcular la proporción de cada concepto y aplicarla al total con IVA
            const subtotal = keys.reduce((acc, k) => acc + ensureNumber((amounts as any)[k]), 0);
            
            if (subtotal > 0) {
              keys.forEach((k) => {
                const amountValue = ensureNumber((amounts as any)[k]);
                const proportion = amountValue / subtotal;
                const totalWithIVA = invoiceTotal * proportion;
                const keyNorm = k.toLowerCase();
                
                if (keyNorm.includes("matri")) {
                  sums.matricula += totalWithIVA;
                } else if (
                  keyNorm.includes("comedor") ||
                  keyNorm.includes("menu") ||
                  keyNorm.includes("catering")
                ) {
                  sums.comedor += totalWithIVA;
                } else if (
                  keyNorm.includes("subv") ||
                  keyNorm.includes("beca") ||
                  keyNorm.includes("ayuda")
                ) {
                  sums.subsidized += totalWithIVA;
                } else {
                  sums.totalOnly += totalWithIVA;
                }
              });
            } else {
              // Si subtotal es 0, todo va a totalOnly
              sums.totalOnly += invoiceTotal;
            }
          }
        });

        const rowAmounts = {
          matricula: sums.matricula,
          comedor: sums.comedor,
          subsidized: sums.subsidized,
          total:
            sums.matricula + sums.comedor + sums.subsidized + sums.totalOnly,
        };

        const rowMonths = includeMonths
          ? {
              jan: monthFlag(monthsWith, 0),
              feb: monthFlag(monthsWith, 1),
              mar: monthFlag(monthsWith, 2),
              apr: monthFlag(monthsWith, 3),
              may: monthFlag(monthsWith, 4),
              jun: monthFlag(monthsWith, 5),
              jul: monthFlag(monthsWith, 6),
              aug: monthFlag(monthsWith, 7),
              sep: monthFlag(monthsWith, 8),
              oct: monthFlag(monthsWith, 9),
              nov: monthFlag(monthsWith, 10),
              dec: monthFlag(monthsWith, 11),
            }
          : undefined;

        const primaryNIF = guardians[0]?.NIF || guardians[0]?.DNI || undefined;
        const secondaryNIF =
          guardians[1]?.NIF || guardians[1]?.DNI || undefined;

        return {
          enrollmentId: enr?.id,
          studentId: student?.id,
          student: {
            dni: student?.DNI,
            name: student?.name,
            lastname: student?.lastname,
            birthdate: student?.birthdate,
          },
          guardians: {
            primaryNIF,
            secondaryNIF,
            firstGuardianName: guardians[0]?.name,
            firstGuardianLastname: guardians[0]?.lastname,
          },
          servicePeriod: {
            start: schoolPeriod?.period?.[0]?.start || undefined,
            end: schoolPeriod?.period?.[0]?.end || undefined,
          },
          months: rowMonths,
          amounts: rowAmounts,
          declarantNIF,
        };
      },
    );

    // Filtrar por concept si aplica
    const filtered = processed.filter((row: any) => {
      if (concept === "matricula") return (row.amounts?.matricula || 0) > 0;
      if (concept === "comedor") return (row.amounts?.comedor || 0) > 0;
      return true;
    });

    // Totales
    const totals = filtered.reduce(
      (
        acc: {
          matricula: number;
          comedor: number;
          subsidized: number;
          total: number;
        },
        r: any,
      ) => {
        acc.matricula += r.amounts?.matricula || 0;
        acc.comedor += r.amounts?.comedor || 0;
        acc.subsidized += r.amounts?.subsidized || 0;
        acc.total += r.amounts?.total || 0;
        return acc;
      },
      { matricula: 0, comedor: 0, subsidized: 0, total: 0 },
    );

    return {
      meta: {
        year,
        quarter,
        centerCode,
        declarantNIF,
        totals,
        pagination: {
          page,
          pageSize,
          totalItems: filtered.length,
        },
      },
      data: filtered,
    };
  },

  async generate(params: GenerateParams) {
    const {
      format = "csv",
      year,
      quarter,
      concept = "all",
      centerCode,
    } = params;
    const preview = await (this as any).preview({
      year,
      quarter,
      concept,
      includeMonths: true,
    });

    // Helper: convertir flags de meses a string "ENE,FEB,..."
    const monthsStringFromFlags = (m?: any) => {
      const names = [
        "ENE",
        "FEB",
        "MAR",
        "ABR",
        "MAY",
        "JUN",
        "JUL",
        "AGO",
        "SEP",
        "OCT",
        "NOV",
        "DIC",
      ];
      if (!m) return "";
      const flags = [
        m?.jan,
        m?.feb,
        m?.mar,
        m?.apr,
        m?.may,
        m?.jun,
        m?.jul,
        m?.aug,
        m?.sep,
        m?.oct,
        m?.nov,
        m?.dec,
      ];
      return names.filter((_, idx) => flags[idx] === "S").join(",");
    };

    // CSV con columnas solicitadas
    if (format === "csv") {
      const headers = [
        "ID Matrícula",
        "NIF Declarante",
        "NIF Primer Progenitor",
        "NIF Segundo Progenitor",
        "Apellidos Primer Progenitor",
        "Nombre Primer Progenitor",
        "DNI Menor",
        "Apellidos Menor",
        "Nombre Menor",
        "Fecha Nacimiento",
        "Meses Pagados",
        "Importe Total",
        "Importe Subvencionado",
        "Fecha Presentación",
      ];
      const today = new Date().toISOString().slice(0, 10);
      const rows = (preview.data || []).map((r: any) => [
        csvEscape(r.enrollmentId ?? ""),
        csvEscape(r.declarantNIF ?? ""),
        csvEscape(r.guardians?.primaryNIF ?? ""),
        csvEscape(r.guardians?.secondaryNIF ?? ""),
        csvEscape(r.guardians?.firstGuardianLastname ?? ""),
        csvEscape(r.guardians?.firstGuardianName ?? ""),
        csvEscape(r.student?.dni ?? ""),
        csvEscape(r.student?.lastname ?? ""),
        csvEscape(r.student?.name ?? ""),
        csvEscape(r.student?.birthdate ?? ""),
        csvEscape(monthsStringFromFlags(r.months)),
        csvEscape(r.amounts?.total ?? 0),
        csvEscape(r.amounts?.subsidized ?? 0),
        csvEscape(today),
      ]);
      const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join(
        "\n",
      );
      return {
        stored: false,
        cloudinary: null,
        url: null,
        meta: {
          year,
          quarter,
          concept,
          centerCode,
          declarantNIF: preview.meta?.declarantNIF,
          format: "csv",
        },
        content: csv,
      };
    }

    // XLSX: generar workbook y subir vía plugin upload (Cloudinary)
    if (format === "xlsx") {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Modelo 233");

      const headers = [
        "ID Matrícula",
        "NIF Declarante",
        "NIF Primer Progenitor",
        "NIF Segundo Progenitor",
        "Apellidos Primer Progenitor",
        "Nombre Primer Progenitor",
        "DNI Menor",
        "Apellidos Menor",
        "Nombre Menor",
        "Fecha Nacimiento",
        "Meses Pagados",
        "Importe Total",
        "Importe Subvencionado",
        "Fecha Presentación",
      ];
      ws.addRow(headers);
      // Estilos para la fila de títulos (cabecera)
      const headerRow = ws.getRow(1);
      headerRow.height = 20;
      headerRow.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: "FF000000" } };
        cell.alignment = { vertical: "middle", horizontal: "center" };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFEEEEEE" },
        }; // gris claro
        cell.border = {
          top: { style: "thin", color: { argb: "FFCCCCCC" } },
          left: { style: "thin", color: { argb: "FFCCCCCC" } },
          bottom: { style: "thin", color: { argb: "FFCCCCCC" } },
          right: { style: "thin", color: { argb: "FFCCCCCC" } },
        };
      });
      // Congelar la primera fila para mantener la cabecera visible
      ws.views = [{ state: "frozen", ySplit: 1 }];
      const today = new Date().toISOString().slice(0, 10);
      (preview.data || []).forEach((r: any) => {
        ws.addRow([
          r.enrollmentId ?? "",
          r.declarantNIF ?? "",
          r.guardians?.primaryNIF ?? "",
          r.guardians?.secondaryNIF ?? "",
          r.guardians?.firstGuardianLastname ?? "",
          r.guardians?.firstGuardianName ?? "",
          r.student?.dni ?? "",
          r.student?.lastname ?? "",
          r.student?.name ?? "",
          r.student?.birthdate ?? "",
          monthsStringFromFlags(r.months),
          r.amounts?.total ?? 0,
          r.amounts?.subsidized ?? 0,
          today,
        ]);
      });

      const buffer = await wb.xlsx.writeBuffer();
      const fileName = `modelo233_${year ?? new Date().getFullYear()}_${(concept || "ALL").toUpperCase()}.xlsx`;
      const mime =
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

      // Escribir archivo temporal y subir vía filepath (lo que el plugin espera)
      const buf = Buffer.isBuffer(buffer)
        ? (buffer as Buffer)
        : Buffer.from(buffer as ArrayBuffer);
      const tmpFilePath = path.join(
        os.tmpdir(),
        `upload-${Date.now()}-${fileName}`,
      );
      await fs.promises.writeFile(tmpFilePath, buf);
      // Subir con SDK de Cloudinary usando carpeta específica reports/233/YYYY/MM
      const base = process.env.CLOUDINARY_BASE_FOLDER || "Strapi/pizquito";
      const date = new Date();
      const YYYY = String(date.getFullYear());
      const MM = String(date.getMonth() + 1).padStart(2, "0");
      const folder = `${base}/reports/233/${YYYY}/${MM}`;

      let savedFile;
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
          use_filename: true,
          unique_filename: true,
          filename_override: fileName,
        });

        const sizeKB = parseFloat(((buf.length || 0) / 1024).toFixed(2));
        const ext = ".xlsx";
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

        savedFile = await (global as any).strapi.entityService.create(
          "plugin::upload.file",
          { data: fileData },
        );
      } finally {
        // Limpiar archivo temporal
        try {
          await fs.promises.unlink(tmpFilePath);
        } catch {}
      }

      return {
        stored: true,
        cloudinary: savedFile?.provider_metadata || null,
        url: savedFile?.url || null,
        meta: {
          year,
          quarter,
          concept,
          centerCode,
          declarantNIF: preview.meta?.declarantNIF,
          format: "xlsx",
          folder,
        },
      };
    }

    // Para xlsx/pdf retornamos un stub para no romper el build si faltan dependencias
    return {
      stored: false,
      cloudinary: null,
      url: null,
      meta: {
        year,
        quarter,
        concept,
        centerCode,
        declarantNIF: preview?.meta?.declarantNIF,
        format,
      },
      message:
        'Generación no implementada para este formato en esta build. Usa format="csv" para obtener contenido.',
    };
  },
};
