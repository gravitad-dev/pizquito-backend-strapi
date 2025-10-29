/**
 * backup controller (reiniciado mínimo): delega en servicios.
 * Todos los endpoints usan documentId (string) en params.
 * La lógica de negocio vive en el servicio api::backup.backup.
 */

import { factories } from '@strapi/strapi';

export default factories.createCoreController('api::backup.backup', ({ strapi }) => ({

  // Crear backup tar.gz
  async create(ctx) {
    try {
      const description = (ctx.request.body as any)?.description || undefined;
      const service = strapi.service('api::backup.backup');
      const created = await (service as any).createTarGzBackup(description);
      ctx.body = { data: created, message: 'Backup tar.gz creado correctamente' };
    } catch (error: any) {
      strapi.log.error(`Error creando backup: ${error?.message}`);
      ctx.badRequest('Error al crear backup', { error: error?.message });
    }
  },

  // Descargar tar.gz por documentId
  async download(ctx) {
    try {
      const { documentId } = ctx.params;
      const service = strapi.service('api::backup.backup');
      await (service as any).streamDownloadByDocumentId(documentId, ctx);
    } catch (error: any) {
      strapi.log.error(`Error al descargar backup: ${error?.message}`);
      ctx.badRequest('Error al descargar backup', { error: error?.message });
    }
  },

  // Eliminar backup por documentId
  async delete(ctx) {
    try {
      const { documentId } = ctx.params;
      const service = strapi.service('api::backup.backup');
      const result = await (service as any).deleteByDocumentId(documentId);
      ctx.body = { data: result, message: 'Backup eliminado correctamente' };
    } catch (error: any) {
      strapi.log.error(`Error eliminando backup: ${error?.message}`);
      ctx.badRequest('Error al eliminar backup', { error: error?.message });
    }
  },

  // Exportar resumen XLSX de la BD actual
  async exportXlsx(ctx) {
    try {
      const service = strapi.service('api::backup.backup');
      const limit = ctx?.query?.limit ? Number(ctx.query.limit) : undefined;
      const { filename, buffer } = await (service as any).exportXlsx(limit);
      ctx.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      ctx.set('Content-Disposition', `attachment; filename="${filename}"`);
      ctx.body = buffer;
    } catch (error: any) {
      strapi.log.error(`Error exportando XLSX: ${error?.message}`);
      ctx.badRequest('Error al exportar XLSX', { error: error?.message });
    }
  },

  // Exportar XLSX desde un backup específico (.tar.gz) por documentId
  async exportXlsxByDocument(ctx) {
    try {
      const { documentId } = ctx.params;
      const service = strapi.service('api::backup.backup');
      const limit = ctx?.query?.limit ? Number(ctx.query.limit) : undefined;
      const { filename, buffer } = await (service as any).exportXlsxFromTarGzByDocumentId(documentId, limit);
      ctx.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      ctx.set('Content-Disposition', `attachment; filename="${filename}"`);
      ctx.body = buffer;
    } catch (error: any) {
      strapi.log.error(`Error exportando XLSX desde backup: ${error?.message}`);
      ctx.badRequest('Error al exportar XLSX desde backup', { error: error?.message });
    }
  },

  // Exportar JSON consolidado desde un backup específico (.tar.gz) por documentId
  async exportJsonByDocument(ctx) {
    try {
      const { documentId } = ctx.params;
      const service = strapi.service('api::backup.backup');
      const { filename, buffer } = await (service as any).exportJsonFromTarGzByDocumentId(documentId);
      ctx.set('Content-Type', 'application/json');
      ctx.set('Content-Disposition', `attachment; filename="${filename}"`);
      ctx.body = buffer;
    } catch (error: any) {
      strapi.log.error(`Error exportando JSON desde backup: ${error?.message}`);
      ctx.badRequest('Error al exportar JSON desde backup', { error: error?.message });
    }
  },

  // Restaurar desde tar.gz por documentId (no modifica la tabla/entries de backups)
  async restore(ctx) {
    try {
      const { documentId } = ctx.params;
      const service = strapi.service('api::backup.backup');
      const pruneMissing = String(ctx?.query?.prune || '').toLowerCase() === 'true' || String(ctx?.query?.mode || '').toLowerCase() === 'prune';
      const pruneUids = typeof ctx?.query?.pruneUids === 'string'
        ? (ctx.query.pruneUids as string).split(',').map((s) => s.trim()).filter(Boolean)
        : Array.isArray(ctx?.query?.pruneUids)
          ? (ctx.query.pruneUids as string[]).map((s) => String(s).trim()).filter(Boolean)
          : undefined;
      const summary = await (service as any).restoreFromTarGzByDocumentId(documentId, {
        preserveBackupsTable: true,
        pruneMissing,
        pruneUids,
      });
      ctx.body = { data: summary, message: 'Restore completado sin modificar el content-type backup' };
    } catch (error: any) {
      strapi.log.error(`Error al restaurar backup: ${error?.message}`);
      ctx.badRequest('Error al restaurar backup', { error: error?.message });
    }
  },

  // Restaurar desde upload (.tar.gz) sin crear/modificar entradas de backup
  async restoreFromUpload(ctx) {
    try {
      const service = strapi.service('api::backup.backup');
      const file: any = (ctx.request.files as any)?.file || (ctx.request.files as any)?.backup;
      if (!file) return ctx.badRequest('Debe enviar un archivo .tar.gz en multipart/form-data (campo "file")');
      const pruneMissing = String(ctx?.query?.prune || '').toLowerCase() === 'true' || String(ctx?.query?.mode || '').toLowerCase() === 'prune';
      const pruneUids = typeof ctx?.query?.pruneUids === 'string'
        ? (ctx.query.pruneUids as string).split(',').map((s) => s.trim()).filter(Boolean)
        : Array.isArray(ctx?.query?.pruneUids)
          ? (ctx.query.pruneUids as string[]).map((s) => String(s).trim()).filter(Boolean)
          : undefined;
      const summary = await (service as any).restoreFromUploadTarGz(file, {
        preserveBackupsTable: true,
        pruneMissing,
        pruneUids,
      });
      ctx.body = { data: summary, message: 'Restore desde upload completado sin modificar el content-type backup' };
    } catch (error: any) {
      strapi.log.error(`Error en restoreFromUpload: ${error?.message}`);
      ctx.badRequest('Error al restaurar desde upload', { error: error?.message });
    }
  },

  // Sincronizar backups (filesystem -> registros)
  async sync(ctx) {
    try {
      const service = strapi.service('api::backup.backup');
      const result = await (service as any).syncBackups();
      ctx.body = { data: result };
    } catch (error: any) {
      strapi.log.error(`Error en sync de backups: ${error?.message}`);
      ctx.badRequest('Error al sincronizar backups', { error: error?.message });
    }
  },
}));