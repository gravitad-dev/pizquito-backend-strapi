/**
 * Controller for Modelo 233 preview & generation
 */

import { Context } from 'koa';
import services from '../services';

export default {
  async preview(ctx: Context) {
    const { year, quarter, concept, centerCode, studentId, includeMonths, page = '1', pageSize = '25' } = ctx.query as Record<string, string>;

    const params = {
      year: year ? parseInt(year, 10) : undefined,
      quarter: quarter as 'Q1' | 'Q2' | 'Q3' | 'Q4' | undefined,
      concept: (concept as 'matricula' | 'comedor' | 'all' | undefined) ?? 'all',
      centerCode,
      studentId: studentId ? Number(studentId) : undefined,
      includeMonths: includeMonths === 'true',
      page: Number(page),
      pageSize: Number(pageSize),
    };

    const result = await services['report-233'].preview(params);
    ctx.body = result;
  },

  async generate(ctx: Context) {
    const { year, quarter, concept = 'all', format = 'csv', centerCode } = ctx.request.body as Record<string, string>;

    const params = {
      year: year ? parseInt(year, 10) : undefined,
      quarter: quarter as 'Q1' | 'Q2' | 'Q3' | 'Q4' | undefined,
      concept: (concept as 'matricula' | 'comedor' | 'all' | undefined) ?? 'all',
      format: (format as 'csv' | 'xlsx' | 'pdf'),
      centerCode,
    };

    const result = await services['report-233'].generate(params);
    ctx.body = result;
  },
};