/**
 * item service
 */

import { factories } from '@strapi/strapi';
import ExcelJS from 'exceljs';
import { getEntryByDocumentId } from '../../../utils/document-id';

type BuildWorkbookMode = 'singleItem' | 'general' | 'supplier';

interface BuildWorkbookOptions {
  mode: BuildWorkbookMode;
  itemDocumentId?: string;
  supplierDocumentId?: string;
  query?: any;
}

const SHEET_LIMIT = Number(process.env.EXPORT_SHEET_LIMIT || 30);

function parsePeriod(query: any) {
  const { period, year, month, startDate, endDate } = query || {};
  let start: Date | null = null;
  let end: Date | null = null;
  if (period && /^\d{4}-\d{2}$/.test(period)) {
    const [y, m] = period.split('-').map((v: string) => parseInt(v, 10));
    start = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0));
    end = new Date(Date.UTC(y, m, 0, 23, 59, 59)); // fin de mes
  } else if (year && month) {
    const y = parseInt(year, 10);
    const m = parseInt(month, 10);
    if (!isNaN(y) && !isNaN(m)) {
      start = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0));
      end = new Date(Date.UTC(y, m, 0, 23, 59, 59));
    }
  } else if (startDate || endDate) {
    if (startDate) start = new Date(startDate);
    if (endDate) end = new Date(endDate);
  }
  return { start, end };
}

function formatPeriodLabel(q: any) {
  const { period, year, month, startDate, endDate } = q || {};
  if (period) return String(period);
  if (year && month) return `${year}-${String(month).padStart(2, '0')}`;
  if (startDate || endDate) return `${startDate || 'ANY'}_${endDate || 'ANY'}`;
  return 'ALL';
}

function applyMovementFilters(filters: any, q: any, itemId?: number) {
  const out: any = { ...(filters || {}) };
  const { start, end } = parsePeriod(q);
  if (itemId) {
    out.item = { id: { $eq: itemId } };
  }
  if (start) {
    out.date = { ...(out.date || {}), $gte: start.toISOString() };
  }
  if (end) {
    out.date = { ...(out.date || {}), $lte: end.toISOString() };
  }
  if (q?.movementType) {
    const types = String(q.movementType)
      .split(',')
      .map((t: string) => t.trim())
      .filter(Boolean);
    if (types.length) {
      out.movementType = { $in: types };
    }
  }
  return out;
}

function movementTypeLabel(type: string) {
  switch (String(type).toLowerCase()) {
    case 'inbound':
      return 'Entrada';
    case 'outbound':
      return 'Salida';
    case 'adjustment':
      return 'Ajuste';
    default:
      return type;
  }
}

