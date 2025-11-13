import serviceFactory from "../services/invoices-sepa-batch";

function normalizeStatuses(input: any): string[] {
  const allowed = ["paid", "inprocess", "unpaid"];
  if (!input) return allowed; // por defecto: todas menos canceled
  if (Array.isArray(input)) {
    const list = input.filter((s) => allowed.includes(String(s)));
    return list.length ? list : allowed;
  }
  const s = String(input);
  return allowed.includes(s) ? [s] : allowed;
}

function validateBody(body: any) {
  const year = Number(body?.year);
  const month = Number(body?.month);
  const format =
    body?.format === "xlsx"
      ? "xlsx"
      : body?.format === "txt"
      ? "txt"
      : body?.format === "xml"
      ? "xml"
      : null;
  const statuses = normalizeStatuses(body?.statuses ?? body?.status);
  if (!year || year < 1970 || year > 2100) {
    throw new Error("Parámetro 'year' inválido");
  }
  if (!month || month < 1 || month > 12) {
    throw new Error("Parámetro 'month' inválido");
  }
  if (!format) {
    throw new Error("Parámetro 'format' debe ser 'txt', 'xlsx' o 'xml'");
  }
  return { year, month, format, statuses } as { year: number; month: number; format: "txt" | "xlsx" | "xml"; statuses: string[] };
}

export default {
  async generateEnrollments(ctx: any) {
    let params: { year: number; month: number; format: "txt" | "xlsx" | "xml" };
    try {
      params = validateBody(ctx.request.body);
    } catch (err: any) {
      ctx.status = 400;
      ctx.body = { error: err?.message || "Parámetros inválidos" };
      return;
    }
    try {
      const service = serviceFactory();
      const { zipBuffer, fileName } = await service.generateZip({ ...params, type: "enrollment" });
      ctx.set("Content-Type", "application/zip");
      ctx.set("Content-Disposition", `attachment; filename=${fileName}`);
      ctx.body = zipBuffer;
    } catch (err: any) {
      ctx.status = 500;
      ctx.body = { error: err?.message || "Error generando ZIP" };
    }
  },
  async generateEmployees(ctx: any) {
    let params: { year: number; month: number; format: "txt" | "xlsx" | "xml" };
    try {
      params = validateBody(ctx.request.body);
    } catch (err: any) {
      ctx.status = 400;
      ctx.body = { error: err?.message || "Parámetros inválidos" };
      return;
    }
    try {
      const service = serviceFactory();
      const { zipBuffer, fileName } = await service.generateZip({ ...params, type: "employee" });
      ctx.set("Content-Type", "application/zip");
      ctx.set("Content-Disposition", `attachment; filename=${fileName}`);
      ctx.body = zipBuffer;
    } catch (err: any) {
      ctx.status = 500;
      ctx.body = { error: err?.message || "Error generando ZIP" };
    }
  },
};