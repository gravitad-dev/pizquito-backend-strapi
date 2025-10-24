/**
 * backup controller (simplificado)
 */

import { factories } from '@strapi/strapi';
import path from 'path';
import { promises as fsp, createReadStream, existsSync } from 'fs';
import ExcelJS from 'exceljs';

import { syncBackupsIndex } from '../../../utils/backup-sync';

function formatTimestamp(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  const YYYY = d.getFullYear();
  const MM = pad(d.getMonth() + 1);
  const DD = pad(d.getDate());
  const hh = pad(d.getHours());
  const mm = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  return `${YYYY}${MM}${DD}_${hh}${mm}${ss}`;
}

async function ensureDir(dir: string) {
  await fsp.mkdir(dir, { recursive: true });
}

// Checksum propio (FNV-1a 32-bit) para evitar usar 'crypto'
function fnv1aHex(buffer: Uint8Array): string {
  let hash = 0x811c9dc5; // offset basis
  for (let i = 0; i < buffer.length; i++) {
    hash ^= buffer[i];
    hash = Math.imul(hash, 0x01000193); // 16777619
  }
  const hex = (hash >>> 0).toString(16).padStart(8, '0');
  return `fnv1a32:${hex}`;
}

async function computeChecksum(filePath: string) {
  const buf = await fsp.readFile(filePath);
  return fnv1aHex(buf);
}

