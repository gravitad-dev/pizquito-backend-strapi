/**
 * backup controller (simplificado)
 */

import { factories } from '@strapi/strapi';
import path from 'path';
import { promises as fsp, createReadStream, existsSync } from 'fs';
import https from 'https';
import http from 'http';
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

  function computeChecksumBuffer(buffer: Uint8Array) {
    return fnv1aHex(buffer);
  }

  async function fetchBufferFromUrl(fileUrl: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const u = new URL(fileUrl);
        const lib = u.protocol === 'https:' ? https : http;
        const req = lib.get(u, (res) => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode} al descargar ${fileUrl}`));
            res.resume();
            return;
          }
          const chunks: Buffer[] = [];
          res.on('data', (d) => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)));
          res.on('end', () => resolve(Buffer.concat(chunks)));
        });
        req.on('error', reject);
      } catch (e) {
        reject(e);
      }
    });
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
      ctx.set('Content-Length', String((buffer as unknown as Buffer).length));
      ctx.set('ETag', computeChecksumBuffer(buffer as unknown as Uint8Array));
      ctx.set('Cache-Control', 'no-store');
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
      const ext = path.extname(filename).toLowerCase();
      const isJson = ext === '.json';
      const isSqlite = ext === '.sqlite' || ext === '.db';
      const contentType = isJson
        ? 'application/json; charset=utf-8'
        : isSqlite
          ? 'application/x-sqlite3'
          : 'application/octet-stream';
      ctx.set('Content-Type', contentType);
      ctx.set('Content-Disposition', `attachment; filename="${filename}"`);
      try {
        const stat = await fsp.stat(filePath);
        ctx.set('Content-Length', String(stat.size));
        ctx.set('Last-Modified', new Date(stat.mtimeMs).toUTCString());
      } catch {}

      // ETag / checksum headers
      const checksum = (backup as any).checksum || await computeChecksum(filePath);
      ctx.set('ETag', checksum);
      ctx.set('X-Checksum', checksum);
      ctx.set('X-Backup-Id', String((backup as any).id || ''));
      ctx.set('X-Backup-Type', String((backup as any).backupType || ''));
      ctx.set('Cache-Control', 'no-store');

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
        // Restauración segura para bases no-sqlite (PostgreSQL):
        // - Soporta modo dry-run (no escribe)
        // - Modo merge por defecto: crea/actualiza sin borrar existentes
        // - Dos pasadas: primero datos sin relaciones, luego parchea relaciones
        const filePath: string | undefined = (backup as any).filePath;
        if (!filePath || !existsSync(filePath)) {
          return ctx.notFound('Archivo de backup JSON no encontrado');
        }

        const body: any = ctx.request.body || {};
        const dryRun = ['1','true','yes'].includes(String(body.dryRun || '').toLowerCase());
        const mode = String(body.mode || 'merge'); // 'merge' | 'replace' (replace pendiente)
        const publishAll = ['1','true','yes'].includes(String(body.publishAll || '').toLowerCase());
        const restoreMedia = ['1','true','yes'].includes(String(body.restoreMedia || '').toLowerCase());

        // Leer JSON
        const raw = await fsp.readFile(filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        const dump: Record<string, any[]> = parsed?.data || {};

        // Preparar utilidades
        const contentTypes: Record<string, any> = (strapi.contentTypes as any) || {};
        const getRelations = (ct: any) => Object.entries(ct?.attributes || {})
          .filter(([_, def]: any) => def?.type === 'relation')
          .map(([name, def]: any) => ({ name, def }));

        // Mapa de ids antiguos a nuevos por UID
        const idMap: Record<string, Map<number, number>> = {};
        const summary: any = { created: {}, updated: {}, skipped: {}, relationsPatched: {} };

        // Transacción (sólo cuando no es dry-run)
        const knex = (strapi.db as any).connection;
        const trx = dryRun ? null : await knex.transaction();

        try {
          // Primera pasada: crear/actualizar sin relaciones
          for (const uid of Object.keys(dump)) {
            if (!uid.startsWith('api::')) continue;
            const ct = contentTypes[uid];
            if (!ct) continue;
            const rels = new Set(getRelations(ct).map((r) => r.name));
            const hasDraftPublish = !!ct?.options?.draftAndPublish;
            const mediaFields = new Set(
              Object.entries(ct?.attributes || {})
                .filter(([_, def]: any) => def?.type === 'media')
                .map(([name]) => name)
            );
            idMap[uid] = new Map<number, number>();

            summary.created[uid] = 0;
            summary.updated[uid] = 0;
            summary.skipped[uid] = 0;

            for (const item of dump[uid] || []) {
              const oldId = item?.id;
              const base: any = {};
              // Construir datos base excluyendo campos problemáticos en create/update
              for (const [k, v] of Object.entries(item)) {
                if (k === 'id') continue;
                if (k === 'documentId') continue; // nunca forzar documentId (Strapi lo gestiona)
                if (k === 'createdAt' || k === 'updatedAt') continue; // gestionados por Strapi
                if (k === 'publishedAt') continue; // publicar se maneja explícitamente abajo
                if (rels.has(k)) continue; // relaciones las parcheamos después
                if (mediaFields.has(k)) continue; // medios se gestionan aparte (no implementado)
                base[k] = v;
              }

              // Heurística de upsert: primero intentar por documentId si existe,
              // luego por campo 'uid' (si existe en el modelo)
              let existing: any = null;
              if (item?.documentId) {
                try {
                  const foundByDoc = await strapi.entityService.findMany(uid as any, { filters: { documentId: item.documentId }, limit: 1 } as any);
                  existing = Array.isArray(foundByDoc) && foundByDoc.length ? foundByDoc[0] : null;
                } catch {}
              }
              if (!existing && item?.uid) {
                try {
                  const found = await strapi.entityService.findMany(uid as any, { filters: { uid: item.uid }, limit: 1 } as any);
                  existing = Array.isArray(found) && found.length ? found[0] : null;
                } catch {}
              }

              if (dryRun) {
                if (existing) summary.updated[uid]++;
                else summary.created[uid]++;
                // Contabilizar publicación simulada
                if (hasDraftPublish && (publishAll || item?.publishedAt)) {
                  summary.published = summary.published || {};
                  summary.published[uid] = (summary.published[uid] || 0) + 1;
                }
                continue;
              }

              let newEntity: any;
              if (existing) {
                newEntity = await strapi.entityService.update(uid as any, existing.id, { data: base, transacting: trx } as any);
                summary.updated[uid]++;
                idMap[uid].set(oldId, existing.id);
              } else {
                newEntity = await strapi.entityService.create(uid as any, { data: base, transacting: trx } as any);
                summary.created[uid]++;
                idMap[uid].set(oldId, newEntity.id);
              }

              // Publicación explícita si el CT soporta draft/publish
              if (hasDraftPublish && (publishAll || item?.publishedAt)) {
                const targetId = existing ? existing.id : newEntity.id;
                const publishDate = item?.publishedAt ? new Date(item.publishedAt) : new Date();
                await strapi.entityService.update(uid as any, targetId, { data: { publishedAt: publishDate }, transacting: trx } as any);
                summary.published = summary.published || {};
                summary.published[uid] = (summary.published[uid] || 0) + 1;
              }
            }
          }

          // Segunda pasada: parchear relaciones
          for (const uid of Object.keys(dump)) {
            const ct = contentTypes[uid];
            if (!ct) continue;
            const rels = getRelations(ct);
            if (!rels.length) continue;
            summary.relationsPatched[uid] = 0;

            for (const item of dump[uid] || []) {
              const oldId = item?.id;
              const newId = idMap[uid]?.get(oldId);
              if (!newId) continue;

              const patch: any = {};
              for (const { name, def } of rels) {
                const val = item[name];
                if (val == null) { patch[name] = val; continue; }
                const targetUid: string = def?.target;

                if (Array.isArray(val)) {
                  // many relations
                  const mapped = val
                    .map((ref: any) => idMap[targetUid]?.get(ref?.id))
                    .filter((id: any) => !!id);
                  patch[name] = mapped;
                } else if (typeof val === 'object') {
                  // manyToOne / oneToOne
                  const mapped = idMap[targetUid]?.get(val?.id) || null;
                  patch[name] = mapped;
                } else if (typeof val === 'number') {
                  // id directo
                  const mapped = idMap[targetUid]?.get(val) || null;
                  patch[name] = mapped;
                }
              }

              if (!dryRun) {
                await strapi.entityService.update(uid as any, newId, { data: patch, transacting: trx } as any);
              }
              summary.relationsPatched[uid]++;
            }
          }

          // Tercera pasada opcional: restaurar media (Cloudinary / Upload)
          if (restoreMedia) {
            summary.media = summary.media || { created: {}, reused: {}, patched: {}, errors: {} };
            const uploadService = strapi.plugin('upload')?.service('upload');
            if (!uploadService) throw new Error('Upload service no disponible');

            const mediaIdMap: Map<number, number> = new Map();

            // Crear/reenlazar files
            for (const uid of Object.keys(dump)) {
              const ct = contentTypes[uid];
              if (!ct) continue;
              const mediaFields = Object.entries(ct?.attributes || {})
                .filter(([_, def]: any) => def?.type === 'media')
                .map(([name]) => name);
              if (!mediaFields.length) continue;

              summary.media.created[uid] = 0;
              summary.media.reused[uid] = 0;
              summary.media.patched[uid] = 0;
              summary.media.errors[uid] = 0;

              for (const item of dump[uid] || []) {
                const oldItemId = item?.id;
                const newItemId = idMap[uid]?.get(oldItemId);
                if (!newItemId) continue;

                const patch: any = {};
                for (const fieldName of mediaFields) {
                  const val = item[fieldName];
                  if (val == null) { patch[fieldName] = val; continue; }

                  const mapOne = async (mediaObj: any): Promise<number | null> => {
                    if (!mediaObj) return null;
                    const oldFileId = mediaObj.id;
                    if (mediaIdMap.has(oldFileId)) return mediaIdMap.get(oldFileId)!;

                    // Intentar reutilizar por hash
                    let existingFile: any = null;
                    if (mediaObj.hash) {
                      try {
                        const found = await strapi.entityService.findMany('plugin::upload.file' as any, { filters: { hash: mediaObj.hash }, limit: 1 } as any);
                        existingFile = Array.isArray(found) && found.length ? found[0] : null;
                      } catch {}
                    }

                    if (existingFile) {
                      mediaIdMap.set(oldFileId, existingFile.id);
                      summary.media.reused[uid]++;
                      return existingFile.id;
                    }

                    if (dryRun) {
                      // En dry-run, no subimos; sólo contamos
                      summary.media.created[uid]++;
                      return null;
                    }
                    try {
                      // Descargar desde URL (preferir secure_url si existe)
                      let fileUrl: string | undefined = mediaObj?.url || mediaObj?.provider_metadata?.secure_url;
                      if (fileUrl) {
                        // Sanitizar: quitar saltos de línea y espacios fantasmas y comillas/backticks envolventes
                        fileUrl = String(fileUrl)
                          .replace(/\r?\n/g, '')
                          .trim()
                          .replace(/^[`'\"]+/, '')
                          .replace(/[`'\"]+$/, '');
                      }

                      let buffer: Buffer | null = null;
                      if (fileUrl && /^https?:\/\//i.test(fileUrl)) {
                        try {
                          buffer = await fetchBufferFromUrl(fileUrl);
                        } catch (err) {
                          // Fallback: intentar obtener secure_url actualizado desde Cloudinary API por public_id
                          try {
                            const cloudinary = require('cloudinary').v2;
                            cloudinary.config({
                              cloud_name: process.env.CLOUDINARY_NAME,
                              api_key: process.env.CLOUDINARY_KEY,
                              api_secret: process.env.CLOUDINARY_SECRET,
                            });
                            const publicId = mediaObj?.provider_metadata?.public_id || null;
                            const resourceType = mediaObj?.provider_metadata?.resource_type || 'image';
                            if (publicId) {
                              const resMeta = await cloudinary.api.resource(publicId, { resource_type: resourceType });
                              const altUrl = resMeta?.secure_url || resMeta?.url;
                              if (altUrl && /^https?:\/\//i.test(altUrl)) {
                                buffer = await fetchBufferFromUrl(String(altUrl).trim());
                              }
                            }
                          } catch (fallbackErr) {
                            // No pudimos recuperar el binario
                            buffer = null;
                          }
                        }
                      }

                      if (!buffer) {
                        summary.media.errors[uid]++;
                        return null;
                      }

                      const name = mediaObj?.name || `${mediaObj?.hash || 'file'}${mediaObj?.ext || ''}`;
                      const type = mediaObj?.mime || 'application/octet-stream';
                      const size = buffer.length;

                      // Subir y persistir via servicio upload
                      const uploaded = await uploadService.uploadFileAndPersist({
                        data: {
                          alternativeText: mediaObj?.alternativeText || undefined,
                          caption: mediaObj?.caption || undefined,
                          folder: mediaObj?.folder?.id || undefined,
                        },
                        file: { name, type, size, buffer },
                      });

                      mediaIdMap.set(oldFileId, uploaded.id);
                      summary.media.created[uid]++;
                      return uploaded.id;
                    } catch (err) {
                      summary.media.errors[uid]++;
                      return null;
                    }
                  };

                  if (Array.isArray(val)) {
                    const mapped: number[] = [];
                    for (const mediaObj of val) {
                      const newFileId = await mapOne(mediaObj);
                      if (newFileId) mapped.push(newFileId);
                    }
                    patch[fieldName] = mapped;
                  } else {
                    const newFileId = await mapOne(val);
                    patch[fieldName] = newFileId;
                  }
                }

                // Aplicar parche de media
                if (!dryRun) {
                  await strapi.entityService.update(uid as any, newItemId, { data: patch, transacting: trx } as any);
                }
                summary.media.patched[uid]++;
              }
            }
          }

          if (!dryRun && trx) await trx.commit();

          ctx.body = {
            data: { dryRun, mode, restoreMedia, summary },
            message: dryRun
              ? 'Dry-run de restauración completado (no se realizaron cambios)'
              : 'Restauración JSON completada de forma segura (merge)'
          };
        } catch (e: any) {
          if (!dryRun && trx) await trx.rollback();
          strapi.log.error(`Fallo en restauración JSON segura: ${e?.message}`);
          ctx.badRequest('Error en restauración JSON segura', { error: e?.message });
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
