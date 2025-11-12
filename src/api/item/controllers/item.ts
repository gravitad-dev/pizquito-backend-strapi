/**
 * item controller
 */

import { factories } from '@strapi/strapi'

export default factories.createCoreController('api::item.item', ({ strapi }) => ({
  /**
   * Exporta movimientos de un ítem específico en formato XLSX
   * GET /items/:id/movements/export
   */
  async exportMovements(ctx) {
    const documentId = ctx.params?.documentId;
    if (!documentId) {
      ctx.throw(400, 'Item documentId is required');
      return;
    }
    const q: any = ctx.query || {};
    try {
      const service = (strapi as any).service('api::item.item');
      const { buffer, filename, contentType } = await service.buildMovementsWorkbook({
        mode: 'singleItem',
        itemDocumentId: String(documentId),
        query: q,
      });
      ctx.set('Content-Type', contentType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      ctx.set('Content-Disposition', `attachment; filename="${filename}"`);
      ctx.body = buffer;
    } catch (err) {
      (strapi as any).log.error('exportMovements error', err);
      ctx.throw(500, 'Failed to generate XLSX');
    }
  },

  /**
   * Export general de movimientos (multi-item) con opciones de agrupación
   * GET /items/movements/export
   */
  async exportMovementsGeneral(ctx) {
    const q: any = ctx.query || {};
    try {
      const service = (strapi as any).service('api::item.item');
      const { buffer, filename, contentType } = await service.buildMovementsWorkbook({
        mode: 'general',
        query: q,
      });
      ctx.set('Content-Type', contentType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      ctx.set('Content-Disposition', `attachment; filename="${filename}"`);
      ctx.body = buffer;
    } catch (err) {
      (strapi as any).log.error('exportMovementsGeneral error', err);
      ctx.throw(500, 'Failed to generate XLSX');
    }
  },
}));
