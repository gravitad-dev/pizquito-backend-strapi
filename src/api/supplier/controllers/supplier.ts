/**
 * supplier controller
 */

import { factories } from '@strapi/strapi'

export default factories.createCoreController('api::supplier.supplier', ({ strapi }) => ({
  /**
   * Exporta movimientos de todos los items de un proveedor en XLSX
   * GET /suppliers/:documentId/items-movements/export
   */
  async exportItemsMovements(ctx) {
    const documentId = ctx.params?.documentId;
    if (!documentId) {
      ctx.throw(400, 'Supplier documentId is required');
      return;
    }
    const q: any = ctx.query || {};
    try {
      const itemService = (strapi as any).service('api::item.item');
      const { buffer, filename, contentType } = await itemService.buildMovementsWorkbook({
        mode: 'supplier',
        supplierDocumentId: String(documentId),
        query: q,
      });
      ctx.set('Content-Type', contentType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      ctx.set('Content-Disposition', `attachment; filename="${filename}"`);
      ctx.body = buffer;
    } catch (err) {
      (strapi as any).log.error('exportItemsMovements error', err);
      ctx.throw(500, 'Failed to generate XLSX');
    }
  },
}));
