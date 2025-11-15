import type { Core } from "@strapi/strapi";
import { normalizeInvoiceAmounts, subtotalFromAmounts } from "../../../utils/cron/invoice-amounts";
import {
  calculateIVA,
  fetchAllBatched,
  formatMonthKey,
  getLastDayOfMonth,
  isDateWithinRange,
  isDateWithinSchoolPeriod,
  num,
  shouldBillForMonth,
  logCronExecution,
} from "../../../utils/cron/helpers";

type GenerateInput = {
  year: number;
  months?: number[];
  includeEnrollments?: boolean;
  includeEmployees?: boolean;
  deleteExisting?: boolean;
  tag?: string;
  statusDistribution?: { paid?: number; unpaid?: number; canceled?: number };
};

type CleanupInput = { year?: number; tag?: string };
type StatusInput = { year?: number; tag?: string; month?: number };

function pickStatus(dist: GenerateInput["statusDistribution"], fallback: "unpaid" | "paid" | "canceled" = "unpaid") {
  const paid = num(dist?.paid, 0);
  const unpaid = num(dist?.unpaid, 0);
  const canceled = num(dist?.canceled, 0);
  const total = paid + unpaid + canceled;
  if (total <= 0) return fallback;
  const r = Math.random() * total;
  if (r < paid) return "paid";
  if (r < paid + unpaid) return "unpaid";
  return "canceled";
}

function monthBounds(year: number, month: number) {
  const start = new Date(year, month - 1, 1);
  const next = new Date(year, month, 1);
  const end = new Date(year, month, 0);
  return { startISO: start.toISOString(), nextISO: next.toISOString(), lastDay: end };
}

async function deleteExistingSimulations(
  strapi: Core.Strapi,
  year: number,
  month: number,
  tag?: string,
) {
  const { startISO, nextISO } = monthBounds(year, month);
  const filters: any = {
    simulation: { $eq: true },
    emissionDate: { $gte: startISO, $lt: nextISO },
  };
  if (tag) filters.simulationTag = { $eq: tag };
  const existing = await (strapi as any).entityService.findMany("api::invoice.invoice", {
    filters,
    fields: ["id"],
    limit: 1000,
  });
  let deleted = 0;
  for (const inv of existing || []) {
    try {
      await (strapi as any).entityService.delete("api::invoice.invoice", inv.id);
      deleted++;
    } catch {}
  }
  return deleted;
}

async function existsRealInvoiceForEnrollment(
  strapi: Core.Strapi,
  enrollmentId: number,
  year: number,
  month: number,
) {
  const { startISO, nextISO } = monthBounds(year, month);
  const found = await (strapi as any).entityService.findMany("api::invoice.invoice", {
    filters: {
      simulation: { $ne: true },
      invoiceCategory: { $eq: "invoice_enrollment" },
      enrollment: { id: { $eq: enrollmentId } },
      emissionDate: { $gte: startISO, $lt: nextISO },
    },
    fields: ["id"],
    limit: 1,
  });
  return Array.isArray(found) && found.length > 0;
}

async function existsRealInvoiceForEmployee(
  strapi: Core.Strapi,
  employeeId: number,
  year: number,
  month: number,
) {
  const { startISO, nextISO } = monthBounds(year, month);
  const found = await (strapi as any).entityService.findMany("api::invoice.invoice", {
    filters: {
      simulation: { $ne: true },
      invoiceCategory: { $eq: "invoice_employ" },
      employee: { id: { $eq: employeeId } },
      emissionDate: { $gte: startISO, $lt: nextISO },
    },
    fields: ["id"],
    limit: 1,
  });
  return Array.isArray(found) && found.length > 0;
}

