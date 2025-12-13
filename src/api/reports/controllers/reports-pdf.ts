/**
 * Controller for Reports module: PDF generation (Invoices and Payrolls)
 */

import { Context } from 'koa';
import services from '../services/index';

export default {
  async invoice(ctx: Context) {
    const { id } = ctx.params as { id: string };
    const { store } = ctx.query as Record<string, string>;
    if (store === 'true') {
      const result = await services['reports-pdf'].invoice(id);
      ctx.body = result;
    } else {
      const { buffer, fileName } = await services['reports-pdf'].invoiceBuffer(id);
      if (!buffer) {
        ctx.status = 404;
        ctx.body = { error: `Invoice ${id} not found` };
        return;
      }
      ctx.type = 'application/pdf';
      ctx.set('Content-Disposition', `inline; filename="${fileName || 'invoice'}.pdf"`);
      ctx.body = buffer;
    }
  },

  async payroll(ctx: Context) {
    const { id } = ctx.params as { id: string };
    const { store } = ctx.query as Record<string, string>;
    if (store === 'true') {
      const result = await services['reports-pdf'].payroll(id);
      ctx.body = result;
    } else {
      const { buffer, fileName } = await services['reports-pdf'].payrollBuffer(id);
      if (!buffer) {
        ctx.status = 404;
        ctx.body = { error: `Payroll invoice ${id} not found` };
        return;
      }
      ctx.type = 'application/pdf';
      ctx.set('Content-Disposition', `inline; filename="${fileName || 'payroll'}.pdf"`);
      ctx.body = buffer;
    }
  },

  async service(ctx: Context) {
    const { id } = ctx.params as { id: string };
    const { store } = ctx.query as Record<string, string>;
    if (store === 'true') {
      const result = await services['reports-pdf'].service(id);
      ctx.body = result;
    } else {
      const { buffer, fileName } = await services['reports-pdf'].serviceBuffer(id);
      if (!buffer) {
        ctx.status = 404;
        ctx.body = { error: `Service invoice ${id} not found` };
        return;
      }
      ctx.type = 'application/pdf';
      ctx.set('Content-Disposition', `inline; filename="${fileName || 'service'}.pdf"`);
      ctx.body = buffer;
    }
  },

  async general(ctx: Context) {
    const { id } = ctx.params as { id: string };
    const { store } = ctx.query as Record<string, string>;
    if (store === 'true') {
      const result = await services['reports-pdf'].general(id);
      ctx.body = result;
    } else {
      const { buffer, fileName } = await services['reports-pdf'].generalBuffer(id);
      if (!buffer) {
        ctx.status = 404;
        ctx.body = { error: `General invoice ${id} not found` };
        return;
      }
      ctx.type = 'application/pdf';
      ctx.set('Content-Disposition', `inline; filename="${fileName || 'general'}.pdf"`);
      ctx.body = buffer;
    }
  },
};