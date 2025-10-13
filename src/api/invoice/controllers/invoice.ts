/**
 * invoice controller
 */

import { factories } from '@strapi/strapi'

export default factories.createCoreController('api::invoice.invoice', ({ strapi }) => ({
  async findEnrollments(ctx) {
    const q: any = ctx.query || {};
    const mergedFilters = {
      ...(q.filters || {}),
      invoiceCategory: { $eq: 'invoice_enrollment' },
    };
    const mergedPopulate = {
      ...(q.populate || {}),
      enrollment: { populate: { student: true } },
    };
    const result = await (strapi as any).entityService.findMany('api::invoice.invoice', {
      ...q,
      filters: mergedFilters,
      populate: mergedPopulate,
    });
    ctx.body = result;
  },

  async findPayrolls(ctx) {
    const q: any = ctx.query || {};
    const mergedFilters = {
      ...(q.filters || {}),
      invoiceCategory: { $eq: 'invoice_employ' },
    };
    const mergedPopulate = {
      ...(q.populate || {}),
      employee: true,
    };
    const result = await (strapi as any).entityService.findMany('api::invoice.invoice', {
      ...q,
      filters: mergedFilters,
      populate: mergedPopulate,
    });
    ctx.body = result;
  },
}));