async function generateForMonth(
  strapi: Core.Strapi,
  year: number,
  month: number,
  opts: GenerateInput,
) {
  const periodKey = `${String(year)}-${String(month).padStart(2, "0")}`;
  const { startISO, lastDay } = monthBounds(year, month);

  let createdCount = 0;

  if (opts.includeEnrollments !== false) {
    const enrollmentList = await fetchAllBatched(
      strapi,
      "api::enrollment.enrollment",
      {
        services: true,
        student: true,
        guardians: true,
        school_period: { populate: { period: true } },
        billingControl: true,
      },
      500,
      { isActive: true },
    );

    for (const enr of enrollmentList) {
      const dateForMonth = new Date(year, month - 1, 1);
      if (!(enr as any).school_period) continue;
      if (!isDateWithinSchoolPeriod((enr as any).school_period, dateForMonth)) continue;
      const monthKey = formatMonthKey(dateForMonth);
      if (!shouldBillForMonth((enr as any).billingControl, monthKey)) continue;
      const already = await existsRealInvoiceForEnrollment(strapi, (enr as any).id, year, month);
      if (already) continue;

      const services = Array.isArray((enr as any).services) ? (enr as any).services : [];
      const rawMap: Record<string, number> = {};
      for (const srv of services) {
        if (srv?.serviceStatus === "active") {
          const amount = num(srv?.amount, 0);
          if (amount > 0) {
            rawMap[srv?.title || "servicio"] = (rawMap[srv?.title || "servicio"] ?? 0) + amount;
          }
        }
      }
      const additionalAmount = (enr as any).additionalAmount;
      if (additionalAmount && typeof additionalAmount === "object") {
        for (const [key, value] of Object.entries(additionalAmount)) {
          const amount = num(value, 0);
          if (amount > 0) rawMap[key] = (rawMap[key] ?? 0) + amount;
        }
      }

      const amountsList = normalizeInvoiceAmounts(rawMap);
      const subtotal = subtotalFromAmounts(amountsList);
      if (!Number.isFinite(subtotal) || subtotal <= 0) continue;
      const { iva, total } = calculateIVA(subtotal);

      const title = `Recibo mensual ${periodKey}`;
      const data: any = {
        invoiceCategory: "invoice_enrollment",
        invoiceType: "charge",
        invoiceStatus: pickStatus(opts.statusDistribution, "unpaid"),
        enrollment: (enr as any).documentId,
        emissionDate: startISO,
        expirationDate: getLastDayOfMonth(new Date(year, month - 1, 1)).toISOString(),
        amounts: amountsList as any,
        total,
        IVA: iva,
        issuedby: "Simulación",
        registeredBy: "system",
        title,
        notes: `Factura simulada para ${periodKey}`,
        simulation: true,
        simulationTag: opts.tag || null,
      };

      try {
        await (strapi as any)
          .documents("api::invoice.invoice")
          .create({ data, status: "published" });
        createdCount++;
      } catch {}
    }
  }

  if (opts.includeEmployees) {
    const employeeList = await fetchAllBatched(
      strapi,
      "api::employee.employee",
      { terms: true, billingControl: true },
      500,
      { isActive: true },
    );

    for (const emp of employeeList) {
      const latest = Array.isArray((emp as any).terms) ? (emp as any).terms[(emp as any).terms.length - 1] : undefined;
      if (!latest) continue;
      const dateForMonth = new Date(year, month - 1, 1);
      if (!isDateWithinRange(latest?.start, latest?.end, dateForMonth)) continue;
      const monthKey = formatMonthKey(dateForMonth);
      if (!shouldBillForMonth((emp as any).billingControl, monthKey)) continue;
      const already = await existsRealInvoiceForEmployee(strapi, (emp as any).id, year, month);
      if (already) continue;

      const paymentPeriod = latest?.paymentPeriod || "monthly";
      const baseSalary = (function () {
        const hourlyRate = num(latest?.hourlyRate, 0);
        const workedHours = num(latest?.workedHours, 160);
        return hourlyRate * workedHours;
      })();

      let additionalTotal = 0;
      const additionalAmount = (emp as any).additionalAmount;
      if (additionalAmount && typeof additionalAmount === "object") {
        for (const value of Object.values(additionalAmount)) {
          additionalTotal += num(value, 0);
        }
      }
      const salary = baseSalary + additionalTotal;
      if (!Number.isFinite(salary) || salary <= 0) continue;
      const { iva, total } = calculateIVA(salary);

      const rawMap: Record<string, number> = { "Salario base": baseSalary };
      if (additionalAmount && typeof additionalAmount === "object") {
        for (const [key, value] of Object.entries(additionalAmount)) {
          const amount = num(value, 0);
          if (amount > 0) rawMap[key] = amount;
        }
      }
      const payrollAmounts = normalizeInvoiceAmounts(rawMap);

      const title = `Nómina ${paymentPeriod} ${periodKey}`;
      const data: any = {
        invoiceCategory: "invoice_employ",
        invoiceType: "expense",
        invoiceStatus: pickStatus(opts.statusDistribution, "unpaid"),
        employee: (emp as any).documentId,
        emissionDate: startISO,
        expirationDate: lastDay.toISOString(),
        amounts: payrollAmounts as any,
        total,
        IVA: iva,
        issuedby: "Simulación",
        registeredBy: "system",
        title,
        notes: `Nómina simulada para ${periodKey}`,
        simulation: true,
        simulationTag: opts.tag || null,
      };

      try {
        await (strapi as any)
          .documents("api::invoice.invoice")
          .create({ data, status: "published" });
        createdCount++;
      } catch {}
    }
  }

  return { period: periodKey, count: createdCount };
}

