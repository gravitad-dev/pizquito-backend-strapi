import type { Core } from "@strapi/types";
import {
  type InvoiceAmount,
  normalizeInvoiceAmounts,
  subtotalFromAmounts,
} from "./invoice-amounts";

export type PartySnapshotMinimal = {
  partyType?: "enrollment" | "employee" | "supplier" | "general" | "service";
  billing?: {
    IVA?: number;
    total?: number;
  };
  company?: {
    IBAN?: string;
    BIC?: string;
  };
};

export type InvoiceEntityWithSnapshot = {
  documentId: string;
  partySnapshot?: PartySnapshotMinimal;
};

export type BillingConfig = {
  id?: string; // Cambiado a string para compatibilidad con documentId en Strapi v5
  day: number;
  hour: number;
  minute: number;
  testMode: boolean;
  testIntervalMinutes: number;
  timezone: string;
  isActive: boolean;
  lastExecution?: Date;
};

export type TaskContext = { strapi: Core.Strapi };

// VAT rate (21% Spain)
export const IVA_RATE = 0.21;

/**
 * DEFAULT RULE:
 * - We schedule the job to run each minute and let the task decide whether to
 *   actually perform billing (based on DB flags: test_mode, day/hour/minute).
 * Reason: Strapi's job registration reads the rule at startup. To allow
 * dynamic control from the DB without restarting the process, we poll each minute.
 */
export const DEFAULT_RUN_EVERY_MINUTE_RULE =
  process.env.BILLING_CRON_RULE || "*/1 * * * *";

/**
 * Helper: get billing configuration from cron-day content type
 * - Returns the first record (if any) and its id to allow updates.
 */
export const getBillingConfig = async (
  strapi: Core.Strapi,
): Promise<BillingConfig> => {
  try {
    console.log(
      "🔍 [Debug] Iniciando consulta a cron-day usando Document Service",
    );

    const cronDayDoc = await strapi
      .documents("api::cron-day.cron-day")
      .findFirst({
        status: "published",
      });

    console.log(
      "🔍 [Debug] Resultado de findFirst:",
      JSON.stringify(cronDayDoc, null, 2),
    );

    if (cronDayDoc) {
      console.log(
        "🔍 [Debug] Configuración seleccionada:",
        JSON.stringify(cronDayDoc, null, 2),
      );

      return {
        id: cronDayDoc.documentId, // Usar documentId para v5
        day: cronDayDoc.cron_day ?? 25,
        hour: cronDayDoc.cron_hour ?? 5,
        minute: cronDayDoc.cron_minute ?? 0,
        testMode: cronDayDoc.test_mode ?? false,
        testIntervalMinutes: cronDayDoc.test_interval_minutes ?? 5,
        timezone: cronDayDoc.timezone ?? "Europe/Madrid",
        isActive: cronDayDoc.is_active !== false, // default true
        lastExecution: cronDayDoc.last_execution
          ? new Date(cronDayDoc.last_execution)
          : undefined,
      };
    } else {
      console.log(
        "🔍 [Debug] No se encontró configuración publicada, usando defaults",
      );
    }
  } catch (error) {
    console.log("❌ [Debug] Error en consulta Document Service:", error);
    strapi.log.warn(
      "⚠️  No se pudo obtener la configuración de billing, usando valores por defecto",
      error,
    );
  }

  return {
    day: 25,
    hour: 5,
    minute: 0,
    testMode: false,
    testIntervalMinutes: 5,
    timezone: "Europe/Madrid",
    isActive: true,
  };
};

/**
 * Helper: update execution timestamps in billing configuration (uses the record id)
 */
