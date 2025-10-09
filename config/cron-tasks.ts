import type { Core } from '@strapi/types';

// Cron rule can be configured via .env using BILLING_CRON_RULE.
// The day of month is configurable via CRON_BILLING_DAY (default 25).
const BILLING_DAY = String(process.env.CRON_BILLING_DAY || 25);
// Ejecutar a las 00:00 (medianoche) del día configurado, en horario de Madrid.
const DEFAULT_MONTHLY_RULE = `0 0 0 ${BILLING_DAY} * *`;

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
 * Create monthly invoices for active enrollments that are unpaid.
 * - Aggregates active student services amounts per enrollment.
 * - Avoids duplicates within the month.
 */
const generateEnrollmentInvoices = async ({ strapi }: TaskContext) => {
  const now = new Date();
  const { start, end } = getMonthBounds(now);

  const enrollments = await strapi.entityService.findMany('api::enrollment.enrollment', {
    filters: { isActive: true },
    populate: { services: true, student: true },
    limit: 10000,
  });
  const enrollmentList = Array.isArray(enrollments) ? enrollments : [];
  let createdCount = 0;

  for (const enr of enrollmentList) {
    const services = Array.isArray((enr as any).services) ? (enr as any).services : [];
    const amounts: Record<string, number> = {};
    for (const srv of services) {
      // Only student services that are active contribute
      if (srv?.serviceStatus === 'active' && srv?.serviceType === 'student_service') {
        const title = srv?.title ?? 'Servicio';
        const amount = num(srv?.amount, 0);
        if (amount > 0) amounts[title] = (amounts[title] ?? 0) + amount;
      }
    }

    const total = Object.values(amounts).reduce((a, b) => a + b, 0);
    if (total <= 0) continue; // Nothing to bill

    // Check duplicate invoice for this enrollment in current month
    const existing = await strapi.entityService.findMany('api::invoice.invoice', {
      filters: {
        invoiceCategory: 'invoice_enrollment',
        enrollment: (enr as any).id,
        emissionDate: { $gte: start, $lt: end },
      },
      limit: 1,
    });
    if (existing && existing.length > 0) continue;

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
        IVA: 0,
        issuedby: 'Sistema',
        registeredBy: 'system',
      },
    });
    createdCount++;
  }

  strapi.log.info(`[Cron] Facturas de alumnos creadas: ${createdCount}`);
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
  let createdCount = 0;

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

    // Check duplicate payroll for this employee in current month
    const existing = await strapi.entityService.findMany('api::invoice.invoice', {
      filters: {
        invoiceCategory: 'invoice_employ',
        employee: (emp as any).id,
        emissionDate: { $gte: start, $lt: end },
      },
      limit: 1,
    });
    if (existing && existing.length > 0) continue;

    await strapi.entityService.create('api::invoice.invoice', {
      data: {
        invoiceCategory: 'invoice_employ',
        invoiceType: 'expense',
        invoiceStatus: 'unpaid',
        employee: (emp as any).id,
        emissionDate: now.toISOString(),
        expirationDate: new Date(now.getFullYear(), now.getMonth(), 30).toISOString(),
        amounts: { salario: salary },
        total: salary,
        IVA: 0,
        issuedby: 'Sistema',
        registeredBy: 'system',
      },
    });
    createdCount++;
  }

  strapi.log.info(`[Cron] Nóminas de empleados creadas: ${createdCount}`);
};

export default {
  monthly_billing: {
    options: {
      rule: process.env.BILLING_CRON_RULE || DEFAULT_MONTHLY_RULE,
      tz: 'Europe/Madrid',
    },
    task: async (ctx: TaskContext) => {
      ctx.strapi.log.info('[Cron] Ejecutando facturación mensual (alumnos y nóminas)');
      await generateEnrollmentInvoices(ctx);
      await generateEmployeePayrolls(ctx);
    },
  },
};