function formatDate(value: string | Date, locale = 'es-ES', timezone = 'Europe/Madrid') {
  const d = value instanceof Date ? value : new Date(value);
  try {
    return d.toLocaleString(locale, {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    // Fallback simple
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const min = String(d.getUTCMinutes()).padStart(2, '0');
    return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
  }
}

function movementRow(m: any, includeInvoices: boolean, locale?: string, timezone?: string) {
  const invoiceInfo = includeInvoices && Array.isArray(m.invoices) && m.invoices.length
    ? `${m.invoices.map((i: any) => i.uid || i.id).join(', ')}`
    : '';
  const qty = Number(m.quantity || 0);
  const price = Number(m.price || 0);
  const amount = qty * price;
  return [
    formatDate(m.date, locale, timezone),
    movementTypeLabel(m.movementType),
    qty,
    m.unit,
    price,
    amount,
    m.notes || '',
    invoiceInfo,
  ];
}

function addSummarySheet(workbook: ExcelJS.Workbook, title: string, summary: any, meta: any) {
  const ws = workbook.addWorksheet(title);
  ws.addRow(['Resumen']);
  ws.addRow(['Periodo', meta.period]);
  if (meta.item) {
    ws.addRow(['Item', meta.item.name]);
    ws.addRow(['Unidad', meta.item.unit || '']);
    ws.addRow(['Proveedor', meta.item.supplier?.name || '']);
    ws.addRow(['Stock', meta.item.stock ?? '']);
    ws.addRow(['Stock mínimo', meta.item.min_stock ?? '']);
  }
  ws.addRow([]);
  ws.addRow(['Totales']);
  ws.addRow(['Entradas', summary.inbound]);
  ws.addRow(['Salidas', summary.outbound]);
  ws.addRow(['Ajustes', summary.adjustment]);
  ws.addRow(['Neto', summary.net]);
  return ws;
}

function computeTotals(movements: any[]) {
  const totals = { inbound: 0, outbound: 0, adjustment: 0, net: 0 };
  for (const m of movements) {
    const qty = Number(m.quantity || 0);
    switch (m.movementType) {
      case 'inbound':
        totals.inbound += qty;
        break;
      case 'outbound':
        totals.outbound += qty;
        break;
      case 'adjustment':
        totals.adjustment += qty;
        break;
    }
  }
  totals.net = totals.inbound - totals.outbound + totals.adjustment;
  return totals;
}

export default factories.createCoreService('api::item.item', ({ strapi }) => ({
  /**
   * Construye workbook XLSX según el modo solicitado.
   */
  async buildMovementsWorkbook(opts: BuildWorkbookOptions) {
    const { mode, itemDocumentId, supplierDocumentId, query } = opts;
    const includeInvoices = String(query?.includeInvoices || 'false') === 'true';
    const includeSummary = String(query?.includeSummary || 'true') === 'true';
    const sheetBy = String(query?.sheetBy || (mode === 'singleItem' ? 'none' : 'item'));
    const periodLabel = formatPeriodLabel(query);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Strapi Pizquito';
    workbook.created = new Date();
    const locale = String(query?.locale || 'es-ES');
    const timezone = String(query?.timezone || 'Europe/Madrid');

    let filename = `movements_${periodLabel}.xlsx`;

    if (mode === 'singleItem') {
      // Buscar item por documentId
      const item = await getEntryByDocumentId(strapi, 'api::item.item', String(itemDocumentId), {
        populate: { supplier: true },
      });
      if (!item) throw new Error('Item not found');
      filename = `item-${item.documentId || item.id}_movements_${periodLabel}.xlsx`;

      // Movimientos del item
      const filters = applyMovementFilters({}, query, item.id);
      const movements = await (strapi as any).entityService.findMany('api::movement.movement', {
        filters,
        populate: includeInvoices ? { invoices: true } : undefined,
        sort: { date: 'ASC' },
        limit: 10000, // ajustar si fuera necesario; en grandes volúmenes usar paginación
      });

      if (includeSummary) {
        const totals = computeTotals(movements);
        addSummarySheet(workbook, 'Resumen', totals, { period: periodLabel, item });
      }

      // Hoja de movimientos (o por mes si sheetBy=month)
      if (sheetBy === 'month') {
        const byMonth: Record<string, any[]> = {};
        for (const m of movements) {
          const d = new Date(m.date);
          const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
          byMonth[key] = byMonth[key] || [];
          byMonth[key].push(m);
        }
        const keys = Object.keys(byMonth).sort();
        for (const key of keys) {
          const ws = workbook.addWorksheet(`Movimientos ${key}`);
          ws.addRow(['Fecha', 'Tipo', 'Cantidad', 'Unidad', 'Precio', 'Importe', 'Notas', 'Facturas']);
          for (const m of byMonth[key]) ws.addRow(movementRow(m, includeInvoices, locale, timezone));
        }
      } else {
        const ws = workbook.addWorksheet('Movimientos');
        ws.addRow(['Fecha', 'Tipo', 'Cantidad', 'Unidad', 'Precio', 'Importe', 'Notas', 'Facturas']);
        for (const m of movements) ws.addRow(movementRow(m, includeInvoices, locale, timezone));
      }
    }

    if (mode === 'general') {
      filename = `items-movements_${periodLabel}_by-${sheetBy}.xlsx`;
      // Crear hoja Resumen general primero (si aplica)
      let wsSummaryGeneral: ExcelJS.Worksheet | null = null;
      if (includeSummary) {
        wsSummaryGeneral = workbook.addWorksheet('Resumen general');
        wsSummaryGeneral.addRow(['Item', 'Entradas', 'Salidas', 'Ajustes', 'Neto']);
      }
      // Traer todos los items (se puede filtrar por proveedor con supplierDocumentId si se envía)
      // Si se filtra por proveedor vía documentId, obtener TODAS las localizaciones del proveedor
      let supplierIds: number[] | undefined;
      let supplierDocId: string | undefined;
      if (supplierDocumentId) {
        supplierDocId = String(supplierDocumentId);
        try {
          const supplierLocs = await (strapi.db as any)
            .query('api::supplier.supplier')
            .findMany({ where: { documentId: supplierDocId }, select: ['id', 'documentId'] });
          supplierIds = Array.isArray(supplierLocs) ? supplierLocs.map((s: any) => s.id) : [];
        } catch (e) {
          supplierIds = undefined;
        }
      }
      const itemFilters: any = {};
      if (supplierIds && supplierIds.length) {
        itemFilters.supplier = { id: { $in: supplierIds } };
      } else if (supplierDocId) {
        // Fallback: intentar por documentId del proveedor en la relación (si Strapi lo permite)
        itemFilters.supplier = { documentId: { $eq: supplierDocId } };
      }
      const items = await (strapi as any).entityService.findMany('api::item.item', {
        filters: itemFilters,
        populate: { supplier: true },
        sort: { name: 'ASC' },
        limit: 1000,
      });

      const sheetCountDesired = sheetBy === 'item' ? items.length : sheetBy === 'supplier' ? new Set(items.map((i: any) => i.supplier?.name || 'N/A')).size : 1;
      const exceedLimit = sheetCountDesired > SHEET_LIMIT;
      const effectiveSheetBy = exceedLimit ? 'none' : sheetBy;

      if (effectiveSheetBy === 'supplier') {
        const bySupplier: Record<string, { supplier: any, rows: any[] }> = {};
        for (const item of items) {
          const filters = applyMovementFilters({}, query, item.id);
          const movements = await (strapi as any).entityService.findMany('api::movement.movement', {
            filters,
            populate: includeInvoices ? { invoices: true } : undefined,
            sort: { date: 'ASC' },
            limit: 10000,
          });
          const key = item.supplier?.name || 'Sin proveedor';
          bySupplier[key] = bySupplier[key] || { supplier: item.supplier, rows: [] };
          for (const m of movements) {
            const row = movementRow(m, includeInvoices, locale, timezone);
            // Insertar nombre del item como primera columna si vamos a hoja de proveedor
            bySupplier[key].rows.push([item.name, ...row]);
          }
          if (wsSummaryGeneral) {
            const totals = computeTotals(movements);
            wsSummaryGeneral.addRow([item.name, totals.inbound, totals.outbound, totals.adjustment, totals.net]);
          }
        }
        for (const key of Object.keys(bySupplier)) {
          const ws = workbook.addWorksheet(`Proveedor - ${key}`.slice(0, 31));
          ws.addRow(['Item', 'Fecha', 'Tipo', 'Cantidad', 'Unidad', 'Precio', 'Importe', 'Notas', 'Facturas']);
          for (const row of bySupplier[key].rows) ws.addRow(row);
        }
      } else if (effectiveSheetBy === 'item') {
        for (const item of items) {
          const ws = workbook.addWorksheet(item.name?.slice(0, 31) || `Item ${item.id}`);
          ws.addRow(['Fecha', 'Tipo', 'Cantidad', 'Unidad', 'Precio', 'Importe', 'Notas', 'Facturas']);
          const filters = applyMovementFilters({}, query, item.id);
          const movements = await (strapi as any).entityService.findMany('api::movement.movement', {
            filters,
            populate: includeInvoices ? { invoices: true } : undefined,
            sort: { date: 'ASC' },
            limit: 10000,
          });
          for (const m of movements) ws.addRow(movementRow(m, includeInvoices, locale, timezone));
          if (wsSummaryGeneral) {
            const totals = computeTotals(movements);
            wsSummaryGeneral.addRow([item.name, totals.inbound, totals.outbound, totals.adjustment, totals.net]);
          }
        }
      } else {
        // Hoja consolidada
        const ws = workbook.addWorksheet('Movimientos');
        ws.addRow(['Item', 'Fecha', 'Tipo', 'Cantidad', 'Unidad', 'Precio', 'Importe', 'Notas', 'Facturas']);
        for (const item of items) {
          const filters = applyMovementFilters({}, query, item.id);
          const movements = await (strapi as any).entityService.findMany('api::movement.movement', {
            filters,
            populate: includeInvoices ? { invoices: true } : undefined,
            sort: { date: 'ASC' },
            limit: 10000,
          });
          for (const m of movements) ws.addRow([item.name, ...movementRow(m, includeInvoices, locale, timezone)]);
          if (wsSummaryGeneral) {
            const totals = computeTotals(movements);
            wsSummaryGeneral.addRow([item.name, totals.inbound, totals.outbound, totals.adjustment, totals.net]);
          }
        }
      }
    }

    if (mode === 'supplier') {
      // Export específico por proveedor
      const supplier = await getEntryByDocumentId(strapi, 'api::supplier.supplier', String(supplierDocumentId));
      if (!supplier) throw new Error('Supplier not found');
      filename = `supplier-${supplier.documentId || supplier.id}_items-movements_${periodLabel}.xlsx`;
      // Crear hoja Resumen primero (si aplica)
      let wsSummarySupplier: ExcelJS.Worksheet | null = null;
      if (includeSummary) {
        wsSummarySupplier = workbook.addWorksheet('Resumen');
        wsSummarySupplier.addRow(['Proveedor', supplier.name || '']);
        wsSummarySupplier.addRow(['Periodo', periodLabel]);
        wsSummarySupplier.addRow([]);
        wsSummarySupplier.addRow(['Item', 'Entradas', 'Salidas', 'Ajustes', 'Neto']);
      }
      // Recuperar items del proveedor considerando todas las localizaciones del proveedor
      let supplierIds: number[] = [];
      try {
        const supplierLocs = await (strapi.db as any)
          .query('api::supplier.supplier')
          .findMany({ where: { documentId: supplier.documentId }, select: ['id', 'documentId'] });
        supplierIds = Array.isArray(supplierLocs) ? supplierLocs.map((s: any) => s.id) : [supplier.id];
      } catch {
        supplierIds = [supplier.id];
      }
      const items = await (strapi as any).entityService.findMany('api::item.item', {
        filters: { supplier: { id: { $in: supplierIds } } },
        sort: { name: 'ASC' },
        limit: 1000,
      });

      const sheetMode = sheetBy === 'none' ? 'none' : 'item';
      if (sheetMode === 'item' && items.length <= SHEET_LIMIT) {
        for (const item of items) {
          const ws = workbook.addWorksheet(item.name?.slice(0, 31) || `Item ${item.id}`);
          ws.addRow(['Fecha', 'Tipo', 'Cantidad', 'Unidad', 'Precio', 'Importe', 'Notas', 'Facturas']);
          const filters = applyMovementFilters({}, query, item.id);
          const movements = await (strapi as any).entityService.findMany('api::movement.movement', {
            filters,
            populate: includeInvoices ? { invoices: true } : undefined,
            sort: { date: 'ASC' },
            limit: 10000,
          });
          for (const m of movements) ws.addRow(movementRow(m, includeInvoices, locale, timezone));
          if (wsSummarySupplier) {
            const totals = computeTotals(movements);
            wsSummarySupplier.addRow([item.name, totals.inbound, totals.outbound, totals.adjustment, totals.net]);
          }
        }
      } else {
        // Consolidada
        const ws = workbook.addWorksheet('Movimientos');
        ws.addRow(['Item', 'Fecha', 'Tipo', 'Cantidad', 'Unidad', 'Precio', 'Importe', 'Notas', 'Facturas']);
        for (const item of items) {
          const filters = applyMovementFilters({}, query, item.id);
          const movements = await (strapi as any).entityService.findMany('api::movement.movement', {
            filters,
            populate: includeInvoices ? { invoices: true } : undefined,
            sort: { date: 'ASC' },
            limit: 10000,
          });
          for (const m of movements) ws.addRow([item.name, ...movementRow(m, includeInvoices, locale, timezone)]);
          if (wsSummarySupplier) {
            const totals = computeTotals(movements);
            wsSummarySupplier.addRow([item.name, totals.inbound, totals.outbound, totals.adjustment, totals.net]);
          }
        }
      }
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    return { buffer, filename, contentType };
  },
}));
