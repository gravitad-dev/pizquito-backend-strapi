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
        { header: 'UID', key: 'uid', width: 40 },
        { header: 'Hoja', key: 'hoja', width: 32 },
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
          const items = await strapi.entityService.findMany(uid as any, { pagination: { limit: -1 } } as any);
          count = Array.isArray(items) ? items.length : 0;
        }
        const ct: any = (strapi.contentTypes as any)[uid];
        const name = (ct?.info?.singularName || uid.split('.').pop() || 'data').toString();
        const hoja = name.substring(0, 31);
        resumen.addRow({ tabla: uid.replace('api::', ''), uid, hoja, cantidad: count });
      }

      // Crear hojas por cada tipo con campos básicos
      for (const uid of uids) {
        const ct: any = (strapi.contentTypes as any)[uid];
        const name = (ct?.info?.singularName || uid.split('.').pop() || 'data').toString();
        const sheet = workbook.addWorksheet(name.substring(0, 31));

        const stringFields = Object.keys(ct.attributes || {})
          .filter((k) => (ct.attributes[k]?.type === 'string' || ct.attributes[k]?.type === 'text'));

        const cols = [
          { header: 'id', key: 'id', width: 10 },
          { header: 'createdAt', key: 'createdAt', width: 22 },
          { header: 'updatedAt', key: 'updatedAt', width: 22 },
          ...stringFields.map((k) => ({ header: k, key: k, width: 24 })),
        ];
        sheet.columns = cols as any;

        // Permitir controlar el límite de filas exportadas vía query (?limit=)
        const limitParam = (ctx.query as any)?.limit;
        const parsed = parseInt(limitParam, 10);
        const limitValue = Number.isFinite(parsed) ? parsed : -1; // -1 exporta todo
        const items = await strapi.entityService.findMany(uid as any, { pagination: { limit: limitValue } } as any);
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
      const backup = await strapi.documents('api::backup.backup').findOne({
        documentId,
        status: 'published'
      });
      if (!backup) return ctx.notFound('Backup no encontrado');

      const filePath: string | undefined = (backup as any).filePath;
      if (!filePath || !existsSync(filePath)) {
        return ctx.notFound('Archivo de backup no encontrado en el servidor');
      }

      const filename = (backup as any).filename || path.basename(filePath);
      
      // Configurar headers correctos para descarga
      const isJson = filename.endsWith('.json');
      ctx.set('Content-Type', isJson ? 'application/json' : 'application/octet-stream');
      ctx.set('Content-Disposition', `attachment; filename="${filename}"`);
      ctx.set('Access-Control-Expose-Headers', 'Content-Disposition');
      
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
      const backup = await strapi.documents('api::backup.backup').findOne({
        documentId,
        status: 'published'
      });
      if (!backup) return ctx.notFound('Backup no encontrado');

      if ((backup as any).filePath) {
        try {
          await fsp.unlink((backup as any).filePath);
        } catch (e) {
          // Ignorar si el archivo no existe
        }
      }

      const deleted = await strapi.documents('api::backup.backup').delete({
        documentId
      });
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
      const backup = await strapi.documents('api::backup.backup').findOne({
        documentId,
        status: 'published'
      });
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

        await strapi.documents('api::backup.backup').update({
          documentId,
          status: 'published',
          data: { statusBackup: 'completed', description: `Backup restaurado desde ${(backup as any).filename}` },
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
        // Restauración desde JSON para PostgreSQL/MySQL
        const jsonData = JSON.parse(await fsp.readFile((backup as any).filePath, 'utf8'));
        // Los backups JSON creados por este controlador usan la forma
        // { createdAt: string, data: { 'api::...': [entities] } }
        // Por compatibilidad, si no existe jsonData.data, intentamos usar el propio jsonData
        const payloadData: Record<string, any> = (jsonData && typeof jsonData === 'object' && jsonData.data && typeof jsonData.data === 'object')
          ? jsonData.data
          : jsonData;

        // Obtener todas las entidades del sistema
        const contentTypes = Object.keys(strapi.contentTypes).filter(key =>
          key.startsWith('api::') && !key.includes('backup')
        );

        // Respetar bandera para crear backup de seguridad antes de restaurar
        const shouldCreateSafetyBackup = (ctx.request.body as any)?.createSafetyBackup === false ? false : true;
        const ts = formatTimestamp(new Date());
        const backupsDir = path.resolve(process.cwd(), 'backups');
        let safetyFilename: string | null = null;
        let safetyPath: string | null = null;
        if (shouldCreateSafetyBackup) {
          safetyFilename = `restore_safety_${ts}.json`;
          safetyPath = path.join(backupsDir, safetyFilename);

          const safetyData: any = {};
          for (const contentType of contentTypes) {
            try {
              const entities = await strapi.entityService.findMany(contentType as any, {
                populate: '*',
                pagination: { limit: -1 }
              });
              safetyData[contentType] = entities;
            } catch (e) {
              strapi.log.warn(`No se pudo respaldar ${contentType}: ${e}`);
            }
          }
          await fsp.writeFile(safetyPath, JSON.stringify(safetyData, null, 2));
        }

        // Validar que el payload contiene claves de content-types válidas antes de borrar nada
        const payloadKeys = Object.keys(payloadData || {});
        const hasValidContent = payloadKeys.some((k) => k.startsWith('api::') && !k.includes('backup'));
        if (!hasValidContent) {
          return ctx.badRequest('Backup JSON inválido o sin datos de content-types. Restauración abortada para proteger la base de datos.');
        }

        // Iniciar transacción para rollback seguro
        const knex = (strapi.db as any).connection;
        const trx = await knex.transaction();
        
        try {
          // Deshabilitar foreign keys temporalmente
          if (client === 'postgresql' || client === 'postgres') {
            await trx.raw('SET session_replication_role = replica;');
          } else if (client === 'mysql') {
            await trx.raw('SET FOREIGN_KEY_CHECKS = 0;');
          }

          // Limpiar tablas existentes (excepto backups)
          for (const contentType of contentTypes) {
            const tableName = strapi.db.metadata.get(contentType).tableName;
            if (client === 'postgresql' || client === 'postgres') {
              await trx.raw(`TRUNCATE TABLE "${tableName}" RESTART IDENTITY CASCADE;`);
            } else if (client === 'mysql') {
              await trx.raw(`TRUNCATE TABLE \`${tableName}\`;`);
            } else {
              await trx.raw(`DELETE FROM "${tableName}"`);
            }
          }

          // Restaurar datos desde JSON
          let restoredCount = 0;
          for (const [contentType, entities] of Object.entries(payloadData)) {
            if (!contentType.startsWith('api::') || contentType.includes('backup')) continue;
            
            const entitiesArray = Array.isArray(entities) ? entities : [];
            for (const entity of entitiesArray) {
              try {
                // Remover campos de sistema que pueden causar conflictos
                const { id, documentId, createdAt, updatedAt, publishedAt, ...cleanData } = entity as any;
                
                await strapi.entityService.create(contentType as any, {
                  data: cleanData,
                });
                restoredCount++;
              } catch (e) {
                strapi.log.warn(`Error restaurando entidad ${contentType}: ${e}`);
              }
            }
          }

          // Rehabilitar foreign keys
          if (client === 'postgresql' || client === 'postgres') {
            await trx.raw('SET session_replication_role = DEFAULT;');
          } else if (client === 'mysql') {
            await trx.raw('SET FOREIGN_KEY_CHECKS = 1;');
          }

          // Confirmar transacción
          await trx.commit();

          await strapi.documents('api::backup.backup').update({
            documentId,
            status: 'published',
            data: { 
              statusBackup: 'completed', 
              description: `Backup JSON restaurado desde ${(backup as any).filename} (${restoredCount} registros)` 
            },
          });

          ctx.body = {
            data: {
              restored: true,
              restoredEntities: restoredCount,
              safetyBackup: safetyFilename,
              requiresServerRestart: false,
            },
            message: `Backup JSON restaurado correctamente. ${restoredCount} registros procesados.`,
          };

        } catch (error: any) {
          // Rollback en caso de error
          await trx.rollback();
          strapi.log.error(`Error durante restauración JSON: ${error?.message}`);
          throw error;
        }
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
      let file: any = files.file || files.backup || null;
      if ((!file || (!file.path && !file.filepath)) && files && typeof files === 'object') {
        const firstKey = Object.keys(files)[0];
        if (firstKey) {
          file = (Array.isArray(files[firstKey]) ? files[firstKey][0] : files[firstKey]) || null;
        }
      }
      const filePath = file?.path || file?.filepath;
      if (!file || !filePath) {
        return ctx.badRequest('Debe enviar un archivo de backup en multipart/form-data (campo "file")');
      }

      const now = new Date();
      const ts = formatTimestamp(now);
      const originalName: string = file.name || file.originalFilename || `uploaded_${ts}.sqlite`;
      const ext = path.extname(originalName) || '.sqlite';
      const filename = `uploaded_${ts}${ext}`;
      const destPath = path.join(backupsDir, filename);

      // Mover/copiar el archivo subido al directorio de backups
      await fsp.copyFile(filePath, destPath);
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
        // Restauración desde archivo JSON subido para PostgreSQL/MySQL
        const jsonData = JSON.parse(await fsp.readFile(destPath, 'utf8'));
        
        // Obtener todas las entidades del sistema
        const contentTypes = Object.keys(strapi.contentTypes).filter(key => 
          key.startsWith('api::') && !key.includes('backup')
        );

        // Crear backup de seguridad antes de restaurar
        const ts = formatTimestamp(new Date());
        const safetyFilename = `restore_upload_safety_${ts}.json`;
        const backupsDir = path.resolve(process.cwd(), 'backups');
        const safetyPath = path.join(backupsDir, safetyFilename);
        
        const safetyData: any = {};
        for (const contentType of contentTypes) {
          try {
            const entities = await strapi.entityService.findMany(contentType as any, { 
              populate: '*',
              pagination: { limit: -1 }
            });
            safetyData[contentType] = entities;
          } catch (e) {
            strapi.log.warn(`No se pudo respaldar ${contentType}: ${e}`);
          }
        }
        await fsp.writeFile(safetyPath, JSON.stringify(safetyData, null, 2));

        // Iniciar transacción para rollback seguro
        const knex = (strapi.db as any).connection;
        const trx = await knex.transaction();
        
        try {
          // Deshabilitar foreign keys temporalmente
          if (client === 'postgresql') {
            await trx.raw('SET session_replication_role = replica;');
          } else if (client === 'mysql') {
            await trx.raw('SET FOREIGN_KEY_CHECKS = 0;');
          }

          // Limpiar tablas existentes (excepto backups)
          for (const contentType of contentTypes) {
            const tableName = strapi.db.metadata.get(contentType).tableName;
            await trx.raw(`DELETE FROM "${tableName}"`);
          }

          // Restaurar datos desde JSON
          let restoredCount = 0;
          for (const [contentType, entities] of Object.entries(jsonData)) {
            if (!contentType.startsWith('api::') || contentType.includes('backup')) continue;
            
            const entitiesArray = Array.isArray(entities) ? entities : [];
            for (const entity of entitiesArray) {
              try {
                // Remover campos de sistema que pueden causar conflictos
                const { id, documentId, createdAt, updatedAt, publishedAt, ...cleanData } = entity as any;
                
                await strapi.entityService.create(contentType as any, {
                  data: cleanData,
                });
                restoredCount++;
              } catch (e) {
                strapi.log.warn(`Error restaurando entidad ${contentType}: ${e}`);
              }
            }
          }

          // Rehabilitar foreign keys
          if (client === 'postgresql') {
            await trx.raw('SET session_replication_role = DEFAULT;');
          } else if (client === 'mysql') {
            await trx.raw('SET FOREIGN_KEY_CHECKS = 1;');
          }

          // Confirmar transacción
          await trx.commit();

          // Crear registro del backup restaurado
          const created = await strapi.entityService.create('api::backup.backup', {
            data: {
              filename: originalName,
              filePath: destPath,
              originalSize: stat.size,
              backupType: 'manual',
              statusBackup: 'completed',
              description: `Backup JSON restaurado desde archivo subido (${restoredCount} registros)`,
              checksum: await computeChecksum(destPath),
            },
          });

          ctx.body = {
            data: {
              restored: true,
              restoredEntities: restoredCount,
              createdBackupId: (created as any).id,
              safetyBackup: safetyFilename,
              requiresServerRestart: false,
            },
            message: `Restauración JSON completada desde archivo subido. ${restoredCount} registros procesados.`,
          };

        } catch (error: any) {
          // Rollback en caso de error
          await trx.rollback();
          strapi.log.error(`Error durante restauración JSON desde upload: ${error?.message}`);
          throw error;
        }
      }
    } catch (error: any) {
      strapi.log.error(`Error en restoreFromUpload: ${error?.message}`);
      ctx.badRequest('Error al restaurar desde archivo subido', { error: error?.message });
    }
  },

  

  // Sincronizar archivos físicos con la BD (elimina archivos huérfanos)
  async sync(ctx) {
    try {
      const { removeOrphans } = ctx.query;
      const remove = removeOrphans === 'false' ? false : true; // Por defecto elimina huérfanos
      const result = await syncBackupsIndex(strapi, { 
        removeOrphanFiles: remove
      });
      ctx.body = { data: result, message: result.message };
    } catch (error: any) {
      strapi.log.error(`Error en sync de backups: ${error?.message}`);
      ctx.badRequest('Error al sincronizar backups', { error: error?.message });
    }
  },
}));