async function generateYear(strapi: Core.Strapi, input: GenerateInput) {
  const year = num(input.year, 0);
  if (!year || year < 1970) return { created: [] };
  const months = Array.isArray(input.months) && input.months.length > 0 ? input.months : [1,2,3,4,5,6,7,8,9,10,11,12];

  const createdPerMonth: Array<{ period: string; count: number }> = [];

  await logCronExecution(strapi, {
    title: "Simulación anual de facturas",
    message: `Inicio year=${year}`,
    event_type: "invoices_test_generate_year",
    payload: input as any,
  });

  for (const m of months) {
    if (input.deleteExisting) {
      await deleteExistingSimulations(strapi, year, m, input.tag);
    }
    const res = await generateForMonth(strapi, year, m, input);
    createdPerMonth.push(res);
  }

  const total = createdPerMonth.reduce((acc, r) => acc + (r?.count || 0), 0);
  await logCronExecution(strapi, {
    title: "Simulación anual de facturas",
    message: `Fin year=${year} total=${total}`,
    event_type: "invoices_test_generate_year",
    level: total > 0 ? "INFO" : "DEBUG",
    payload: { createdPerMonth },
  });
  return { created: createdPerMonth };
}

async function cleanup(strapi: Core.Strapi, input: CleanupInput) {
  const filters: any = { simulation: { $eq: true } };
  if (input.tag) filters.simulationTag = { $eq: input.tag };
  let dateFilter: any = undefined;
  if (input.year) {
    const start = new Date(input.year, 0, 1).toISOString();
    const next = new Date(input.year + 1, 0, 1).toISOString();
    dateFilter = { $gte: start, $lt: next };
  }
  if (dateFilter) filters.emissionDate = dateFilter;

  const list = await (strapi as any).entityService.findMany("api::invoice.invoice", {
    filters,
    fields: ["id"],
    limit: 5000,
  });
  let deleted = 0;
  for (const inv of list || []) {
    try {
      await (strapi as any).entityService.delete("api::invoice.invoice", inv.id);
      deleted++;
    } catch {}
  }
  await logCronExecution(strapi, {
    title: "Cleanup simulación de facturas",
    message: `Eliminadas ${deleted}`,
    event_type: "invoices_test_cleanup",
    level: deleted > 0 ? "INFO" : "DEBUG",
    payload: input as any,
  });
  return { deleted };
}

async function status(strapi: Core.Strapi, input: StatusInput) {
  const filters: any = { simulation: { $eq: true } };
  if (input.tag) filters.simulationTag = { $eq: input.tag };
  if (input.year && input.month) {
    const { startISO, nextISO } = monthBounds(input.year, input.month);
    filters.emissionDate = { $gte: startISO, $lt: nextISO };
  } else if (input.year) {
    const start = new Date(input.year, 0, 1).toISOString();
    const next = new Date(input.year + 1, 0, 1).toISOString();
    filters.emissionDate = { $gte: start, $lt: next };
  }
  const exists = await (strapi as any).entityService.findMany("api::invoice.invoice", {
    filters,
    fields: ["id"],
    limit: 1,
  });
  const list = await (strapi as any).entityService.findMany("api::invoice.invoice", {
    filters,
    fields: ["id"],
    limit: 5000,
  });
  return { exists: Array.isArray(exists) && exists.length > 0, count: Array.isArray(list) ? list.length : 0 };
}

export default { generateYear, cleanup, status };
