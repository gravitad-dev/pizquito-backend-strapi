import { factories } from "@strapi/strapi";
import simulator from "../services/invoice-simulator";

export default factories.createCoreController("api::invoice.invoice", ({ strapi }) => ({
  async generateYear(ctx) {
    const body = ctx.request.body || {};
    const result = await simulator.generateYear(strapi as any, body);
    ctx.body = result;
  },

  async cleanup(ctx) {
    const body = ctx.request.body || {};
    const result = await simulator.cleanup(strapi as any, body);
    ctx.body = result;
  },

  async status(ctx) {
    const q = ctx.query || {};
    const result = await simulator.status(strapi as any, {
      year: q.year ? Number(q.year) : undefined,
      tag: q.tag ? String(q.tag) : undefined,
      month: q.month ? Number(q.month) : undefined,
    });
    ctx.body = result;
  },
}));