export const updateExecutionTimestamps = async (
  strapi: Core.Strapi,
  lastExecution: Date,
  notes?: string,
): Promise<void> => {
  try {
    const config = await getBillingConfig(strapi);
    const id = (config as any).id ?? 1;

    let nextExecution: Date;
    if (config.testMode) {
      nextExecution = new Date(
        lastExecution.getTime() + config.testIntervalMinutes * 60 * 1000,
      );
    } else {
      nextExecution = new Date(lastExecution);
      // next month same configured day & time
      nextExecution.setMonth(nextExecution.getMonth() + 1);
      nextExecution.setDate(config.day);
      nextExecution.setHours(config.hour, config.minute, 0, 0);
    }

    await strapi.entityService.update("api::cron-day.cron-day", id, {
      data: {
        last_execution: lastExecution.toISOString(),
        next_execution: nextExecution.toISOString(),
        execution_notes:
          notes ||
          `Última ejecución: ${lastExecution.toLocaleString("es-ES", { timeZone: config.timezone })}`,
      } as any,
    });
  } catch (error) {
    strapi.log.warn(
      "⚠️  No se pudieron actualizar las fechas de ejecución:",
      error && (error as Error).message ? (error as Error).message : error,
    );
  }
};

/**
 * Helper: log cron execution to history
 */
