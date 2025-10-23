/**
 * Controller for Reports module: Modelo 233
 */

import { Context } from 'koa';
import services from '../services/index';

export default {
  async preview(ctx: Context) {
    const { year, quarter, concept, centerCode, studentId, studentName, includeMonths, page = '1', pageSize = '25' } = ctx.query as Record<string, string>;

    // Si no viene year, usar el año actual para evitar 500s
    const yearParsed = year ? parseInt(year, 10) : new Date().getFullYear();

    const params = {
      year: yearParsed,
      quarter: quarter as 'Q1' | 'Q2' | 'Q3' | 'Q4' | undefined,
      concept: (concept as 'matricula' | 'comedor' | 'all' | undefined) ?? 'all',
      centerCode,
      studentId: studentId ? Number(studentId) : undefined,
      studentName: studentName || undefined,
      includeMonths: includeMonths === 'true',
      page: Number(page),
      pageSize: Number(pageSize),
    };

    const result = await services['reports-233'].preview(params);
    ctx.body = result;
  },

  async generate(ctx: Context) {
    const { year, quarter, concept = 'all', format = 'csv', centerCode } = ctx.request.body as Record<string, string>;

    // Si no viene year, usar el año actual para evitar 500s
    const yearParsed = year ? parseInt(year, 10) : new Date().getFullYear();

    const params = {
      year: yearParsed,
      quarter: quarter as 'Q1' | 'Q2' | 'Q3' | 'Q4' | undefined,
      concept: (concept as 'matricula' | 'comedor' | 'all' | undefined) ?? 'all',
      format: (format as 'csv' | 'xlsx' | 'pdf'),
      centerCode,
    };

    const result = await services['reports-233'].generate(params);
    ctx.body = result;
  },
};