export default factories.createCoreController('api::backup.backup', ({ strapi }) => ({
  // Crear backup de todas las tablas (simple)
  async create(ctx) {
    try {
      const client = process.env.DATABASE_CLIENT || 'sqlite';
      const backupsDir = path.resolve(process.cwd(), 'backups');
      await ensureDir(backupsDir);

      const now = new Date();
      const ts = formatTimestamp(now);

      let filename = '';
      let destPath = '';
      let size = 0;
      let checksum = '';
      let metadata: any = {
        database: { client },
        createdAt: now.toISOString(),
        strategy: client === 'sqlite' ? 'sqlite-file-copy' : 'content-json-export',
      };

      if (client === 'sqlite') {
        const sqliteRel = process.env.DATABASE_FILENAME || '.tmp/data.db';
        const sourcePath = path.resolve(process.cwd(), sqliteRel);
        filename = `backup_${ts}.sqlite`;
        destPath = path.join(backupsDir, filename);
        await fsp.copyFile(sourcePath, destPath);
        const stat = await fsp.stat(destPath);
        size = stat.size;
        checksum = await computeChecksum(destPath);
      } else {
        // Exportar todo el contenido a JSON para bases no-sqlite
        const dump: Record<string, any[]> = {};
        const uids = Object.keys(strapi.contentTypes || {})
          .filter((uid) => {
            const ct: any = (strapi.contentTypes as any)[uid];
            return ct && ct.kind === 'collectionType' && uid.startsWith('api::') && uid !== 'api::backup.backup';
          });

        for (const uid of uids) {
          const items = await strapi.entityService.findMany(uid as any, { populate: '*' });
          dump[uid] = items;
        }

        filename = `backup_${ts}.json`;
        destPath = path.join(backupsDir, filename);
        const json = JSON.stringify({ createdAt: now.toISOString(), data: dump }, null, 2);
        await fsp.writeFile(destPath, json, 'utf-8');
        const stat = await fsp.stat(destPath);
        size = stat.size;
        checksum = await computeChecksum(destPath);
        metadata.exportedContentTypes = uids;
      }

      const description = ctx.request.body?.description || 'Backup simple de todas las tablas.';

      const created = await strapi.entityService.create('api::backup.backup', {
        data: {
          filename,
          originalSize: size,
          compressedSize: null,
          checksum,
          statusBackup: 'completed',
          backupType: 'manual',
          description,
          metadata,
          filePath: destPath,
        },
      });

      ctx.body = { data: created, message: 'Backup creado correctamente' };
    } catch (error: any) {
      strapi.log.error(`Error creando backup: ${error?.message}`);
      ctx.badRequest('Error al crear backup', { error: error?.message });
    }
  },

  // Exportar resumen en XLSX (desde la BD actual)
  async exportXlsx(ctx) {
    try {
      const workbook = new ExcelJS.Workbook();
      const now = new Date();
      workbook.creator = 'Pizquito-Backend';
      workbook.created = now;

      const resumen = workbook.addWorksheet('Resumen');
      resumen.columns = [
        { header: 'Tabla', key: 'tabla', width: 32 },
        { header: 'Cantidad', key: 'cantidad', width: 12 },
      ];

      const uids = Object.keys(strapi.contentTypes || {})
        .filter((uid) => {
          const ct: any = (strapi.contentTypes as any)[uid];
          return ct && ct.kind === 'collectionType' && uid.startsWith('api::') && uid !== 'api::backup.backup';
        });

      for (const uid of uids) {
        let count = 0;
        try {
          count = await (strapi.db as any).query(uid).count();
        } catch {
          const items = await strapi.entityService.findMany(uid as any, {} as any);
          count = Array.isArray(items) ? items.length : 0;
        }
        resumen.addRow({ tabla: uid.replace('api::', ''), cantidad: count });
      }

      // Crear hojas por cada tipo con campos básicos
      for (const uid of uids) {
        const ct: any = (strapi.contentTypes as any)[uid];
        const name = (ct?.info?.singularName || uid.split('.').pop() || 'data').toString();
        const sheet = workbook.addWorksheet(name.substring(0, 31));

        const stringFields = Object.keys(ct.attributes || {})
          .filter((k) => (ct.attributes[k]?.type === 'string' || ct.attributes[k]?.type === 'text'))
          .slice(0, 6);

        const cols = [
          { header: 'id', key: 'id', width: 10 },
          { header: 'createdAt', key: 'createdAt', width: 22 },
          { header: 'updatedAt', key: 'updatedAt', width: 22 },
          ...stringFields.map((k) => ({ header: k, key: k, width: 24 })),
        ];
        sheet.columns = cols as any;

        const items = await strapi.entityService.findMany(uid as any, { limit: 200 } as any);
        for (const it of items as any[]) {
          const row: any = {
            id: it.id,
            createdAt: it.createdAt,
            updatedAt: it.updatedAt,
          };
          for (const k of stringFields) row[k] = it[k];
          sheet.addRow(row);
        }
      }

      const buffer = await workbook.xlsx.writeBuffer();
      const ts = formatTimestamp(now);
      ctx.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      ctx.set('Content-Disposition', `attachment; filename="resumen_${ts}.xlsx"`);
      ctx.body = buffer;
    } catch (error: any) {
      strapi.log.error(`Error exportando XLSX: ${error?.message}`);
      ctx.badRequest('Error al exportar XLSX', { error: error?.message });
    }
  },



  // Descargar archivo de backup
  async download(ctx) {
    try {
      const { documentId } = ctx.params;
      const backup = await strapi.entityService.findOne('api::backup.backup', documentId);
      if (!backup) return ctx.notFound('Backup no encontrado');

      const filePath: string | undefined = (backup as any).filePath;
      if (!filePath || !existsSync(filePath)) {
        return ctx.notFound('Archivo de backup no encontrado en el servidor');
      }

      const filename = (backup as any).filename || path.basename(filePath);
      ctx.set('Content-Type', 'application/octet-stream');
      ctx.set('Content-Disposition', `attachment; filename="${filename}"`);
      try {
        const stat = await fsp.stat(filePath);
        ctx.set('Content-Length', String(stat.size));
      } catch {}

      ctx.body = createReadStream(filePath);
    } catch (error: any) {
      strapi.log.error(`Error al descargar backup: ${error?.message}`);
      ctx.badRequest('Error al descargar backup', { error: error?.message });
    }
  },

  // Eliminar backup (borra archivo y entry)
  async delete(ctx) {
    try {
      const { documentId } = ctx.params;
      const backup = await strapi.entityService.findOne('api::backup.backup', documentId);
      if (!backup) return ctx.notFound('Backup no encontrado');

      if ((backup as any).filePath) {
        try {
          await fsp.unlink((backup as any).filePath);
        } catch (e) {
          // Ignorar si el archivo no existe
        }
      }

      const deleted = await strapi.entityService.delete('api::backup.backup', documentId);
      ctx.body = { data: deleted, message: 'Backup eliminado correctamente' };
    } catch (error: any) {
      strapi.log.error(`Error eliminando backup: ${error?.message}`);
      ctx.badRequest('Error al eliminar backup', { error: error?.message });
    }
  },

  // Restaurar backup (sqlite: copia de archivo; otros: no implementado)
  async restore(ctx) {
    try {
      const { documentId } = ctx.params;
      const backup = await strapi.entityService.findOne('api::backup.backup', documentId);
      if (!backup) return ctx.notFound('Backup no encontrado');

      const client = process.env.DATABASE_CLIENT || 'sqlite';
      if (client === 'sqlite') {
        const sqliteRel = process.env.DATABASE_FILENAME || '.tmp/data.db';
        const dbPath = path.resolve(process.cwd(), sqliteRel);

        // Hacer copia de seguridad del DB actual antes de restaurar
        const ts = formatTimestamp(new Date());
        const safetyFilename = `restore_safety_${ts}.sqlite`;
        const backupsDir = path.resolve(process.cwd(), 'backups');
        const safetyPath = path.join(backupsDir, safetyFilename);
        try {
          await fsp.copyFile(dbPath, safetyPath);
        } catch (e) {
          // si no existe, continuar
        }

        // Copiar el archivo de backup a la ruta del DB
        await fsp.copyFile((backup as any).filePath, dbPath);

        // Si se solicita excluir la tabla backups del restore, reinyectamos su contenido desde el safety DB
        const excludeBackupsEnv = String(process.env.EXCLUDE_BACKUPS_ON_RESTORE || '').toLowerCase();
        const excludeBackupsBody = Boolean((ctx.request.body as any)?.excludeBackups);
        const shouldExcludeBackups = excludeBackupsBody || ['1','true','yes'].includes(excludeBackupsEnv);
        if (shouldExcludeBackups) {
          try {
            const knex = (strapi.db as any).connection;
            const quotedSafetyPath = safetyPath.replace(/'/g, "''");
            await knex.raw(`ATTACH DATABASE '${quotedSafetyPath}' AS safedb;`);
            await knex.raw('PRAGMA foreign_keys = OFF;');
            await knex.raw('DELETE FROM backups;');
            await knex.raw('INSERT INTO backups SELECT * FROM safedb.backups;');
            await knex.raw('PRAGMA foreign_keys = ON;');
            await knex.raw('DETACH DATABASE safedb;');
            strapi.log.info('Tabla backups preservada desde safety DB tras restore.');
          } catch (e: any) {
            strapi.log.warn(`No se pudo preservar la tabla backups tras restore: ${e?.message}. Continuando...`);
          }
        }

        await strapi.entityService.update('api::backup.backup', documentId, {
          data: { statusBackup: 'completed', description: `Backup restaurado desde ${ (backup as any).filename }` },
        });

        const autoRestartEnv = String(process.env.BACKUP_AUTO_RESTART || '').toLowerCase();
        const autoRestartBody = Boolean((ctx.request.body as any)?.autoRestart);
        const shouldRestart = autoRestartBody || ['1','true','yes'].includes(autoRestartEnv);
        if (shouldRestart) {
          // Salir del proceso para permitir reinicio (PM2/Nodemon/Docker)
          setTimeout(() => {
            strapi.log.warn('Saliendo del proceso para completar la restauración de SQLite...');
            process.exit(0);
          }, 500);
        }

        ctx.body = {
          data: {
            restored: true,
            requiresServerRestart: !shouldRestart,
            safetyBackup: safetyFilename,
            backupsTablePreserved: shouldExcludeBackups,
          },
          message: shouldRestart
            ? 'Backup restaurado correctamente (sqlite). El servidor se reiniciará automáticamente.'
            : 'Backup restaurado correctamente (sqlite). Reinicia el servidor para aplicar cambios.',
        };
      } else {
        ctx.status = 501;
        ctx.body = {
          error: 'restore_not_implemented',
          message: 'La restauración desde JSON aún no está implementada para bases no-sqlite.',
        };
      }
    } catch (error: any) {
      strapi.log.error(`Error restaurando backup: ${error?.message}`);
      ctx.badRequest('Error al restaurar backup', { error: error?.message });
    }
  },

  // Restaurar la BDD subiendo un archivo de backup (solo sqlite por ahora)
  async restoreFromUpload(ctx) {
    try {
      const client = process.env.DATABASE_CLIENT || 'sqlite';
      const backupsDir = path.resolve(process.cwd(), 'backups');
      await ensureDir(backupsDir);

      const files: any = (ctx.request as any).files || {};
      const file: any = files.file || files.backup || null;
      if (!file || !file.path) {
        return ctx.badRequest('Debe enviar un archivo de backup en multipart/form-data (campo "file")');
      }

      const now = new Date();
      const ts = formatTimestamp(now);
      const originalName: string = file.name || `uploaded_${ts}.sqlite`;
      const ext = path.extname(originalName) || '.sqlite';
      const filename = `uploaded_${ts}${ext}`;
      const destPath = path.join(backupsDir, filename);

      // Mover/copiar el archivo subido al directorio de backups
      await fsp.copyFile(file.path, destPath);
      const stat = await fsp.stat(destPath);
      const checksum = await computeChecksum(destPath);

      const created = await strapi.entityService.create('api::backup.backup', {
        data: {
          filename,
          originalSize: stat.size,
          compressedSize: null,
          checksum,
          statusBackup: 'completed',
          backupType: 'manual',
          description: `Archivo subido por API (${originalName})`,
          metadata: { uploadedAt: now.toISOString(), originalName },
          filePath: destPath,
        },
      });

      if (client === 'sqlite') {
        const sqliteRel = process.env.DATABASE_FILENAME || '.tmp/data.db';
        const dbPath = path.resolve(process.cwd(), sqliteRel);

        // Copia de seguridad previa
        const safetyFilename = `restore_safety_${ts}.sqlite`;
        const safetyPath = path.join(backupsDir, safetyFilename);
        try {
          await fsp.copyFile(dbPath, safetyPath);
        } catch {}

        // Restaurar desde el archivo subido
        await fsp.copyFile(destPath, dbPath);

        // Si se solicita excluir la tabla backups del restore, reinyectamos su contenido desde el safety DB
        const excludeBackupsEnv = String(process.env.EXCLUDE_BACKUPS_ON_RESTORE || '').toLowerCase();
        const excludeBackupsBody = Boolean((ctx.request.body as any)?.excludeBackups);
        const shouldExcludeBackups = excludeBackupsBody || ['1','true','yes'].includes(excludeBackupsEnv);
        if (shouldExcludeBackups) {
          try {
            const knex = (strapi.db as any).connection;
            const quotedSafetyPath = safetyPath.replace(/'/g, "''");
            await knex.raw(`ATTACH DATABASE '${quotedSafetyPath}' AS safedb;`);
            await knex.raw('PRAGMA foreign_keys = OFF;');
            await knex.raw('DELETE FROM backups;');
            await knex.raw('INSERT INTO backups SELECT * FROM safedb.backups;');
            await knex.raw('PRAGMA foreign_keys = ON;');
            await knex.raw('DETACH DATABASE safedb;');
            strapi.log.info('Tabla backups preservada desde safety DB tras restoreFromUpload.');
          } catch (e: any) {
            strapi.log.warn(`No se pudo preservar la tabla backups tras restoreFromUpload: ${e?.message}. Continuando...`);
          }
        }

        const autoRestartEnv = String(process.env.BACKUP_AUTO_RESTART || '').toLowerCase();
        const autoRestartBody = Boolean((ctx.request.body as any)?.autoRestart);
        const shouldRestart = autoRestartBody || ['1','true','yes'].includes(autoRestartEnv);
        if (shouldRestart) {
          setTimeout(() => {
            strapi.log.warn('Saliendo del proceso para completar la restauración desde upload...');
            process.exit(0);
          }, 500);
        }

        ctx.body = {
          data: {
            restored: true,
            createdBackupId: (created as any).id,
            requiresServerRestart: !shouldRestart,
            safetyBackup: safetyFilename,
            backupsTablePreserved: shouldExcludeBackups,
          },
          message: shouldRestart
            ? 'Restauración completada desde archivo subido (sqlite). El servidor se reiniciará automáticamente.'
            : 'Restauración completada desde archivo subido (sqlite). Reinicia el servidor para aplicar cambios.',
        };
      } else {
        ctx.status = 501;
        ctx.body = {
          error: 'restore_upload_not_implemented',
          message: 'La restauración desde archivo subido aún no está implementada para bases no-sqlite.',
        };
      }
    } catch (error: any) {
      strapi.log.error(`Error en restoreFromUpload: ${error?.message}`);
      ctx.badRequest('Error al restaurar desde archivo subido', { error: error?.message });
    }
  },

  // Sincronizar índice de backups desde el filesystem
  async sync(ctx) {
    try {
      const result = await syncBackupsIndex(strapi, { markMissingAsCorrupted: true });
      ctx.body = { data: result, message: 'Sync completado' };
    } catch (error: any) {
      strapi.log.error(`Error en sync de backups: ${error?.message}`);
      ctx.badRequest('Error al sincronizar backups', { error: error?.message });
    }
  },
}));