export const logCronExecution = async (
  strapi: Core.Strapi,
  {
    title,
    message,
    level = "INFO",
    event_type = "cron_execution",
    payload = {},
    duration_ms,
    status_code = "200",
  }: {
    title: string;
    message: string;
    level?: "INFO" | "WARN" | "ERROR" | "DEBUG";
    event_type?: string;
    payload?: Record<string, any>;
    duration_ms?: string;
    status_code?: string;
  },
) => {
  try {
    const trace_id = `cron-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    await strapi.entityService.create("api::history.history", {
      data: {
        title,
        message,
        trace_id,
        timestamp: new Date().toISOString(),
        module: "cron",
        event_type,
        level,
        status_code,
        duration_ms: duration_ms || "0",
        user_id: "system",
        payload,
        publishedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    // No queremos botar la ejecución si el history falla
    strapi.log.error("❌ Error al registrar en history:", error);
  }
};

/**
 * Utility: get start and end ISO for current month
 */
export const getMonthBounds = (date = getMadridTime()) => {
  const start = new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 1, 0, 0, 0, 0);
  return { start: start.toISOString(), end: end.toISOString() };
};

/**
 * Safely convert to number
 */
export const num = (v: unknown, fallback = 0): number => {
  const n =
    typeof v === "string" ? Number(v) : typeof v === "number" ? v : fallback;
  return Number.isFinite(n) ? n : fallback;
};

/**
 * Calculate VAT and total
 * TEMPORAL: IVA desactivado - solo devuelve el subtotal como total
 */
export const calculateIVA = (subtotal: number) => {
  // TEMPORAL: Comentado el cálculo del IVA
  // const iva = Math.round(subtotal * IVA_RATE * 100) / 100; // 2 decimals
  // const total = Math.round((subtotal + iva) * 100) / 100;

  // TEMPORAL: Sin IVA - el total es igual al subtotal
  const iva = 0;
  const total = Math.round(subtotal * 100) / 100;
  return { iva, total };
};

/**
 * Get last day of month (safe)
 */
export const getLastDayOfMonth = (d: Date) =>
  new Date(d.getFullYear(), d.getMonth() + 1, 0);

/**
 * Obtiene la fecha actual en zona horaria de Madrid (Europe/Madrid)
 * Esto asegura que el cron funcione correctamente independientemente de la zona horaria del servidor
 */
export const getMadridTime = (): Date => {
  const now = new Date();
  const madridTimeString = now.toLocaleString("en-US", {
    timeZone: "Europe/Madrid",
  });
  return new Date(madridTimeString);
};

/**
 * Obtiene el guardian principal de un enrollment
 * Prioriza el guardian marcado como principal, o toma el primero disponible
 */
export const getPrimaryGuardian = (enrollment: any) => {
  const guardians = Array.isArray(enrollment.guardians)
    ? enrollment.guardians
    : [];
  if (guardians.length === 0) return null;

  // Buscar guardian principal
  const primaryGuardian = guardians.find((g: any) => g.isPrimary === true);
  if (primaryGuardian) return primaryGuardian;

  // Si no hay principal, tomar el primero
  return guardians[0];
};

/**
 * Check if current date is within school period range
 * @param schoolPeriod - The school period object with period array
 * @param currentDate - The date to check (defaults to now)
 * @returns true if current date is within any period range, false otherwise
 */
export const isDateWithinSchoolPeriod = (
  schoolPeriod: any,
  currentDate: Date = getMadridTime(),
): boolean => {
  if (
    !schoolPeriod ||
    !schoolPeriod.period ||
    !Array.isArray(schoolPeriod.period)
  ) {
    return false;
  }

  const currentDateOnly = new Date(
    currentDate.getFullYear(),
    currentDate.getMonth(),
    currentDate.getDate(),
  );

  for (const period of schoolPeriod.period) {
    if (!period.start || !period.end) continue;

    const startDate = new Date(period.start);
    const endDate = new Date(period.end);

    // Set to start/end of day for proper comparison
    const periodStart = new Date(
      startDate.getFullYear(),
      startDate.getMonth(),
      startDate.getDate(),
    );
    const periodEnd = new Date(
      endDate.getFullYear(),
      endDate.getMonth(),
      endDate.getDate(),
    );

    if (currentDateOnly >= periodStart && currentDateOnly <= periodEnd) {
      return true;
    }
  }

  return false;
};

/**
 * Decide whether to bill employee based on paymentPeriod and billingDay (if provided)
 * - billingDay is used for 'monthly' to respect the configured day in DB
 */
export const shouldBillEmployee = (
  paymentPeriod: string,
  currentDate: Date,
  billingDay?: number,
): boolean => {
  const day = currentDate.getDate();

  switch (paymentPeriod) {
    case "monthly":
      return typeof billingDay === "number" ? day === billingDay : true;

    case "biweekly":
      // 1-2 and 15-16 (business rule you had originally)
      return (day >= 1 && day <= 2) || (day >= 15 && day <= 16);

    case "weekly":
      // Monday (0=Sunday, 1=Monday)
      return currentDate.getDay() === 1;

    case "daily":
      return true;

    case "annual":
      // Bill once a year in early January (1-2)
      return currentDate.getMonth() === 0 && day >= 1 && day <= 2;

    default:
      return true;
  }
};

/**
 * Calculate salary amount (returns a monthly-equivalent or the correct slice)
 *
 * Expectations:
 * - hourlyRate = €/hour
 * - workedHours = hours per month (if provided). If not provided we fallback to 160h/month.
 *
 * Returns the amount to bill now according to paymentPeriod.
 */
export const calculateSalaryAmount = (
  paymentPeriod: string,
  hourlyRate: number,
  workedHours: number | undefined,
  currentDate: Date,
): number => {
  const hourly = num(hourlyRate, 0);
  const hoursPerMonth =
    typeof workedHours === "number" && workedHours > 0
      ? num(workedHours, 0)
      : 160;
  const monthlyAmount = hourly * hoursPerMonth;

  switch (paymentPeriod) {
    case "monthly":
      return monthlyAmount;

    case "biweekly":
      return monthlyAmount / 2;

    case "weekly":
      return monthlyAmount / 4;

    case "daily":
      // estimate per working day (22 working days typical)
      return monthlyAmount / 22;

    case "annual":
      // if the stored terms represent monthly-equivalent, return monthly when annual billing occurs
      // Ideally the model should store an explicit annual number to avoid ambiguity.
      return monthlyAmount;

    default:
      return monthlyAmount;
  }
};

/**
 * Helper: fetch all records in batches to avoid loading too much at once.
 */
export const fetchAllBatched = async (
  strapi: Core.Strapi,
  entity: string,
  populate: any = {},
  batch = 500,
  filters: any = {},
) => {
  let start = 0;
  const results: any[] = [];

  // Usar documentService para consistencia con la API REST
  const documentService = strapi.documents(entity as any);

  while (true) {
    const page = (await documentService.findMany({
      filters,
      populate,
      start,
      limit: batch,
      sort: "id:asc", // Asegurar orden consistente
      status: "published", // Solo registros publicados
    })) as any[];

    if (!Array.isArray(page) || page.length === 0) break;
    results.push(...page);
    if (page.length < batch) break;
    start += batch;
  }

  // Log para debug con más detalles
  strapi.log.info(
    `🔍 [fetchAllBatched] Obtenidos ${results.length} registros de ${entity}`,
  );

  if (results.length > 0) {
    strapi.log.info(
      `🔍 [fetchAllBatched] IDs obtenidos: ${results.map((r: any) => r.id).join(", ")}`,
    );
  }

  return results;
};

/**
 * Helper: clean old history records (older than specified days)
 */
export const cleanOldHistoryRecords = async (
  strapi: Core.Strapi,
  daysToKeep = 90,
): Promise<{ deleted: number }> => {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    strapi.log.info(
      `🧹 [Cleanup] Limpiando registros de history anteriores a ${cutoffDate.toISOString()}`,
    );

    // Buscar registros antiguos
    const oldRecords = await strapi.entityService.findMany(
      "api::history.history",
      {
        filters: {
          timestamp: {
            $lt: cutoffDate.toISOString(),
          },
        },
        fields: ["id", "timestamp", "title"],
        limit: 1000, // Procesar en lotes para evitar sobrecarga
      },
    );

    if (!Array.isArray(oldRecords) || oldRecords.length === 0) {
      strapi.log.info(
        "🧹 [Cleanup] No hay registros de history antiguos para limpiar",
      );
      return { deleted: 0 };
    }

    strapi.log.info(
      `🧹 [Cleanup] Encontrados ${oldRecords.length} registros de history para eliminar`,
    );

    // Eliminar registros en lotes
    let deletedCount = 0;
    for (const record of oldRecords) {
      try {
        await strapi.entityService.delete("api::history.history", record.id);
        deletedCount++;
      } catch (error) {
        strapi.log.error(
          `❌ [Cleanup] Error eliminando registro de history ${record.id}:`,
          error,
        );
      }
    }

    strapi.log.info(
      `✅ [Cleanup] Eliminados ${deletedCount} registros de history antiguos`,
    );
    return { deleted: deletedCount };
  } catch (error) {
    strapi.log.error("❌ [Cleanup] Error en limpieza de history:", error);
    return { deleted: 0 };
  }
};

/**
 * Map service types and titles to proper invoice concepts for fiscal reporting
 */
export const mapServiceToConcept = (service: any): string => {
  const title = (service?.title || "").toLowerCase().trim();
  const serviceType = service?.serviceType || "";

  // Mapeo específico por título
  if (
    title.includes("matricula") ||
    title.includes("matrícula") ||
    title.includes("inscription")
  ) {
    return "matricula";
  }
  if (
    title.includes("comedor") ||
    title.includes("lunch") ||
    title.includes("almuerzo")
  ) {
    return "comedor";
  }
  if (
    title.includes("transporte") ||
    title.includes("transport") ||
    title.includes("bus")
  ) {
    return "transporte";
  }
  if (
    title.includes("material") ||
    title.includes("libro") ||
    title.includes("supplies")
  ) {
    return "material";
  }

  // Mapeo por tipo de servicio como fallback
  if (serviceType === "student_service") {
    // Si es un servicio de estudiante pero no tiene título específico,
    // asumimos que es matrícula por defecto
    return "matricula";
  }

  // Fallback: usar el título original o "servicio"
  return service?.title || "servicio";
};

/**
 * Create monthly invoices for active enrollments (safe, batched)
 */
export const generateEnrollmentInvoices = async ({
  strapi,
  billingConfig,
}: TaskContext & { billingConfig: BillingConfig }): Promise<{
  created: number;
  skipped: number;
}> => {
  const now = getMadridTime(); // Usar hora de Madrid
  const { start, end } = getMonthBounds(now);

  strapi.log.info(`📅 [Cron] Período de facturación: ${start} a ${end}`);

  const enrollmentList = await fetchAllBatched(
    strapi,
    "api::enrollment.enrollment",
    {
      services: true,
      student: true,
      guardians: true,
      school_period: { populate: { period: true } },
    },
    500,
    { isActive: true },
  );

  strapi.log.info(
    `👥 [Cron] Enrollments activos encontrados: ${enrollmentList.length}`,
  );
  let createdCount = 0;
  let skippedCount = 0;
  let skippedNoSchoolPeriod = 0;
  let skippedOutOfRange = 0;

  for (const enr of enrollmentList) {
    try {
      // Validar que el enrollment tenga un periodo escolar asignado
      if (!(enr as any).school_period) {
        strapi.log.warn(
          `⚠️ [Cron] Enrollment ${(enr as any).id} sin periodo escolar asignado, omitiendo facturación`,
        );
        skippedNoSchoolPeriod++;
        skippedCount++;
        continue;
      }

      // Validar que la fecha actual esté dentro del rango del periodo escolar
      if (!isDateWithinSchoolPeriod((enr as any).school_period, now)) {
        strapi.log.warn(
          `📅 [Cron] Enrollment ${(enr as any).id} fuera del rango del periodo escolar, omitiendo facturación`,
        );
        skippedOutOfRange++;
        skippedCount++;
        continue;
      }

      const services = Array.isArray((enr as any).services)
        ? (enr as any).services
        : [];
      const rawMap: Record<string, number> = {};

      for (const srv of services) {
        if (srv?.serviceStatus === "active") {
          const concept = mapServiceToConcept(srv);
          const amount = num(srv?.amount, 0);
          if (amount > 0) rawMap[concept] = (rawMap[concept] ?? 0) + amount;
        }
      }

      const additionalAmount = (enr as any).additionalAmount;
      if (additionalAmount && typeof additionalAmount === "object") {
        for (const [key, value] of Object.entries(additionalAmount)) {
          const amount = num(value, 0);
          if (amount > 0) {
            rawMap[key] = (rawMap[key] ?? 0) + amount;
          }
        }
      }

      const amountsList: InvoiceAmount[] = normalizeInvoiceAmounts(rawMap);
      if (!Array.isArray(amountsList)) {
        strapi.log.debug(
          `⚠️ [Cron] amountsList invalid for enrollment ${enr.id}, skipping`,
        );
        continue;
      }

      const subtotal = subtotalFromAmounts(amountsList);
      if (subtotal <= 0) continue;

      const { iva, total } = calculateIVA(subtotal);

      const monthName = now.toLocaleDateString("es-ES", {
        month: "long",
        year: "numeric",
      });
      const currentDate = now.toLocaleDateString("es-ES");
      const studentName = (enr as any).student?.name || "Estudiante";
      const invoiceTitle = `Recibo mensual - ${monthName} - ${studentName} - ${currentDate}`;
      const invoiceNote = `Recibo generado automáticamente por el sistema el ${currentDate} para los servicios del mes de ${monthName}.`;

      strapi.log.debug(
        `💰 [Cron] Guardando amounts para enrollment ${(enr as any).id}:`,
        JSON.stringify(amountsList),
      );

      // Obtener guardian principal para el recibo
      const primaryGuardian = getPrimaryGuardian(enr);

      try {
        // Usar Document Service y 'connect' con documentId para relaciones
        const invoiceData: any = {
          invoiceCategory: "invoice_enrollment",
          invoiceType: "charge",
          invoiceStatus: "unpaid",
          // Relaciones one/many-to-one: para Document Service usar directamente el documentId o connect: documentId
          enrollment: (enr as any).documentId,
          emissionDate: now.toISOString(),
          expirationDate: getLastDayOfMonth(now).toISOString(),
          amounts: amountsList as any,
          total,
          IVA: iva,
          issuedby: "Sistema",
          registeredBy: "system" as const,
          title: invoiceTitle,
          notes: invoiceNote,
        };

        // Agregar relación con guardian si existe (con documentId)
        if (primaryGuardian?.documentId) {
          invoiceData.guardian = primaryGuardian.documentId;
        }

        const createdInvoice = await strapi
          .documents("api::invoice.invoice")
          .create({ data: invoiceData, status: "published" });
        // Verificar que el snapshot se haya poblado por lifecycles
        try {
          const fetched = (await strapi
            .documents("api::invoice.invoice")
            .findOne({
              documentId: createdInvoice.documentId,
              status: "published",
            })) as InvoiceEntityWithSnapshot;
          if (!fetched?.partySnapshot) {
            strapi.log.warn(
              `⚠️ [Cron] Invoice creada sin partySnapshot (enrollment=${(enr as any).id}, docId=${createdInvoice.documentId}). Revisar lifecycles.`,
            );
          } else {
            strapi.log.info(
              `✅ [Cron] Invoice snapshot poblado (enrollment=${(enr as any).id}, docId=${createdInvoice.documentId}, type=${fetched?.partySnapshot?.partyType})`,
            );
          }
        } catch (snapErr) {
          strapi.log.warn(
            `⚠️ [Cron] No se pudo verificar partySnapshot para invoice de enrollment ${(enr as any).id}: ${
              (snapErr as any)?.message || snapErr
            }`,
          );
        }
        createdCount++;
      } catch (err) {
        strapi.log.error(
          `❌ [Cron] Error creando invoice para enrollment ${(enr as any).id}:`,
          err && (err as Error).message ? (err as Error).message : err,
        );
        // seguir con el siguiente
      }
    } catch (err) {
      strapi.log.error(
        `❌ [Cron] Error procesando enrollment ${(enr as any).id}:`,
        err && (err as Error).message ? (err as Error).message : err,
      );
    }
  }

  // Log detallado de estadísticas
  const skippedDetails = [];
  if (skippedNoSchoolPeriod > 0) {
    skippedDetails.push(`${skippedNoSchoolPeriod} sin periodo escolar`);
  }
  if (skippedOutOfRange > 0) {
    skippedDetails.push(`${skippedOutOfRange} fuera de rango`);
  }

  const skippedText =
    skippedDetails.length > 0 ? `, omitidos: ${skippedDetails.join(", ")}` : "";

  strapi.log.info(
    `📊 [Cron] Facturas de alumnos creadas: ${createdCount}${skippedText}`,
  );
  return { created: createdCount, skipped: skippedCount };
};

/**
 * Create payroll invoices for active employees (batched, safe)
 */
export const generateEmployeePayrolls = async ({
  strapi,
  billingConfig,
}: TaskContext & { billingConfig: BillingConfig }): Promise<{
  created: number;
  skipped: number;
}> => {
  const now = getMadridTime(); // Usar hora de Madrid

  const employeeList = await fetchAllBatched(
    strapi,
    "api::employee.employee",
    { terms: true },
    500,
    { isActive: true },
  );

  strapi.log.info(
    `👷 [Cron] Empleados activos encontrados: ${employeeList.length}`,
  );
  let createdCount = 0;
  let skippedCount = 0;

  for (const emp of employeeList) {
    try {
      const terms = Array.isArray((emp as any).terms) ? (emp as any).terms : [];

      strapi.log.info(
        `🔍 [Cron] Procesando empleado: ${(emp as any).name} (ID: ${(emp as any).id}) - Términos: ${terms.length}`,
      );

      const latest = terms[terms.length - 1];
      if (!latest) {
        strapi.log.warn(
          `⚠️ [Cron] Empleado ${(emp as any).name} sin términos de contrato, omitiendo`,
        );
        continue;
      }

      const period = latest?.paymentPeriod || "monthly";
      const employeeName = (emp as any).name || "Empleado";

      // En modo test, forzar día efectivo al día actual para no depender de billingDay
      const effectiveBillingDay = billingConfig?.testMode
        ? now.getDate()
        : billingConfig?.day;

      if (!shouldBillEmployee(period, now, effectiveBillingDay)) {
        strapi.log.warn(
          `⏭️ [Cron] Empleado ${employeeName} (${period}) no debe ser facturado hoy, omitiendo`,
        );
        skippedCount++;
        continue;
      }

      const baseSalary = calculateSalaryAmount(
        period,
        latest?.hourlyRate,
        latest?.workedHours,
        now,
      );

      // additional amounts (object)
      let additionalTotal = 0;
      const additionalAmount = (emp as any).additionalAmount;
      if (additionalAmount && typeof additionalAmount === "object") {
        for (const value of Object.values(additionalAmount)) {
          additionalTotal += num(value, 0);
        }
      }

      const salary = baseSalary + additionalTotal;

      if (!Number.isFinite(salary) || salary <= 0) {
        strapi.log.warn(
          `⚠️ [Cron] Empleado ${employeeName} con salario inválido (${salary}), omitiendo`,
        );
        continue;
      }

      const { iva, total } = calculateIVA(salary);

      const monthName = now.toLocaleDateString("es-ES", {
        month: "long",
        year: "numeric",
      });
      const currentDate = now.toLocaleDateString("es-ES");

      const periodLabels: Record<string, string> = {
        monthly: "Mensual",
        biweekly: "Quincenal",
        weekly: "Semanal",
        daily: "Diaria",
        annual: "Anual",
      };

      const periodLabel = periodLabels[period] || "Mensual";
      const payrollTitle = `Nómina ${periodLabel} - ${employeeName} - ${currentDate}`;
      const payrollNote = `Nómina ${periodLabel.toLowerCase()} generado automáticamente por el sistema el ${currentDate}. Tipo de contrato: ${period}. Salario calculado: €${salary.toFixed(2)}.`;

      const rawPayrollMap: Record<string, number> = {
        "Salario base": baseSalary,
      };

      if (additionalAmount && typeof additionalAmount === "object") {
        for (const [key, value] of Object.entries(additionalAmount)) {
          const amount = num(value, 0);
          if (amount > 0) {
            rawPayrollMap[key] = amount;
          }
        }
      }

      const payrollAmounts = normalizeInvoiceAmounts(rawPayrollMap);

      try {
        // Usar Document Service y 'connect' con documentId para relacionar el empleado
        const invoiceData = {
          invoiceCategory: "invoice_employ" as const,
          invoiceType: "expense" as const,
          invoiceStatus: "unpaid" as const,
          // Relaciones one/many-to-one: pasar el documentId directamente
          employee: (emp as any).documentId,
          emissionDate: now.toISOString(),
          expirationDate: getLastDayOfMonth(now).toISOString(),
          amounts: payrollAmounts as any,
          total,
          IVA: iva,
          issuedby: "Sistema",
          registeredBy: "system" as const,
          title: payrollTitle,
          notes: payrollNote,
        };

        const createdInvoice = await strapi
          .documents("api::invoice.invoice")
          .create({ data: invoiceData, status: "published" });

        strapi.log.info(
          `✅ [Cron] Nómina creada para ${employeeName} (${periodLabel}): €${salary.toFixed(2)} - DocumentID: ${createdInvoice.documentId}`,
        );
        // Verificar snapshot poblado
        try {
          const fetched = (await strapi
            .documents("api::invoice.invoice")
            .findOne({
              documentId: createdInvoice.documentId,
              status: "published",
            })) as InvoiceEntityWithSnapshot;
          if (!fetched?.partySnapshot) {
            strapi.log.warn(
              `⚠️ [Cron] Nómina creada sin partySnapshot (employee=${(emp as any).id}, docId=${createdInvoice.documentId}). Revisar lifecycles.`,
            );
          } else {
            strapi.log.info(
              `✅ [Cron] Payroll snapshot poblado (employee=${(emp as any).id}, docId=${createdInvoice.documentId}, type=${fetched?.partySnapshot?.partyType})`,
            );
          }
        } catch (snapErr) {
          strapi.log.warn(
            `⚠️ [Cron] No se pudo verificar partySnapshot para nómina de empleado ${(emp as any).id}: ${
              (snapErr as any)?.message || snapErr
            }`,
          );
        }
        createdCount++;
      } catch (err) {
        strapi.log.error(
          `❌ [Cron] Error creando nómina para empleado ${(emp as any).id} (${employeeName}):`,
          err && (err as Error).message ? (err as Error).message : err,
        );
        strapi.log.error(
          `❌ [Cron] Stack trace:`,
          err && (err as Error).stack
            ? (err as Error).stack
            : "No stack trace available",
        );
      }
    } catch (err) {
      strapi.log.error(
        `❌ [Cron] Error procesando empleado ${(emp as any).id} (${(emp as any).name}):`,
        err && (err as Error).message ? (err as Error).message : err,
      );
      strapi.log.error(
        `❌ [Cron] Stack trace del error general:`,
        err && (err as Error).stack
          ? (err as Error).stack
          : "No stack trace available",
      );
    }

    strapi.log.info(
      `🔍 [Cron] Terminado procesamiento de empleado: ${(emp as any).name} (ID: ${(emp as any).id})`,
    );
  }

  strapi.log.info(
    `📊 [Cron] Resumen de nóminas: ${createdCount} creadas, ${skippedCount} omitidas por frecuencia de pago`,
  );
  return { created: createdCount, skipped: skippedCount };
};
