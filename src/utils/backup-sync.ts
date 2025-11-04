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

export async function syncBackupsIndex(strapi: any, options: { removeOrphanFiles?: boolean } = {}) {
  const { removeOrphanFiles = false } = options;
  const backupsDir = path.resolve(process.cwd(), 'backups');

  // Asegurar directorio de backups
  try {
    await fsp.mkdir(backupsDir, { recursive: true });
  } catch {}

  // 1. Obtener todos los backups registrados en la BD
  const registeredBackups = (await strapi.entityService.findMany('api::backup.backup', {
    fields: ['id', 'filename', 'filePath'],
    pagination: { page: 1, pageSize: 1000 },
  })) as any[];

  // 2. Leer archivos físicos en la carpeta backups
  const entries = await fsp.readdir(backupsDir);
  const physicalFiles = entries.filter((name) => name && name !== '.gitkeep');

  // 3. Crear un Set con los nombres de archivos que SÍ están en la BD
  const registeredFilenames = new Set<string>();
  for (const backup of registeredBackups) {
    if (backup.filename) {
      registeredFilenames.add(backup.filename);
    }
  }

  let orphanFilesRemoved = 0;
  let orphanFilesFound = 0;

  // 4. Revisar cada archivo físico
  for (const filename of physicalFiles) {
    const filePath = path.join(backupsDir, filename);
    
    // Si el archivo NO está registrado en la BD, es huérfano
    if (!registeredFilenames.has(filename)) {
      orphanFilesFound++;
      
      if (removeOrphanFiles) {
        try {
          await fsp.unlink(filePath);
          orphanFilesRemoved++;
          strapi.log.info(`Archivo huérfano eliminado: ${filename}`);
        } catch (error: any) {
          strapi.log.warn(`No se pudo eliminar archivo huérfano ${filename}: ${error?.message}`);
        }
      } else {
        strapi.log.info(`Archivo huérfano encontrado (no eliminado): ${filename}`);
      }
    }
  }

  return {
    registeredBackups: registeredBackups.length,
    physicalFiles: physicalFiles.length,
    orphanFilesFound,
    orphanFilesRemoved,
    message: removeOrphanFiles 
      ? `Eliminados ${orphanFilesRemoved} de ${orphanFilesFound} archivos huérfanos`
      : `Encontrados ${orphanFilesFound} archivos huérfanos (no eliminados)`
  };
}