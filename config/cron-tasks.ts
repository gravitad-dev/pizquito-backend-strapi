import type { Core } from "@strapi/types";

// Tasa de IVA (21% en España)
const IVA_RATE = 0.21;

/**
 * Helper: get billing configuration from cron-day content type
 */
const getBillingConfig = async (
  strapi: Core.Strapi,
): Promise<{
  day: number;
  hour: number;
  minute: number;
  testMode: boolean;
  testIntervalMinutes: number;
  timezone: string;
  isActive: boolean;
}> => {
  try {
    const cronDayConfig = (await strapi.entityService.findMany(
      "api::cron-day.cron-day",
      {
        limit: 1,
      },
    )) as any;

    if (cronDayConfig) {
      return {
        day: cronDayConfig.cron_day || 25,
        hour: cronDayConfig.cron_hour || 5,
        minute: cronDayConfig.cron_minute || 0,
        testMode: cronDayConfig.test_mode || false,
        testIntervalMinutes: cronDayConfig.test_interval_minutes || 5,
        timezone: cronDayConfig.timezone || "Europe/Madrid",
        isActive: cronDayConfig.is_active !== false, // Default true
      };
    }
  } catch (error) {
    console.warn(
      "⚠️  No se pudo obtener la configuración de billing, usando valores por defecto",
    );
  }

  // Valores por defecto
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
 * Helper: get billing day from cron-day content type (backward compatibility)
 */
const getBillingDay = async (strapi: Core.Strapi): Promise<number> => {
  const config = await getBillingConfig(strapi);
  return config.day;
};

/**
 * Helper: generate cron rule based on billing configuration
 */
const generateCronRule = async (strapi: Core.Strapi): Promise<string> => {
  const config = await getBillingConfig(strapi);

  // Si está en modo de testeo, usar intervalo de minutos
  if (config.testMode) {
    return `*/${config.testIntervalMinutes} * * * *`; // Cada X minutos
  }

  // Modo normal: ejecutar en el día, hora y minuto configurados
  return `${config.minute} ${config.hour} ${config.day} * *`;
};

/**
 * Helper: update execution timestamps in billing configuration
 */
const updateExecutionTimestamps = async (
  strapi: Core.Strapi,
  lastExecution: Date,
  notes?: string,
): Promise<void> => {
  try {
    const config = await getBillingConfig(strapi);

    // Calcular próxima ejecución
    let nextExecution: Date;
    if (config.testMode) {
      // En modo test, próxima ejecución es en X minutos
      nextExecution = new Date(
        lastExecution.getTime() + config.testIntervalMinutes * 60 * 1000,
      );
    } else {
      // En modo producción, próxima ejecución es el próximo mes en el día configurado
      nextExecution = new Date(lastExecution);
      nextExecution.setMonth(nextExecution.getMonth() + 1);
      nextExecution.setDate(config.day);
      nextExecution.setHours(config.hour, config.minute, 0, 0);
    }

    await strapi.entityService.update("api::cron-day.cron-day", 1, {
      data: {
        last_execution: lastExecution.toISOString(),
        next_execution: nextExecution.toISOString(),
        execution_notes:
          notes ||
          `Última ejecución: ${lastExecution.toLocaleString("es-ES", { timeZone: config.timezone })}`,
      } as any, // TODO: Remove when Strapi types are fully regenerated
    });
  } catch (error) {
    strapi.log.warn(
      "⚠️  No se pudieron actualizar las fechas de ejecución:",
      error.message,
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
    console.error("❌ Error al registrar en history:", error);
  }
};

// CONFIGURACIÓN DE PRUEBA: Ejecutar cada 5 minutos
// Para producción, usar: await generateCronRule(strapi)
const DEFAULT_MONTHLY_RULE = `0 */5 * * * *`;

type TaskContext = { strapi: Core.Strapi };

type BillingResults = {
  created: number;
  skipped?: number;
};

/**
 * Helper: get start and end ISO for current month
 */
const getMonthBounds = (date = new Date()) => {
  const start = new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 1, 0, 0, 0, 0);
  return { start: start.toISOString(), end: end.toISOString() };
};

/**
 * Helper: safely to number
 */
const num = (v: unknown, fallback = 0): number => {
  const n =
    typeof v === "string" ? Number(v) : typeof v === "number" ? v : fallback;
  return Number.isFinite(n) ? n : fallback;
};

/**
 * Calcula el IVA y el total con IVA incluido
 * @param subtotal - Importe sin IVA
 * @returns Objeto con IVA calculado y total con IVA
 */
const calculateIVA = (subtotal: number) => {
  const iva = Math.round(subtotal * IVA_RATE * 100) / 100; // Redondear a 2 decimales
  const total = Math.round((subtotal + iva) * 100) / 100; // Redondear a 2 decimales
  return { iva, total };
};

/**
 * Determine if an employee should be billed based on their contract payment period
 * and the current execution date
 */
const shouldBillEmployee = (
  paymentPeriod: string,
  currentDate: Date,
): boolean => {
  const day = currentDate.getDate();

  switch (paymentPeriod) {
    case "monthly":
      // Monthly employees are billed once per month (on the configured billing day)
      return true;

    case "biweekly":
      // Biweekly employees are billed twice per month: on days 1-2 and 15-16
      return (day >= 1 && day <= 2) || (day >= 15 && day <= 16);

    case "weekly":
      // Weekly employees are billed every Monday (day 1 of the week)
      return currentDate.getDay() === 1; // Monday

    case "daily":
      // Daily employees are billed every day
      return true;

    case "annual":
      // Annual employees are billed once per year (only in January)
      return currentDate.getMonth() === 0 && day >= 1 && day <= 2;

    default:
      // Unknown payment period, default to monthly
      return true;
  }
};

/**
 * Calculate salary amount based on payment period and contract terms
 */
const calculateSalaryAmount = (
  paymentPeriod: string,
  hourlyRate: number,
  workedHours: number,
  currentDate: Date,
): number => {
  const hourly = num(hourlyRate, 0);
  const hours = num(workedHours, 0);

  switch (paymentPeriod) {
    case "monthly":
      // Monthly: full monthly amount
      return hourly > 0 && hours > 0 ? hourly * hours : hourly;

    case "biweekly":
      // Biweekly: half of monthly amount
      const monthlyAmount = hourly > 0 && hours > 0 ? hourly * hours : hourly;
      return monthlyAmount / 2;

    case "weekly":
      // Weekly: quarter of monthly amount
      const weeklyBase = hourly > 0 && hours > 0 ? hourly * hours : hourly;
      return weeklyBase / 4;

    case "daily":
      // Daily: hourly rate * daily hours (assuming 8 hours per day)
      return hourly * (hours > 0 ? hours / 22 : 8); // 22 working days per month average

    case "annual":
      // Annual: full yearly amount (only billed once per year)
      const annualAmount = hourly > 0 && hours > 0 ? hourly * hours : hourly;
      return annualAmount * 12; // 12 months

    default:
      // Default to monthly calculation
      return hourly > 0 && hours > 0 ? hourly * hours : hourly;
  }
};

/**
 * Create monthly invoices for active enrollments that are unpaid.
 * - Aggregates active student services amounts per enrollment.
 * - Avoids duplicates within the month.
 */
const generateEnrollmentInvoices = async ({
  strapi,
}: TaskContext): Promise<BillingResults> => {
  const now = new Date();
  const { start, end } = getMonthBounds(now);

  strapi.log.info(`📅 [Cron] Período de facturación: ${start} a ${end}`);

  const enrollments = await strapi.entityService.findMany(
    "api::enrollment.enrollment",
    {
      filters: { isActive: true },
      populate: { services: true, student: true },
      limit: 10000,
    },
  );
  const enrollmentList = Array.isArray(enrollments) ? enrollments : [];

  strapi.log.info(
    `👥 [Cron] Enrollments activos encontrados: ${enrollmentList.length}`,
  );
  let createdCount = 0;

  for (const enr of enrollmentList) {
    const services = Array.isArray((enr as any).services)
      ? (enr as any).services
      : [];
    const amounts: Record<string, number> = {};
    for (const srv of services) {
      // Any active service contributes to the invoice
      if (srv?.serviceStatus === "active") {
        const title = srv?.title ?? "Servicio";
        const amount = num(srv?.amount, 0);
        if (amount > 0) amounts[title] = (amounts[title] ?? 0) + amount;
      }
    }

    // Agregar additionalAmount del enrollment si existe
    const additionalAmount = (enr as any).additionalAmount;
    if (additionalAmount && typeof additionalAmount === "object") {
      for (const [key, value] of Object.entries(additionalAmount)) {
        const amount = num(value, 0);
        if (amount > 0) {
          amounts[key] = (amounts[key] ?? 0) + amount;
        }
      }
    }

    const subtotal = Object.values(amounts).reduce((a, b) => a + b, 0);
    if (subtotal <= 0) continue; // Nothing to bill

    // Calcular IVA y total con IVA incluido
    const { iva, total } = calculateIVA(subtotal);

    // CAMBIO: Eliminar verificación de duplicados - generar facturas nuevas en cada ejecución
    // Según requerimiento del jefe: "El cron de facturas en cada ejecución debe generar facturas nuevas"

    // Generar título y nota para la factura
    const monthName = now.toLocaleDateString("es-ES", {
      month: "long",
      year: "numeric",
    });
    const currentDate = now.toLocaleDateString("es-ES");
    const studentName = (enr as any).student?.name || "Estudiante";
    const invoiceTitle = `Factura mensual - ${monthName} - ${studentName} - ${currentDate}`;
    const invoiceNote = `Factura generada automáticamente por el sistema el ${currentDate} para los servicios del mes de ${monthName}.`;

    // Debug: Log amounts before saving
    strapi.log.debug(
      `💰 [Cron] Guardando amounts para enrollment ${(enr as any).id}:`,
      JSON.stringify(amounts),
    );

    await strapi.entityService.create("api::invoice.invoice", {
      data: {
        invoiceCategory: "invoice_enrollment",
        invoiceType: "charge",
        invoiceStatus: "unpaid",
        enrollment: (enr as any).id,
        emissionDate: now.toISOString(),
        expirationDate: new Date(
          now.getFullYear(),
          now.getMonth(),
          30,
        ).toISOString(),
        amounts: amounts, // Asegurar que se guarde como JSON
        total,
        IVA: iva,
        issuedby: "Sistema",
        registeredBy: "system",
        title: invoiceTitle,
        notes: invoiceNote,
        publishedAt: now.toISOString(), // Asegurar que se publique
      },
    });
    createdCount++;
  }

  strapi.log.info(`📊 [Cron] Facturas de alumnos creadas: ${createdCount}`);
  return { created: createdCount };
};

/**
 * Create payroll invoices for active employees based on their contract terms.
 * - Uses the latest contract term and respects payment period (monthly, biweekly, weekly, daily, annual).
 * - Only bills employees when appropriate based on their payment frequency.
 */
const generateEmployeePayrolls = async ({
  strapi,
}: TaskContext): Promise<BillingResults> => {
  const now = new Date();
  const { start, end } = getMonthBounds(now);

  const employees = await strapi.entityService.findMany(
    "api::employee.employee",
    {
      filters: { isActive: true },
      populate: { terms: true },
      limit: 10000,
    },
  );
  const employeeList = Array.isArray(employees) ? employees : [];

  strapi.log.info(
    `👷 [Cron] Empleados activos encontrados: ${employeeList.length}`,
  );
  let createdCount = 0;
  let skippedCount = 0;

  for (const emp of employeeList) {
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

    // Check if this employee should be billed based on their payment period
    if (!shouldBillEmployee(period, now)) {
      strapi.log.debug(
        `⏭️ [Cron] Empleado ${employeeName} (${period}) no debe ser facturado hoy, omitiendo`,
      );
      skippedCount++;
      continue;
    }

    // Calculate salary based on payment period
    const baseSalary = calculateSalaryAmount(
      period,
      latest?.hourlyRate,
      latest?.workedHours,
      now,
    );

    // Agregar additionalAmount del empleado si existe
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

    // Calcular IVA y total con IVA incluido
    const { iva, total } = calculateIVA(salary);

    // CAMBIO: Eliminar verificación de duplicados - generar nóminas nuevas en cada ejecución
    // Según requerimiento del jefe: "El cron de facturas en cada ejecución debe generar facturas nuevas"

    // Generar título y nota para la nómina según el tipo de contrato
    const monthName = now.toLocaleDateString("es-ES", {
      month: "long",
      year: "numeric",
    });
    const currentDate = now.toLocaleDateString("es-ES");

    // Personalizar título según frecuencia de pago
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

    // Debug: Log amounts before saving
    const payrollAmounts: Record<string, number> = {
      salario_base: baseSalary,
      tipo_contrato: period,
      tarifa_hora: latest?.hourlyRate || 0,
      horas_trabajadas: latest?.workedHours || 0,
    };

    // Agregar additionalAmount detallados al objeto amounts
    if (additionalAmount && typeof additionalAmount === "object") {
      for (const [key, value] of Object.entries(additionalAmount)) {
        const amount = num(value, 0);
        if (amount > 0) {
          payrollAmounts[key] = amount;
        }
      }
    }
    strapi.log.debug(
      `💰 [Cron] Guardando amounts para employee ${employeeName} (${period}):`,
      JSON.stringify(payrollAmounts),
    );

    await strapi.entityService.create("api::invoice.invoice", {
      data: {
        invoiceCategory: "invoice_employ",
        invoiceType: "expense",
        invoiceStatus: "unpaid",
        employee: (emp as any).id,
        emissionDate: now.toISOString(),
        expirationDate: new Date(
          now.getFullYear(),
          now.getMonth(),
          30,
        ).toISOString(),
        amounts: payrollAmounts, // Asegurar que se guarde como JSON
        total,
        IVA: iva,
        issuedby: "Sistema",
        registeredBy: "system",
        title: payrollTitle,
        notes: payrollNote,
        publishedAt: now.toISOString(), // Asegurar que se publique
      },
    });

    strapi.log.info(
      `✅ [Cron] Nómina creada para ${employeeName} (${periodLabel}): €${salary.toFixed(2)}`,
    );
    createdCount++;
  }

  strapi.log.info(
    `📊 [Cron] Resumen de nóminas: ${createdCount} creadas, ${skippedCount} omitidas por frecuencia de pago`,
  );
  return { created: createdCount, skipped: skippedCount };
};

export default {
  monthly_billing: {
    options: {
      rule: process.env.BILLING_CRON_RULE || DEFAULT_MONTHLY_RULE,
      tz: "Europe/Madrid",
    },
    task: async (ctx: TaskContext) => {
      const startTime = Date.now();

      // Obtener configuración de facturación
      const billingConfig = await getBillingConfig(ctx.strapi);

      // Verificar si el CRON está activo
      if (!billingConfig.isActive) {
        ctx.strapi.log.warn(
          `⏸️  [Cron] Facturación desactivada en configuración - saltando ejecución`,
        );
        return;
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
        `🕐 [Cron] INICIO - Ejecutando facturación mensual (${timestamp})`,
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
          timestamp: timestamp,
        },
      });

      let enrollmentResults: BillingResults = { created: 0 };
      let payrollResults: BillingResults = { created: 0, skipped: 0 };

      try {
        ctx.strapi.log.info(`📋 [Cron] Generando facturas de enrollment...`);
        enrollmentResults = await generateEnrollmentInvoices(ctx);

        ctx.strapi.log.info(`💰 [Cron] Generando nóminas de empleados...`);
        payrollResults = await generateEmployeePayrolls(ctx);

        const duration = Date.now() - startTime;
        const skippedText =
          payrollResults.skipped > 0
            ? ` (${payrollResults.skipped} empleados omitidos por frecuencia de pago)`
            : "";
        const successMessage = `Facturación completada exitosamente. Facturas: ${enrollmentResults.created} creadas. Nóminas: ${payrollResults.created} creadas${skippedText}.`;

        ctx.strapi.log.info(
          `✅ [Cron] COMPLETADO - ${successMessage} (${timestamp})`,
        );

        // Actualizar fechas de ejecución
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
            timestamp: timestamp,
          },
        });
      } catch (error) {
        const duration = Date.now() - startTime;
        const errorMessage = `Falló la facturación mensual: ${error.message}`;

        ctx.strapi.log.error(`❌ [Cron] ERROR - ${errorMessage}`);

        // Actualizar fechas de ejecución incluso en error
        await updateExecutionTimestamps(
          ctx.strapi,
          new Date(),
          `Error en ejecución: ${error.message}`,
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
            error_message: error.message,
            error_stack: error.stack,
            timestamp: timestamp,
          },
        });

        throw error;
      }
    },
  },
};
