import type { Core } from "@strapi/types";
import {
  normalizeInvoiceAmounts,
  subtotalFromAmounts,
  type InvoiceAmount,
} from "../src/utils/invoice-amounts";

// VAT rate (21% Spain)
const IVA_RATE = 0.21;

/**
 * DEFAULT RULE:
 * - We schedule the job to run each minute and let the task decide whether to
 *   actually perform billing (based on DB flags: test_mode, day/hour/minute).
 * Reason: Strapi's job registration reads the rule at startup. To allow
 * dynamic control from the DB without restarting the process, we poll each minute.
 */
const DEFAULT_RUN_EVERY_MINUTE_RULE =
  process.env.BILLING_CRON_RULE || "*/1 * * * *";

type BillingConfig = {
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

/**
 * Helper: get billing configuration from cron-day content type
 * - Returns the first record (if any) and its id to allow updates.
 */
const getBillingConfig = async (
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
 * Helper: generate cron rule based on billing configuration (kept for reference)
 * Note: not used to register the job dynamically (see file top); task decides execution.
 */
const generateCronRule = (config: BillingConfig): string => {
  if (config.testMode) {
    return `*/${config.testIntervalMinutes} * * * *`; // every X minutes (5-field cron)
  }
  return `${config.minute} ${config.hour} ${config.day} * *`;
};

/**
 * Helper: update execution timestamps in billing configuration (uses the record id)
 */
const updateExecutionTimestamps = async (
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
const logCronExecution = async (
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
const getMonthBounds = (date = new Date()) => {
  const start = new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 1, 0, 0, 0, 0);
  return { start: start.toISOString(), end: end.toISOString() };
};

/**
 * Safely convert to number
 */
const num = (v: unknown, fallback = 0): number => {
  const n =
    typeof v === "string" ? Number(v) : typeof v === "number" ? v : fallback;
  return Number.isFinite(n) ? n : fallback;
};

/**
 * Calculate VAT and total
 * TEMPORAL: IVA desactivado - solo devuelve el subtotal como total
 */
const calculateIVA = (subtotal: number) => {
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
const getLastDayOfMonth = (d: Date) =>
  new Date(d.getFullYear(), d.getMonth() + 1, 0);

/**
 * Decide whether to bill employee based on paymentPeriod and billingDay (if provided)
 * - billingDay is used for 'monthly' to respect the configured day in DB
 */
const shouldBillEmployee = (
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
const calculateSalaryAmount = (
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
const fetchAllBatched = async (
  strapi: Core.Strapi,
  entity: string,
  populate: any = {},
  batch = 500,
  filters: any = {},
) => {
  let start = 0;
  const results: any[] = [];
  while (true) {
    const page = (await strapi.entityService.findMany(entity as any, {
      filters,
      populate,
      start,
      limit: batch,
    })) as any[];

    if (!Array.isArray(page) || page.length === 0) break;
    results.push(...page);
    if (page.length < batch) break;
    start += batch;
  }
  return results;
};

/**
 * Map service types and titles to proper invoice concepts for fiscal reporting
 */
const mapServiceToConcept = (service: any): string => {
  const title = (service?.title || "").toLowerCase().trim();
  const serviceType = service?.serviceType || "";

  // Mapeo específico por título
  if (title.includes("matricula") || title.includes("matrícula") || title.includes("inscription")) {
    return "matricula";
  }
  if (title.includes("comedor") || title.includes("lunch") || title.includes("almuerzo")) {
    return "comedor";
  }
  if (title.includes("transporte") || title.includes("transport") || title.includes("bus")) {
    return "transporte";
  }
  if (title.includes("material") || title.includes("libro") || title.includes("supplies")) {
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
const generateEnrollmentInvoices = async ({
  strapi,
  billingConfig,
}: TaskContext & { billingConfig: BillingConfig }): Promise<{
  created: number;
}> => {
  const now = new Date();
  const { start, end } = getMonthBounds(now);

  strapi.log.info(`📅 [Cron] Período de facturación: ${start} a ${end}`);

  const enrollmentList = await fetchAllBatched(
    strapi,
    "api::enrollment.enrollment",
    { services: true, student: true },
    500,
    { isActive: true },
  );

  strapi.log.info(
    `👥 [Cron] Enrollments activos encontrados: ${enrollmentList.length}`,
  );
  let createdCount = 0;

  for (const enr of enrollmentList) {
    try {
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
      const invoiceTitle = `Factura mensual - ${monthName} - ${studentName} - ${currentDate}`;
      const invoiceNote = `Factura generada automáticamente por el sistema el ${currentDate} para los servicios del mes de ${monthName}.`;

      strapi.log.debug(
        `💰 [Cron] Guardando amounts para enrollment ${(enr as any).id}:`,
        JSON.stringify(amountsList),
      );

      try {
        await strapi.entityService.create("api::invoice.invoice", {
          data: {
            invoiceCategory: "invoice_enrollment",
            invoiceType: "charge",
            invoiceStatus: "unpaid",
            enrollment: (enr as any).id,
            emissionDate: now.toISOString(),
            expirationDate: getLastDayOfMonth(now).toISOString(),
            amounts: amountsList as any,
            total,
            IVA: iva,
            issuedby: "Sistema",
            registeredBy: "system",
            title: invoiceTitle,
            notes: invoiceNote,
            publishedAt: now.toISOString(),
          },
        });
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

  strapi.log.info(`📊 [Cron] Facturas de alumnos creadas: ${createdCount}`);
  return { created: createdCount };
};

/**
 * Create payroll invoices for active employees (batched, safe)
 */
const generateEmployeePayrolls = async ({
  strapi,
  billingConfig,
}: TaskContext & { billingConfig: BillingConfig }): Promise<{
  created: number;
  skipped: number;
}> => {
  const now = new Date();

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
      const latest = terms[terms.length - 1];
      if (!latest) {
        strapi.log.debug(
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
        strapi.log.debug(
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
        strapi.log.debug(
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
      const payrollNote = `Nómina ${periodLabel.toLowerCase()} generada automáticamente por el sistema el ${currentDate}. Tipo de contrato: ${period}. Salario calculado: €${salary.toFixed(2)}.`;

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
      const payrollSubtotal = subtotalFromAmounts(payrollAmounts);

      strapi.log.debug(
        `💰 [Cron] Guardando amounts para employee ${employeeName} (${period}):`,
        JSON.stringify(payrollAmounts),
      );

      // (Se elimina control de duplicados para permitir múltiples nóminas por mes según solicitud)

      try {
        await strapi.entityService.create("api::invoice.invoice", {
          data: {
            invoiceCategory: "invoice_employ",
            invoiceType: "expense",
            invoiceStatus: "unpaid",
            employee: (emp as any).id,
            emissionDate: now.toISOString(),
            expirationDate: getLastDayOfMonth(now).toISOString(),
            amounts: payrollAmounts as any,
            total,
            IVA: iva,
            issuedby: "Sistema",
            registeredBy: "system",
            title: payrollTitle,
            notes: payrollNote,
            publishedAt: now.toISOString(),
          },
        });

        strapi.log.info(
          `✅ [Cron] Nómina creada para ${employeeName} (${periodLabel}): €${salary.toFixed(2)}`,
        );
        createdCount++;
      } catch (err) {
        strapi.log.error(
          `❌ [Cron] Error creando nómina para empleado ${(emp as any).id}:`,
          err && (err as Error).message ? (err as Error).message : err,
        );
      }
    } catch (err) {
      strapi.log.error(
        `❌ [Cron] Error procesando empleado ${(emp as any).id}:`,
        err && (err as Error).message ? (err as Error).message : err,
      );
    }
  }

  strapi.log.info(
    `📊 [Cron] Resumen de nóminas: ${createdCount} creadas, ${skippedCount} omitidas por frecuencia de pago`,
  );
  return { created: createdCount, skipped: skippedCount };
};

type TaskContext = { strapi: Core.Strapi };

/**
 * The exported cron job definition
 * - options.rule: job runs every minute by default (see DEFAULT_RUN_EVERY_MINUTE_RULE)
 * - task: reads DB config and decides whether to execute billing
 */
console.log("🔧 [Cron] Cargando configuración de cron-tasks.ts");
console.log("🔧 [Cron] Regla del cron:", DEFAULT_RUN_EVERY_MINUTE_RULE);

export default {
  monthly_billing: {
    options: {
      rule: DEFAULT_RUN_EVERY_MINUTE_RULE,
      tz: "Europe/Madrid",
    },
    task: async (ctx: TaskContext) => {
      const startTime = Date.now();

      // Log para confirmar que el cron se está ejecutando
      ctx.strapi.log.info(
        `🔄 [Cron] Ejecutando verificación de facturación - ${new Date().toISOString()}`,
      );

      // Obtener configuración de facturación
      const billingConfig = await getBillingConfig(ctx.strapi);

      // Log para ver la configuración obtenida
      ctx.strapi.log.info(
        `🔧 [Cron] Config: active=${billingConfig.isActive}, testMode=${billingConfig.testMode}, interval=${billingConfig.testIntervalMinutes}min, lastExec=${billingConfig.lastExecution?.toISOString()}`,
      );

      // Verificar si el CRON está activo
      if (!billingConfig.isActive) {
        ctx.strapi.log.warn(
          `⏸️  [Cron] Facturación desactivada en configuración - saltando ejecución`,
        );
        return;
      }

      // Si no estamos en modo test, comprobar si es el momento configurado
      const now = new Date();
      if (!billingConfig.testMode) {
        // Solo ejecutar si día, hora y minuto coinciden con la configuración
        if (
          now.getDate() !== billingConfig.day ||
          now.getHours() !== billingConfig.hour ||
          now.getMinutes() !== billingConfig.minute
        ) {
          // Not the configured time -> skip
          return;
        }
      } else {
        // En modo test, verificar si han pasado suficientes minutos desde la última ejecución
        ctx.strapi.log.info(
          `🧪 [Cron] Modo test activado - Verificando última ejecución`,
        );

        if (billingConfig.lastExecution) {
          const nowTime = now.getTime();
          const lastTime = billingConfig.lastExecution.getTime();
          const diffMs = nowTime - lastTime;
          const diffMin = Math.floor(diffMs / (60 * 1000));

          ctx.strapi.log.info(
            `🧪 [Cron] Ahora: ${now.toISOString()}, Última: ${billingConfig.lastExecution.toISOString()}`,
          );
          ctx.strapi.log.info(
            `🧪 [Cron] Diferencia: ${diffMin} minutos (necesarios: ${billingConfig.testIntervalMinutes})`,
          );

          if (diffMin < billingConfig.testIntervalMinutes) {
            // aún no llegó el intervalo mínimo de test -> saltar
            ctx.strapi.log.info(
              `⏳ [Cron] Modo test: faltan ${billingConfig.testIntervalMinutes - diffMin} minutos para la próxima ejecución`,
            );
            return;
          }
        }
        // Si no hay lastExecution o ya pasó el tiempo, continuar con la ejecución
        ctx.strapi.log.info(
          `🧪 [Cron] Modo test: ejecutando (intervalo: ${billingConfig.testIntervalMinutes} min)`,
        );
      }

      const timestamp = new Date().toLocaleString("es-ES", {
        timeZone: billingConfig.timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });

      const modeText = billingConfig.testMode
        ? `MODO TESTEO (cada ${billingConfig.testIntervalMinutes} min)`
        : `MODO PRODUCCIÓN (día ${billingConfig.day} a las ${billingConfig.hour}:${billingConfig.minute.toString().padStart(2, "0")})`;

      ctx.strapi.log.info(
        `🕐 [Cron] INICIO - Ejecutando facturación (${timestamp})`,
      );
      ctx.strapi.log.info(
        `⚙️  [Cron] Configuración: ${modeText} - Zona horaria: ${billingConfig.timezone}`,
      );

      // Registrar inicio en history
      await logCronExecution(ctx.strapi, {
        title: "Cron Facturación - Inicio",
        message: `Iniciando proceso de facturación automática. ${modeText}`,
        level: "INFO",
        event_type: "cron_billing_start",
        payload: {
          billing_config: billingConfig,
          execution_mode: billingConfig.testMode ? "test" : "production",
          timestamp,
        },
      });

      let enrollmentResults = { created: 0 };
      let payrollResults = { created: 0, skipped: 0 };

      try {
        ctx.strapi.log.info(`📋 [Cron] Generando facturas de enrollment...`);
        enrollmentResults = await generateEnrollmentInvoices({
          strapi: ctx.strapi,
          billingConfig,
        });

        ctx.strapi.log.info(`💰 [Cron] Generando nóminas de empleados...`);
        payrollResults = await generateEmployeePayrolls({
          strapi: ctx.strapi,
          billingConfig,
        });

        const duration = Date.now() - startTime;
        const skippedText =
          payrollResults.skipped && payrollResults.skipped > 0
            ? ` (${payrollResults.skipped} empleados omitidos por frecuencia de pago)`
            : "";
        const successMessage = `Facturación completada exitosamente. Facturas: ${enrollmentResults.created} creadas. Nóminas: ${payrollResults.created} creadas${skippedText}.`;

        ctx.strapi.log.info(
          `✅ [Cron] COMPLETADO - ${successMessage} (${timestamp})`,
        );

        // Actualizar fechas de ejecución usando el id correcto
        await updateExecutionTimestamps(
          ctx.strapi,
          new Date(),
          `Ejecución exitosa: ${enrollmentResults.created} facturas, ${payrollResults.created} nóminas${skippedText}`,
        );

        // Registrar éxito en history
        await logCronExecution(ctx.strapi, {
          title: "Cron Facturación - Completado",
          message: successMessage,
          level: "INFO",
          event_type: "cron_billing_success",
          duration_ms: duration.toString(),
          payload: {
            billing_config: billingConfig,
            execution_duration_ms: duration,
            enrollment_invoices: enrollmentResults,
            employee_payrolls: payrollResults,
            timestamp,
          },
        });
      } catch (error) {
        const duration = Date.now() - startTime;
        const errorMessage = `Falló la facturación: ${(error && (error as Error).message) || error}`;

        ctx.strapi.log.error(`❌ [Cron] ERROR - ${errorMessage}`);

        // Actualizar fechas de ejecución incluso en error
        await updateExecutionTimestamps(
          ctx.strapi,
          new Date(),
          `Error en ejecución: ${errorMessage}`,
        );

        // Registrar error en history
        await logCronExecution(ctx.strapi, {
          title: "Cron Facturación - Error",
          message: errorMessage,
          level: "ERROR",
          event_type: "cron_billing_error",
          duration_ms: duration.toString(),
          status_code: "500",
          payload: {
            billing_config: billingConfig,
            execution_duration_ms: duration,
            error_message: (error && (error as Error).message) || error,
            error_stack:
              error && (error as Error).stack
                ? (error as Error).stack
                : undefined,
            timestamp,
          },
        });

        throw error;
      }
    },
  },
};
