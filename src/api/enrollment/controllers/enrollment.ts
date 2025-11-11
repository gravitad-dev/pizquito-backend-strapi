/**
 * enrollment controller (custom)
 */
import { factories } from "@strapi/strapi";
import { Context } from "koa";

export default factories.createCoreController(
  "api::enrollment.enrollment",
  ({ strapi }) => ({
    /**
     * GET /api/enrollments/:documentId/billing-months
     * Devuelve los meses permitidos según los periodos del school_period
     * junto con el estado actual del billingControl.
     */
    async billingMonths(ctx: Context) {
      try {
        const { documentId } = ctx.params as { documentId: string };

        // Buscar por documentId y popular relaciones necesarias
        const { getEntryByDocumentId } = await import("../../../utils/document-id");
        const enrollment: any = await getEntryByDocumentId(
          strapi,
          "api::enrollment.enrollment",
          documentId,
          {
            populate: {
              school_period: { populate: { period: true } },
              billingControl: true,
            },
          } as any,
        );

        if (!enrollment) return ctx.notFound("Inscripción no encontrada");

        const periods = Array.isArray(enrollment?.school_period?.period)
          ? enrollment.school_period.period
          : [];

        const set = new Set<string>();
        for (const seg of periods) {
          if (!seg?.start || !seg?.end) continue;
          const start = new Date(seg.start);
          const end = new Date(seg.end);
          const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
          const endMonth = new Date(end.getFullYear(), end.getMonth(), 1);
          while (cursor <= endMonth) {
            const y = cursor.getFullYear();
            const m = String(cursor.getMonth() + 1).padStart(2, "0");
            set.add(`${y}-${m}`);
            cursor.setMonth(cursor.getMonth() + 1);
          }
        }

        const months = Array.from(set).sort();

        ctx.body = {
          allowedMonths: months,
          billingControl: enrollment?.billingControl || {},
        };
      } catch (error) {
        strapi.log.error("❌ Error obteniendo meses de la inscripción:", error);
        return ctx.internalServerError(
          "Error obteniendo meses válidos del periodo escolar",
        );
      }
    },
  }),
);
