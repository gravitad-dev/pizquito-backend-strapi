import { promises as fsp } from 'fs';
import { existsSync } from 'fs';

/**
 * Lifecycles for api::backup.backup
 *
 * Objetivo: asegurar que al eliminar un backup se borre también el archivo físico
 * indicado en filePath, independientemente de si la eliminación se hace desde
 * el endpoint custom o desde el administrador de Strapi.
 */
export default {
  /**
   * beforeDelete: se ejecuta antes de eliminar los registros.
   * Buscamos los backups afectados por el where y eliminamos sus archivos.
   */
  async beforeDelete(event: any) {
    try {
      const where = event?.params?.where || {};
      // Obtenemos los registros que serán eliminados
      const backups = await strapi.entityService.findMany('api::backup.backup' as any, {
        filters: where,
        fields: ['id', 'filePath', 'documentId'],
        limit: 1000, // protección básica para eliminaciones masivas
      } as any);

      if (Array.isArray(backups)) {
        for (const b of backups) {
          const filePath = (b as any)?.filePath;
          if (filePath && typeof filePath === 'string' && existsSync(filePath)) {
            try {
              await fsp.unlink(filePath);
            } catch (err) {
              // No bloquear la eliminación por fallos de filesystem
              strapi.log?.warn?.(`No se pudo eliminar archivo de backup (${filePath}) antes de borrar docId=${(b as any)?.documentId}: ${(err as any)?.message || err}`);
            }
          }
        }
      }
    } catch (e) {
      // No bloquear la eliminación por errores en el hook
      strapi.log?.warn?.(`Fallo en lifecycle beforeDelete de api::backup.backup: ${(e as any)?.message || e}`);
    }
  },
};