import type { Core } from '@strapi/types';

// Tasa de IVA (21% en España)
const IVA_RATE = 0.21;

/**
 * Helper: get billing day from cron-day content type
 */
const getBillingDay = async (strapi: Core.Strapi): Promise<number> => {
  try {
    const cronDayConfig = await strapi.entityService.findMany('api::cron-day.cron-day', {
      limit: 1,
    }) as any;
    
    if (cronDayConfig && typeof cronDayConfig.cron_day === 'number') {
      return cronDayConfig.cron_day;
    }
  } catch (error) {
    console.warn('⚠️  No se pudo obtener la configuración de cron-day, usando valor por defecto');
  }
  
  return 25; // Valor por defecto
};

/**
 * Helper: generate cron rule based on billing day
 */
const generateCronRule = async (strapi: Core.Strapi): Promise<string> => {
  const billingDay = await getBillingDay(strapi);
  // Ejecutar a las 00:00 (medianoche) del día configurado, en horario de Madrid
  return `0 0 0 ${billingDay} * *`;
};

// CONFIGURACIÓN DE PRUEBA: Ejecutar cada 5 minutos
// Para producción, usar: await generateCronRule(strapi)
const DEFAULT_MONTHLY_RULE = `0 */5 * * * *`;

type TaskContext = { strapi: Core.Strapi };

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
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : fallback;
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
 * Create monthly invoices for active enrollments that are unpaid.
 * - Aggregates active student services amounts per enrollment.
 * - Avoids duplicates within the month.
 */
const generateEnrollmentInvoices = async ({ strapi }: TaskContext) => {
  const now = new Date();
  const { start, end } = getMonthBounds(now);

  strapi.log.info(`📅 [Cron] Período de facturación: ${start} a ${end}`);

  const enrollments = await strapi.entityService.findMany('api::enrollment.enrollment', {
    filters: { isActive: true },
    populate: { services: true, student: true },
    limit: 10000,
  });
  const enrollmentList = Array.isArray(enrollments) ? enrollments : [];
  
  strapi.log.info(`👥 [Cron] Enrollments activos encontrados: ${enrollmentList.length}`);
  let createdCount = 0;
  let skippedCount = 0;

  for (const enr of enrollmentList) {
    const services = Array.isArray((enr as any).services) ? (enr as any).services : [];
    const amounts: Record<string, number> = {};
    for (const srv of services) {
      // Any active service contributes to the invoice
      if (srv?.serviceStatus === 'active') {
        const title = srv?.title ?? 'Servicio';
        const amount = num(srv?.amount, 0);
        if (amount > 0) amounts[title] = (amounts[title] ?? 0) + amount;
      }
    }

    const subtotal = Object.values(amounts).reduce((a, b) => a + b, 0);
    if (subtotal <= 0) continue; // Nothing to bill

    // Calcular IVA y total con IVA incluido
    const { iva, total } = calculateIVA(subtotal);

    // Check duplicate automatic invoice for this enrollment in current month
    // Only check for system-generated invoices, not manual ones
    const existing = await strapi.entityService.findMany('api::invoice.invoice', {
      filters: {
        invoiceCategory: 'invoice_enrollment',
        enrollment: (enr as any).id,
        emissionDate: { $gte: start, $lt: end },
        registeredBy: 'system', // Only check system-generated invoices
      },
      limit: 1,
    });
    if (existing && existing.length > 0) {
      skippedCount++;
      continue;
    }

    // Generar título y nota para la factura
    const monthName = now.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
    const currentDate = now.toLocaleDateString('es-ES');
    const studentName = (enr as any).student?.name || 'Estudiante';
    const invoiceTitle = `Factura mensual - ${monthName} - ${studentName} - ${currentDate}`;
    const invoiceNote = `Factura generada automáticamente por el sistema el ${currentDate} para los servicios del mes de ${monthName}.`;

    await strapi.entityService.create('api::invoice.invoice', {
      data: {
        invoiceCategory: 'invoice_enrollment',
        invoiceType: 'charge',
        invoiceStatus: 'unpaid',
        enrollment: (enr as any).id,
        emissionDate: now.toISOString(),
        expirationDate: new Date(now.getFullYear(), now.getMonth(), 30).toISOString(),
        amounts,
        total,
        IVA: iva,
        issuedby: 'Sistema',
        registeredBy: 'system',
        title: invoiceTitle,
        notes: invoiceNote,
      },
    });
    createdCount++;
  }

  strapi.log.info(`📊 [Cron] Facturas de alumnos - Creadas: ${createdCount}, Omitidas (duplicadas): ${skippedCount}`);
};

