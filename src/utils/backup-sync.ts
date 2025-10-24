import path from 'path';
import { promises as fsp, existsSync } from 'fs';

function fnv1aHex(buffer: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < buffer.length; i++) {
    hash ^= buffer[i];
    hash = (hash + (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)) >>> 0;
  }
  return ('0000000' + hash.toString(16)).slice(-8);
}

async function computeChecksum(filePath: string) {
  try {
    const buf = await fsp.readFile(filePath);
    return fnv1aHex(buf as unknown as Uint8Array);
  } catch {
    return null;
  }
}

export async function syncBackupsIndex(strapi: any, options: { markMissingAsCorrupted?: boolean; removeOrphanFiles?: boolean } = {}) {
  const { markMissingAsCorrupted = true, removeOrphanFiles = false } = options;
  const backupsDir = path.resolve(process.cwd(), 'backups');

  // Asegurar directorio de backups
  try {
    await fsp.mkdir(backupsDir, { recursive: true });
  } catch {}

  // Leer archivos físicos
  const entries = await fsp.readdir(backupsDir);
  const files = entries
    .filter((name) => name && name !== '.gitkeep')
    .map((name) => ({ name, full: path.join(backupsDir, name), ext: path.extname(name).toLowerCase() }));

  const scannedFiles = files.map((f) => f.full);

  // Cargar registros existentes
  const existingBackups: any[] = await strapi.entityService.findMany('api::backup.backup', {
    fields: ['id', 'filename', 'filePath', 'checksum', 'statusBackup', 'originalSize'],
    pagination: { page: 1, pageSize: 1000 },
  });

  const byPath = new Map<string, any>();
  for (const b of existingBackups) {
    if ((b as any).filePath) byPath.set((b as any).filePath, b);
  }

  let created = 0;
  let existingSkips = 0;
  let corruptedMarked = 0;
  let updated = 0;
  let orphanFilesRemoved = 0;

  // Crear registros faltantes para archivos del filesystem
  for (const file of files) {
    const already = byPath.get(file.full);
    if (already) {
      existingSkips++;
      // Opcionalmente actualizar tamaño/checksum si faltan
      if (!(already as any).originalSize || !(already as any).checksum) {
        try {
          const stat = await fsp.stat(file.full);
          const checksum = await computeChecksum(file.full);
          await strapi.entityService.update('api::backup.backup', (already as any).id, {
            data: { originalSize: stat.size, checksum },
          });
          updated++;
        } catch {}
      }
      continue;
    }

    // Crear entrada para archivo nuevo
    try {
      const stat = await fsp.stat(file.full);
      const checksum = await computeChecksum(file.full);
      const backupType = 'other';
      const statusBackup = 'completed';
      const description = 'Sincronizado desde filesystem';
      const metadata = { syncedAt: new Date().toISOString() };

      await strapi.entityService.create('api::backup.backup', {
        data: {
          filename: file.name,
          originalSize: stat.size,
          compressedSize: null,
          checksum,
          statusBackup,
          backupType,
          description,
          metadata,
          filePath: file.full,
        },
      });
      created++;
    } catch (e: any) {
      strapi.log.warn(`No se pudo crear entrada para ${file.name}: ${e?.message}`);
    }
  }

  // Marcar entradas existentes cuyo archivo físico falte
  if (markMissingAsCorrupted) {
    for (const b of existingBackups) {
      const p = (b as any).filePath;
      if (!p) continue;
      if (!existsSync(p)) {
        try {
          if ((b as any).statusBackup !== 'corrupted') {
            await strapi.entityService.update('api::backup.backup', (b as any).id, {
              data: {
                statusBackup: 'corrupted',
                description: 'Archivo físico faltante (marcado por sync)',
              },
            });
            corruptedMarked++;
          }
        } catch {}
      }
    }
  }

  // Eliminar archivos físicos huérfanos (si está habilitado)
  if (removeOrphanFiles) {
    for (const file of files) {
      const filePath = file.full;
      const existingBackup = existingBackups.find((b: any) => b.filename === file.name);
      
      if (!existingBackup) {
        try {
          await fsp.unlink(filePath);
          orphanFilesRemoved++;
          strapi.log.info(`Archivo huérfano eliminado: ${file.name}`);
        } catch (error: any) {
          strapi.log.warn(`No se pudo eliminar archivo huérfano ${file.name}: ${error?.message}`);
        }
      }
    }
  }

  return {
    created,
    updated,
    corruptedMarked,
    existingSkips,
    orphanFilesRemoved,
    totalFiles: files.length,
    scannedFiles,
  };
}