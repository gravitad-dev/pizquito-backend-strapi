import ExcelJS from "exceljs";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { errors } from "@strapi/utils";

// Tipos mínimos para snapshot con el fin de evitar dependencias frágiles en relaciones en vivo
type PartySnapshot = {
  partyType?: string;
  student?: { documentId?: string; DNI?: string; name?: string; lastname?: string; birthdate?: string } | null;
  guardian?: { documentId?: string; DNI?: string; NIF?: string; name?: string; lastname?: string } | null;
  schoolPeriod?: { start?: string; end?: string } | null;
  billing?: { total?: number | string | null; IVA?: number | string | null } | null;
  company?: { NIF?: string; IBAN?: string; BIC?: string } | null;
};

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
  studentName?: string;
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
      studentName,
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

    // Construir filtros para student
    const studentFilters: any = {};

    if (studentId) {
      studentFilters.id = studentId;
    }

    // Filtro por nombre de estudiante (incluye nombre y apellido, case-insensitive)
    if (studentName && studentName.trim()) {
      const searchTerm = studentName.trim();
      if (studentFilters.id) {
        // Si ya hay un studentId, combinar con AND
        studentFilters.$and = [
          { id: studentFilters.id },
          {
            $or: [
              { name: { $containsi: searchTerm } },
              { lastname: { $containsi: searchTerm } },
            ],
          },
        ];
        delete studentFilters.id;
      } else {
        // Solo filtro por nombre
        studentFilters.$or = [
          { name: { $containsi: searchTerm } },
          { lastname: { $containsi: searchTerm } },
        ];
      }
    }

    if (Object.keys(studentFilters).length > 0) {
      filters.student = studentFilters;
    }

    // Debug: log de filtros aplicados
    console.log("🔍 Filtros aplicados:", JSON.stringify(filters, null, 2));
    console.log("🔍 Parámetros recibidos:", { studentId, studentName });

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

          // Usar el total del recibo preferentemente desde snapshot (que incluye IVA) en lugar de amounts
          const invoiceTotal = ensureNumber(
            (inv?.partySnapshot as PartySnapshot | undefined)?.billing?.total ?? inv.total,
          );
          const rawAmounts = inv.amounts;

          // Unificar amounts: aceptar array de {concept, amount} o mapa {concept: amount}
          type Pair = { concept: string; amount: number };
          let pairs: Pair[] = [];

          if (Array.isArray(rawAmounts)) {
            // Normalizar array
            const acc = new Map<string, { concept: string; amount: number }>();
            for (const item of rawAmounts) {
              if (!item || typeof item !== "object") continue;
              const concept = String(item.concept || "").trim();
              const amount = ensureNumber(item.amount);
              if (!concept || !Number.isFinite(amount) || amount < 0) continue;
              const key = concept.toLowerCase();
              const prev = acc.get(key);
              acc.set(key, {
                concept: prev?.concept || concept,
                amount: (prev?.amount || 0) + amount,
              });
            }
            pairs = Array.from(acc.values());
          } else if (rawAmounts && typeof rawAmounts === "object") {
            // Legacy: objeto plano { concepto: valor }
            const keys = Object.keys(rawAmounts);
            pairs = keys
              .map((k) => ({
                concept: k,
                amount: ensureNumber((rawAmounts as any)[k]),
              }))
              .filter(
                (p) => p.concept && Number.isFinite(p.amount) && p.amount >= 0,
              );
          }

          if (pairs.length === 0) {
            // Si no hay amounts, todo va a totalOnly
            sums.totalOnly += invoiceTotal;
          } else {
            // Calcular la proporción de cada concepto y aplicarla al total con IVA
            const subtotal = pairs.reduce((acc, p) => acc + p.amount, 0);

            if (subtotal > 0) {
              pairs.forEach(({ concept, amount }) => {
                const proportion = amount / subtotal;
                const totalWithIVA = invoiceTotal * proportion;
                const keyNorm = concept.toLowerCase();

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

        // Incluir additionalAmount en los totales del alumno
        // Criterio: sumar como "otros" (totalOnly) para que se refleje en el total
        // y no alterar los importes de matrícula/comedor/subvencionado.
        const additionalAmountValue = ensureNumber(enr?.additionalAmount);
        if (additionalAmountValue > 0) {
          sums.totalOnly += additionalAmountValue;
        }

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

        // Tomar datos del snapshot de la primera factura utilizable como fuente de identidad
        const firstSnapshot = (invoices.find(
          (i: any) => i?.partySnapshot && inRange(new Date(i.emissionDate), year, quarter),
        )?.partySnapshot || null) as PartySnapshot | null;

        const primaryNIF =
          firstSnapshot?.guardian?.NIF ||
          firstSnapshot?.guardian?.DNI ||
          guardians[0]?.NIF ||
          guardians[0]?.DNI ||
          undefined;
        const secondaryNIF = guardians[1]?.NIF || guardians[1]?.DNI || undefined;

        return {
          enrollmentId: enr?.id,
          studentId: student?.id,
          student: {
            dni: firstSnapshot?.student?.DNI ?? student?.DNI,
            name: firstSnapshot?.student?.name ?? student?.name,
            lastname: firstSnapshot?.student?.lastname ?? student?.lastname,
            birthdate: firstSnapshot?.student?.birthdate ?? student?.birthdate,
          },
          guardians: {
            primaryNIF,
            secondaryNIF,
            firstGuardianName:
              firstSnapshot?.guardian?.name ?? guardians[0]?.name,
            firstGuardianLastname:
              firstSnapshot?.guardian?.lastname ?? guardians[0]?.lastname,
          },
          servicePeriod: {
            start:
              firstSnapshot?.schoolPeriod?.start ||
              schoolPeriod?.period?.[0]?.start ||
              undefined,
            end:
              firstSnapshot?.schoolPeriod?.end ||
              schoolPeriod?.period?.[0]?.end ||
              undefined,
          },
          months: rowMonths,
          amounts: rowAmounts,
          additionalAmount: enr?.additionalAmount || null,
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

      // Subir CSV a Cloudinary para consistencia con XLSX
      const fileName = `modelo233_${year ?? new Date().getFullYear()}_${(concept || "ALL").toUpperCase()}.csv`;
      const mime = "text/csv";

      // Escribir archivo temporal y subir vía filepath
      const csvBuffer = Buffer.from(csv, "utf8");
      const tmpFilePath = path.join(
        os.tmpdir(),
        `upload-${Date.now()}-${fileName}`,
      );
      await fs.promises.writeFile(tmpFilePath, csvBuffer);

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

        const sizeKB = parseFloat(((csvBuffer.length || 0) / 1024).toFixed(2));
        const ext = ".csv";
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
          format: "csv",
          folder,
        },
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

  async history(params: {
    year?: number;
    quarter?: Quarter;
    concept?: "matricula" | "comedor" | "all";
    format?: "csv" | "xlsx" | "pdf";
    centerCode?: string;
    page?: number;
    pageSize?: number;
    startDate?: string;
    endDate?: string;
  }) {
    const {
      year,
      quarter,
      concept,
      format,
      centerCode,
      page = 1,
      pageSize = 25,
      startDate,
      endDate,
    } = params;

    try {
      // Construir filtros para buscar archivos de reportes 233
      const filters: any = {
        folderPath: {
          $contains: "Strapi/pizquito/reports/233",
        },
      };

      // Filtrar por año si se especifica
      if (year) {
        filters.folderPath = {
          $contains: `Strapi/pizquito/reports/233/${year}`,
        };
      }

      // Filtrar por formato si se especifica
      if (format) {
        filters.ext =
          format === "xlsx" ? ".xlsx" : format === "csv" ? ".csv" : ".pdf";
      }

      // Filtrar por rango de fechas si se especifica
      if (startDate || endDate) {
        filters.createdAt = {};
        if (startDate) {
          filters.createdAt.$gte = new Date(startDate);
        }
        if (endDate) {
          filters.createdAt.$lte = new Date(endDate);
        }
      }

      // Buscar archivos con paginación
      const files = await (global as any).strapi.entityService.findMany(
        "plugin::upload.file",
        {
          filters,
          sort: { createdAt: "desc" },
          start: (page - 1) * pageSize,
          limit: pageSize,
        },
      );

      // Contar total de archivos para paginación
      const total = await (global as any).strapi.entityService.count(
        "plugin::upload.file",
        { filters },
      );

      // Procesar archivos para extraer metadatos del nombre y path
      const processedFiles = files.map((file: any) => {
        const pathParts = file.folderPath?.split("/") || [];
        const yearFromPath = pathParts[4]; // Strapi/pizquito/reports/233/YYYY
        const monthFromPath = pathParts[5]; // MM

        // Extraer información del nombre del archivo
        const fileName = file.name || "";
        const fileFormat = file.ext?.replace(".", "") || "unknown";

        // Intentar extraer metadatos del nombre del archivo
        // Formato esperado: modelo-233-YYYY-QX-concept-centerCode-timestamp
        const nameParts = fileName.replace(file.ext || "", "").split("-");

        return {
          id: file.id,
          name: fileName,
          url: file.url,
          format: fileFormat,
          size: file.size,
          createdAt: file.createdAt,
          updatedAt: file.updatedAt,
          metadata: {
            year: yearFromPath ? parseInt(yearFromPath, 10) : null,
            month: monthFromPath ? parseInt(monthFromPath, 10) : null,
            quarter: nameParts.find((part) => part.startsWith("Q")) || null,
            concept:
              nameParts.find((part) =>
                ["matricula", "comedor", "all"].includes(part),
              ) || null,
            centerCode: nameParts.length > 6 ? nameParts[5] : null,
          },
          cloudinary: {
            public_id: file.provider_metadata?.public_id,
            resource_type: file.provider_metadata?.resource_type,
          },
        };
      });

      // Aplicar filtros adicionales en memoria si es necesario
      let filteredFiles = processedFiles;

      if (quarter) {
        filteredFiles = filteredFiles.filter(
          (file) => file.metadata.quarter === quarter,
        );
      }

      if (concept) {
        filteredFiles = filteredFiles.filter(
          (file) => file.metadata.concept === concept,
        );
      }

      if (centerCode) {
        filteredFiles = filteredFiles.filter(
          (file) => file.metadata.centerCode === centerCode,
        );
      }

      return {
        data: filteredFiles,
        meta: {
          pagination: {
            page,
            pageSize,
            pageCount: Math.ceil(total / pageSize),
            total,
          },
          filters: {
            year,
            quarter,
            concept,
            format,
            centerCode,
            startDate,
            endDate,
          },
        },
      };
    } catch (error) {
      console.error("Error fetching report history:", error);
      throw new errors.ApplicationError(
        "Error al obtener el historial de reportes",
      );
    }
  },
};