/**
 * Create monthly payroll invoices for active employees.
 * - Uses the latest contract term; if paymentPeriod is monthly, uses hourlyRate or workedHours.
 * - Avoids duplicates within the month.
 */
const generateEmployeePayrolls = async ({ strapi }: TaskContext) => {
  const now = new Date();
  const { start, end } = getMonthBounds(now);

  const employees = await strapi.entityService.findMany('api::employee.employee', {
    filters: { isActive: true },
    populate: { terms: true },
    limit: 10000,
  });
  const employeeList = Array.isArray(employees) ? employees : [];
  
  strapi.log.info(`👷 [Cron] Empleados activos encontrados: ${employeeList.length}`);
  let createdCount = 0;
  let skippedCount = 0;

  for (const emp of employeeList) {
    const terms = Array.isArray((emp as any).terms) ? (emp as any).terms : [];
    const latest = terms[terms.length - 1];
    if (!latest) continue;

    const period = latest?.paymentPeriod;
    let salary = 0;
    if (period === 'monthly') {
      const hourly = num(latest?.hourlyRate, 0);
      const hours = num(latest?.workedHours, 0);
      salary = hourly > 0 && hours > 0 ? hourly * hours : hourly; // fallback to fixed monthly rate if hours missing
    } else if (period === 'weekly' || period === 'biweekly' || period === 'daily') {
      // Basic estimate by hourlyRate * workedHours for the month
      const hourly = num(latest?.hourlyRate, 0);
      const hours = num(latest?.workedHours, 0);
      salary = hourly * hours;
    }

    if (!Number.isFinite(salary) || salary <= 0) continue; // Nothing to bill

    // Calcular IVA y total con IVA incluido
    const { iva, total } = calculateIVA(salary);

    // Check duplicate payroll for this employee in current month
    const existing = await strapi.entityService.findMany('api::invoice.invoice', {
      filters: {
        invoiceCategory: 'invoice_employ',
        employee: (emp as any).id,
        emissionDate: { $gte: start, $lt: end },
      },
      limit: 1,
    });
    if (existing && existing.length > 0) {
      skippedCount++;
      continue;
    }

    // Generar título y nota para la nómina
    const monthName = now.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
    const currentDate = now.toLocaleDateString('es-ES');
    const employeeName = (emp as any).name || 'Empleado';
    const payrollTitle = `Nómina - ${monthName} - ${employeeName} - ${currentDate}`;
    const payrollNote = `Nómina generada automáticamente por el sistema el ${currentDate} correspondiente al mes de ${monthName}.`;

    await strapi.entityService.create('api::invoice.invoice', {
      data: {
        invoiceCategory: 'invoice_employ',
        invoiceType: 'expense',
        invoiceStatus: 'unpaid',
        employee: (emp as any).id,
        emissionDate: now.toISOString(),
        expirationDate: new Date(now.getFullYear(), now.getMonth(), 30).toISOString(),
        amounts: { salario: salary },
        total,
        IVA: iva,
        issuedby: 'Sistema',
        registeredBy: 'system',
        title: payrollTitle,
        notes: payrollNote,
      },
    });
    createdCount++;
  }

  strapi.log.info(`📊 [Cron] Nóminas de empleados - Creadas: ${createdCount}, Omitidas (duplicadas): ${skippedCount}`);
};

export default {
  monthly_billing: {
    options: {
      rule: process.env.BILLING_CRON_RULE || DEFAULT_MONTHLY_RULE,
      tz: 'Europe/Madrid',
    },
    task: async (ctx: TaskContext) => {
      const timestamp = new Date().toLocaleString('es-ES', { 
        timeZone: 'Europe/Madrid',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
      
      // Obtener el día de facturación configurado
      const billingDay = await getBillingDay(ctx.strapi);
      
      ctx.strapi.log.info(`🕐 [Cron] INICIO - Ejecutando facturación mensual (${timestamp})`);
      ctx.strapi.log.info(`⚙️  [Cron] Configuración: cada 5 minutos (MODO PRUEBA) - Día de facturación: ${billingDay}`);
      
      try {
        ctx.strapi.log.info(`📋 [Cron] Generando facturas de enrollment...`);
        await generateEnrollmentInvoices(ctx);
        
        ctx.strapi.log.info(`💰 [Cron] Generando nóminas de empleados...`);
        await generateEmployeePayrolls(ctx);
        
        ctx.strapi.log.info(`✅ [Cron] COMPLETADO - Facturación mensual finalizada (${timestamp})`);
      } catch (error) {
        ctx.strapi.log.error(`❌ [Cron] ERROR - Falló la facturación mensual: ${error.message}`);
        throw error;
      }
    },
  },
};