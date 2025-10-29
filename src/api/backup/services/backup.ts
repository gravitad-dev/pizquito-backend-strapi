/**
 * backup service (tar.gz nativo)
 */

import { factories } from '@strapi/strapi';
import path from 'path';
import fse from 'fs-extra';
import { promises as fsp, createReadStream, existsSync } from 'fs';
import crypto from 'crypto';
import * as tar from 'tar';
import { syncBackupsIndex } from '../../../utils/backup-sync';
import { getEntryByDocumentId, deleteEntryByDocumentId } from '../../../utils/document-id';
import ExcelJS from 'exceljs';

function tsString(d = new Date()) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

async function ensureDir(dir: string) {
  await fse.mkdirp(dir);
}

function sha256File(buffer: Buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function safeUidFileName(uid: string) {
  return uid.replace(/[:]/g, '__');
}

// Proponer nombres legibles de hoja para Excel a partir del UID y el displayName del CT
function proposeSheetName(uid: string, ct: any | undefined, used: Set<string>) {
  // Priorizar displayName del schema si existe
  let base = (ct?.info?.displayName as string) || (uid.split('.').pop() || uid.replace(/^api::/, ''));
  // Saneado de caracteres no permitidos por Excel
  base = base.replace(/[\\\/:\?\*\[\]]/g, '').trim();
  // Evitar nombres protegidos por Excel (p.ej., "History")
  const reserved = new Set<string>(['history']);
  if (reserved.has(base.toLowerCase())) {
    base = base.toLowerCase() === 'history' ? 'Historial' : `${base}_`;
  }
  // Reservar espacio para sufijos si hay duplicados (límite Excel: 31)
  if (base.length > 28) base = base.slice(0, 28);
  let name = base || 'Hoja';
  let idx = 1;
  while (used.has(name)) {
    const suffix = ` (${idx})`;
    const limit = 31 - suffix.length;
    name = base.slice(0, Math.max(0, limit)) + suffix;
    idx++;
  }
  used.add(name);
  return name;
}

// Añade una hoja asegurando un nombre válido, evitando errores por nombres protegidos/duplicados
function addWorksheetSafe(workbook: ExcelJS.Workbook, desiredName: string, used: Set<string>) {
  // Saneado básico
  let name = (desiredName || 'Hoja').replace(/[\/:\?\*\[\]]/g, '').trim();
  if (!name) name = 'Hoja';
  if (name.length > 31) name = name.slice(0, 31);

  const base = name.length > 28 ? name.slice(0, 28) : name;
  let idx = 1;
  while (used.has(name)) {
    const suffix = ` (${idx})`;
    const limit = 31 - suffix.length;
    name = base.slice(0, Math.max(0, limit)) + suffix;
    idx++;
  }

  // Intentos de recuperación si la librería rechaza el nombre
  const variants = [name, `${base}_`, `${base}-1`, `${base} hoja`, `${base} alt`];
  for (const variant of variants) {
    const n = variant.length > 31 ? variant.slice(0, 31) : variant;
    try {
      const ws = workbook.addWorksheet(n);
      used.add(n);
      return ws;
    } catch {}
  }

  // Último recurso
  const fallback = `Hoja_${tsString()}`.slice(0, 31);
  const ws = workbook.addWorksheet(fallback);
  used.add(fallback);
  return ws;
}

export default factories.createCoreService('api::backup.backup', ({ strapi }) => ({
  /**
   * Crear backup en formato tar.gz
   * - Exporta data de todos los collection types api::* excepto api::backup.backup
   * - Copia assets de public/uploads
   * - Genera manifest.json con metadatos y checksums
   */
  async createTarGzBackup(description?: string) {
    const backupsDir = path.resolve(process.cwd(), 'backups');
    await ensureDir(backupsDir);

    const tmpDir = path.resolve(process.cwd(), 'tmp', `backup_${tsString()}`);
    const dataDir = path.join(tmpDir, 'data');
    const assetsDir = path.join(tmpDir, 'assets');
    const uploadsDir = path.join(assetsDir, 'uploads');
    await ensureDir(dataDir);
    await ensureDir(uploadsDir);

    const uids = Object.keys(strapi.contentTypes || {})
      .filter((uid) => {
        const ct: any = (strapi.contentTypes as any)[uid];
        return ct && ct.kind === 'collectionType' && uid.startsWith('api::') && uid !== 'api::backup.backup';
      });

    const manifest: any = {
      type: 'strapi-backup',
      version: '1.0',
      createdAt: new Date().toISOString(),
      database: {
        client: process.env.DATABASE_CLIENT || 'sqlite',
      },
      contentTypes: [],
      files: {
        data: {},
        assets: [],
      },
    };

    // Exportar data en JSON por UID
    for (const uid of uids) {
      const items = await strapi.entityService.findMany(uid as any, { populate: '*' });
      const fileName = `${safeUidFileName(uid)}.json`;
      await fsp.writeFile(path.join(dataDir, fileName), JSON.stringify(items, null, 2), 'utf-8');
      manifest.contentTypes.push(uid);
      manifest.files.data[uid] = `data/${fileName}`;
    }

    // Copiar assets (uploads)
    const publicUploads = path.resolve(process.cwd(), 'public', 'uploads');
    if (existsSync(publicUploads)) {
      await fse.copy(publicUploads, uploadsDir, { overwrite: true, errorOnExist: false });
      // Registrar archivos relativos (no recursivo profundo, pero suficiente como marca)
      const entries = await fse.readdir(uploadsDir);
      manifest.files.assets = entries.map((e) => `assets/uploads/${e}`);
    }

    // Guardar manifest
    const manifestPath = path.join(tmpDir, 'manifest.json');
    await fsp.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

    // Crear tar.gz
    const ts = tsString();
    const filename = `backup_${ts}.tar.gz`;
    const destPath = path.join(backupsDir, filename);
    await tar.c({ gzip: true, file: destPath, cwd: tmpDir }, ['manifest.json', 'data', 'assets']);

    // Calcular tamaños y checksum
    const stat = await fsp.stat(destPath);
    const buf = await fsp.readFile(destPath);
    const checksum = sha256File(buf);

    // Crear registro de backup (documentId se genera por Strapi)
    const created = await strapi.entityService.create('api::backup.backup', {
      data: {
        filename,
        originalSize: stat.size,
        compressedSize: stat.size,
        checksum,
        statusBackup: 'completed',
        backupType: 'manual',
        description: description || 'Backup completo tar.gz',
        metadata: { ...manifest },
        filePath: destPath,
      },
    });

    // Limpieza tmp
    try { await fse.remove(tmpDir); } catch {}

    return created;
  },

  /**
   * Descargar backup por documentId (stream)
   */
  async streamDownloadByDocumentId(documentId: string, ctx: any) {
    const backup = await getEntryByDocumentId(strapi as any, 'api::backup.backup', documentId);
    if (!backup) return ctx.notFound('Backup no encontrado');
    const filePath: string | undefined = (backup as any).filePath;
    if (!filePath || !existsSync(filePath)) return ctx.notFound('Archivo de backup no encontrado');

    const filename = (backup as any).filename || path.basename(filePath);
    ctx.set('Content-Type', 'application/gzip');
    ctx.set('Content-Disposition', `attachment; filename="${filename}"`);
    ctx.body = createReadStream(filePath);
  },

  /**
   * Eliminar backup por documentId
   */
  async deleteByDocumentId(documentId: string) {
    const backup = await getEntryByDocumentId(strapi as any, 'api::backup.backup', documentId);
    if (!backup) throw new Error('Backup no encontrado');
    const filePath: string | undefined = (backup as any).filePath;
    if (filePath && existsSync(filePath)) {
      try { await fsp.unlink(filePath); } catch {}
    }
    await deleteEntryByDocumentId(strapi as any, 'api::backup.backup', documentId);
    return { ok: true };
  },

  /**
   * Restaurar desde tar.gz por documentId
   * No modifica NUNCA la tabla ni entries del CT backup
   */
  async restoreFromTarGzByDocumentId(
    documentId: string,
    opts: { preserveBackupsTable?: boolean; pruneMissing?: boolean; pruneUids?: string[] } = {}
  ) {
    const backup = await getEntryByDocumentId(strapi as any, 'api::backup.backup', documentId);
    if (!backup) throw new Error('Backup no encontrado');
    const filePath: string | undefined = (backup as any).filePath;
    if (!filePath || !existsSync(filePath)) throw new Error('Archivo de backup no encontrado');
    return await (this as any).restoreFromTarGzFile(filePath, opts);
  },

  /**
   * Restaurar desde upload .tar.gz (sin crear/modificar ningún registro de backups)
   */
  async restoreFromUploadTarGz(
    file: any,
    opts: { preserveBackupsTable?: boolean; pruneMissing?: boolean; pruneUids?: string[] } = {}
  ) {
    const backupsDir = path.resolve(process.cwd(), 'backups');
    await ensureDir(backupsDir);
    const filename = `upload_restore_${tsString()}.tar.gz`;
    const destPath = path.join(backupsDir, filename);

    // Mover/guardar el archivo temporal recibido (según provider de bodyparser)
    const inputPath: string = file?.path || file?.filepath || file?.tempFilePath;
    if (!inputPath || !existsSync(inputPath)) throw new Error('Archivo de upload no disponible');
    await fse.copy(inputPath, destPath);
    const summary = await (this as any).restoreFromTarGzFile(destPath, opts);
    // Limpieza del archivo subido (opcional conservar)
    try { await fsp.unlink(destPath); } catch {}
    return summary;
  },

  /**
   * Lógica común de restore desde un archivo tar.gz
   * Importa data de todos los UIDs excepto api::backup.backup y copia assets
   */
  async restoreFromTarGzFile(
    filePath: string,
    opts: { preserveBackupsTable?: boolean; pruneMissing?: boolean; pruneUids?: string[] } = {}
  ) {
    const tmpDir = path.resolve(process.cwd(), 'tmp', `restore_${tsString()}`);
    await ensureDir(tmpDir);

    // Extraer tar.gz
    await tar.x({ file: filePath, cwd: tmpDir });

    // Leer manifest
    const manifestPath = path.join(tmpDir, 'manifest.json');
    const manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf-8'));

    const dataDir = path.join(tmpDir, 'data');
    const assetsUploadsDir = path.join(tmpDir, 'assets', 'uploads');

    let imported = 0;
    let updated = 0;
    let pruned = 0;
    const skippedUids: string[] = [];

    // Mapa: UID -> { documentId -> id }
    const idByDoc: Record<string, Record<string, number>> = {};
    // Relación pendiente para segunda pasada
    type PendingRel = { sourceUid: string; sourceDocId: string; key: string; targetUid: string; relatedDocIds: string[] };
    const pendingRelations: PendingRel[] = [];

    // Mantener set de documentIds presentes en el backup por UID
    const backupDocIdsByUid: Record<string, Set<string>> = {};

    // Primera pasada: crear/actualizar registros sin relaciones
    for (const uid of manifest.contentTypes as string[]) {
      if (uid === 'api::backup.backup') { skippedUids.push(uid); continue; }
      const fileRel = manifest.files?.data?.[uid];
      const fileAbs = path.join(tmpDir, fileRel || path.join('data', `${safeUidFileName(uid)}.json`));
      if (!existsSync(fileAbs)) continue;
      const items = JSON.parse(await fsp.readFile(fileAbs, 'utf-8'));
      if (!Array.isArray(items)) continue;

      const ct: any = (strapi.contentTypes as any)[uid] || {};
      const attributes: Record<string, any> = ct.attributes || {};
      const relationKeys = Object.keys(attributes).filter((k) => (attributes[k] || {}).type === 'relation');

      idByDoc[uid] = idByDoc[uid] || {};
      backupDocIdsByUid[uid] = backupDocIdsByUid[uid] || new Set<string>();

      for (const it of items) {
        const documentId = it?.documentId;
        if (!documentId) continue;
        backupDocIdsByUid[uid].add(documentId);

        // Separar datos simples vs relaciones
        const { id, createdAt, updatedAt, publishedAt, ...raw } = it as any;
        const data: any = { ...raw };
        // Quitar relaciones del data para evitar errores de FK en la creación
        for (const rk of relationKeys) delete data[rk];

        const existing = await (strapi.db as any).query(uid).findOne({ where: { documentId }, select: ['id', 'documentId'] });
        let savedId: number | undefined = existing?.id;
        if (existing?.id) {
          await (strapi.db as any).query(uid).update({ where: { documentId }, data });
          updated++;
        } else {
          const created = await strapi.entityService.create(uid as any, { data });
          savedId = (created as any)?.id;
          imported++;
        }
        if (!savedId) {
          // obtener id después de create/update si no estuvo disponible
          const ref = await (strapi.db as any).query(uid).findOne({ where: { documentId }, select: ['id'] });
          savedId = ref?.id;
        }
        if (savedId) idByDoc[uid][documentId] = savedId;

        // Registrar relaciones pendientes (por documentId) para segunda pasada
        for (const rk of relationKeys) {
          const attr = attributes[rk] || {};
          const targetUid: string | undefined = attr.target;
          if (!targetUid) continue;
          const value = (it as any)[rk];
          if (!value) continue;

          const extractDocIds = (v: any): string[] => {
            if (Array.isArray(v)) return v.map((x) => (x?.documentId || x?.id || x)).filter(Boolean);
            if (typeof v === 'object') return [v?.documentId].filter(Boolean) as string[];
            if (typeof v === 'string') return [v];
            return [];
          };
          const relatedDocIds = extractDocIds(value);
          if (relatedDocIds.length) {
            pendingRelations.push({ sourceUid: uid, sourceDocId: documentId, key: rk, targetUid, relatedDocIds });
          }
        }
      }
    }

    // Segunda pasada: establecer relaciones ya con todas las IDs disponibles
    for (const rel of pendingRelations) {
      const sourceId = idByDoc[rel.sourceUid]?.[rel.sourceDocId];
      if (!sourceId) continue;

      // Resolver IDs de destino desde el mapa o consultando DB
      const targetIds: number[] = [];
      for (const docId of rel.relatedDocIds) {
        const known = idByDoc[rel.targetUid]?.[docId];
        if (known) { targetIds.push(known); continue; }
        const ref = await (strapi.db as any).query(rel.targetUid).findOne({ where: { documentId: docId }, select: ['id'] });
        if (ref?.id) targetIds.push(ref.id);
      }
      if (!targetIds.length) continue;

      // Determinar cardinalidad
      const ct: any = (strapi.contentTypes as any)[rel.sourceUid] || {};
      const attr = ct.attributes?.[rel.key] || {};
      const relation = attr.relation || '';
      const isMany = relation.includes('many');

      const data: any = {};
      data[rel.key] = isMany ? targetIds : targetIds[0];
      try {
        await strapi.entityService.update(rel.sourceUid as any, sourceId, { data });
      } catch (e) {
        // Intento alternativo usando formato connect
        const connectData: any = {};
        connectData[rel.key] = { connect: targetIds.map((id) => ({ id })) };
        try { await strapi.entityService.update(rel.sourceUid as any, sourceId, { data: connectData }); } catch {}
      }
    }

    // Opcional: eliminar registros que NO están en el backup (prune)
    if (opts?.pruneMissing) {
      const targetUids: string[] = Array.isArray(opts.pruneUids) && opts.pruneUids.length
        ? opts.pruneUids
        : (manifest.contentTypes as string[]).filter((u: string) => u !== 'api::backup.backup');

      for (const uid of targetUids) {
        try {
          const existing: Array<{ id: number; documentId: string }>
            = await (strapi.db as any).query(uid).findMany({ select: ['id', 'documentId'] });
          const allowedSet = backupDocIdsByUid[uid] || new Set<string>();
          for (const row of existing) {
            if (!row?.documentId) continue;
            if (!allowedSet.has(row.documentId)) {
              try {
                await strapi.entityService.delete(uid as any, row.id);
                pruned++;
              } catch (e: any) {
                strapi.log?.warn?.(`No se pudo eliminar ${uid} id=${row.id} docId=${row.documentId}: ${e?.message || e}`);
              }
            }
          }
        } catch (e: any) {
          strapi.log?.warn?.(`Fallo al obtener existentes para ${uid}: ${e?.message || e}`);
        }
      }
    }

    // Copiar assets a public/uploads
    const publicUploads = path.resolve(process.cwd(), 'public', 'uploads');
    if (existsSync(assetsUploadsDir)) {
      await ensureDir(publicUploads);
      await fse.copy(assetsUploadsDir, publicUploads, { overwrite: true });
    }

    // Limpieza tmp
    try { await fse.remove(tmpDir); } catch {}

    return { imported, updated, pruned, skippedUids };
  },

  /**
   * Exportar XLSX desde un backup .tar.gz por documentId
   */
  async exportXlsxFromTarGzByDocumentId(documentId: string, limit?: number) {
    const backup = await getEntryByDocumentId(strapi as any, 'api::backup.backup', documentId);
    if (!backup) throw new Error('Backup no encontrado');
    const filePath: string | undefined = (backup as any).filePath;
    if (!filePath || !existsSync(filePath)) throw new Error('Archivo de backup no encontrado');

    const tmpDir = path.resolve(process.cwd(), 'tmp', `export_xlsx_${tsString()}`);
    await ensureDir(tmpDir);
    await tar.x({ file: filePath, cwd: tmpDir });

    const manifestPath = path.join(tmpDir, 'manifest.json');
    const manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf-8'));
    const dataDir = path.join(tmpDir, 'data');

    const workbook = new ExcelJS.Workbook();
    const usedNames = new Set<string>();
    const summarySheet = addWorksheetSafe(workbook, 'Resumen', usedNames);
    summarySheet.columns = [
      { header: 'Tabla', key: 'tabla', width: 32 },
      { header: 'UID', key: 'uid', width: 40 },
      { header: 'Hoja', key: 'hoja', width: 32 },
      { header: 'Cantidad', key: 'cantidad', width: 12 },
      { header: 'Columnas', key: 'columnas', width: 60 },
    ];

    for (const uid of (manifest.contentTypes || [])) {
      if (uid === 'api::backup.backup') continue;
      const fileRel = manifest.files?.data?.[uid] || `data/${safeUidFileName(uid)}.json`;
      const fileAbs = path.join(tmpDir, fileRel);
      if (!existsSync(fileAbs)) continue;
      const items = JSON.parse(await fsp.readFile(fileAbs, 'utf-8'));
      if (!Array.isArray(items)) continue;

      // Columnas: base + todas las de texto detectadas (sin límite)
      const sample = items.find((x: any) => !!x) || {};
      const keys = Object.keys(sample);
      const baseCols = ['id', 'documentId', 'createdAt', 'updatedAt', 'publishedAt'];
      const textKeys = keys.filter((k) => typeof sample[k] === 'string' && !baseCols.includes(k));
      const columns = [...baseCols, ...textKeys];

      const ct = (strapi.contentTypes as any)[uid];
      const sheetName = proposeSheetName(uid, ct, usedNames);
      const ws = addWorksheetSafe(workbook, sheetName, usedNames);
      ws.columns = columns.map((c) => ({ header: c, key: c, width: Math.max(14, c.length + 2) }));
      const rowLimit = typeof limit === 'number' && limit > 0 ? limit : undefined;
      let added = 0;
      for (const it of items) {
        if (rowLimit && added >= rowLimit) break;
        const row: any = {};
        for (const c of columns) row[c] = (it as any)[c];
        ws.addRow(row);
        added++;
      }
      summarySheet.addRow({ tabla: sheetName, uid, hoja: sheetName, cantidad: items.length, columnas: columns.join(', ') });
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const filename = `backup_${(backup as any).filename?.replace(/\.tar\.gz$/, '') || tsString()}_data.xlsx`;
    // Limpieza tmp
    try { await fse.remove(tmpDir); } catch {}
    return { filename, buffer };
  },

  /**
   * Exportar JSON consolidado desde un backup .tar.gz por documentId
   */
  async exportJsonFromTarGzByDocumentId(documentId: string) {
    const backup = await getEntryByDocumentId(strapi as any, 'api::backup.backup', documentId);
    if (!backup) throw new Error('Backup no encontrado');
    const filePath: string | undefined = (backup as any).filePath;
    if (!filePath || !existsSync(filePath)) throw new Error('Archivo de backup no encontrado');

    const tmpDir = path.resolve(process.cwd(), 'tmp', `export_json_${tsString()}`);
    await ensureDir(tmpDir);
    await tar.x({ file: filePath, cwd: tmpDir });

    const manifestPath = path.join(tmpDir, 'manifest.json');
    const manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf-8'));

    const output: any = {
      type: 'strapi-backup-json',
      createdAt: new Date().toISOString(),
      sourceBackup: (backup as any).filename,
      manifest: { ...manifest },
      data: {},
    };

    for (const uid of (manifest.contentTypes || [])) {
      if (uid === 'api::backup.backup') continue;
      const fileRel = manifest.files?.data?.[uid] || `data/${safeUidFileName(uid)}.json`;
      const fileAbs = path.join(tmpDir, fileRel);
      if (!existsSync(fileAbs)) continue;
      const items = JSON.parse(await fsp.readFile(fileAbs, 'utf-8'));
      if (!Array.isArray(items)) continue;
      output.data[uid] = items;
    }

    const jsonStr = JSON.stringify(output, null, 2);
    const buffer = Buffer.from(jsonStr, 'utf-8');
    const filename = `backup_${(backup as any).filename?.replace(/\.tar\.gz$/, '') || tsString()}_data.json`;
    try { await fse.remove(tmpDir); } catch {}
    return { filename, buffer };
  },

  /**
   * Exportar resumen en XLSX desde la BD actual.
   * - Hoja "Summary" con conteos por content-type y columnas incluidas
   * - Una hoja por cada CT con muestras de campos de texto y documentId
   */
  async exportXlsx(limit?: number) {
    const workbook = new ExcelJS.Workbook();
    const usedNames = new Set<string>();
    const summarySheet = addWorksheetSafe(workbook, 'Resumen', usedNames);
    summarySheet.columns = [
      { header: 'Tabla', key: 'tabla', width: 32 },
      { header: 'UID', key: 'uid', width: 40 },
      { header: 'Hoja', key: 'hoja', width: 32 },
      { header: 'Cantidad', key: 'cantidad', width: 12 },
      { header: 'Columnas', key: 'columnas', width: 60 },
    ];

    const uids = Object.keys(strapi.contentTypes || {})
      .filter((uid) => {
        const ct: any = (strapi.contentTypes as any)[uid];
        return ct && ct.kind === 'collectionType' && uid.startsWith('api::') && uid !== 'api::backup.backup';
      });

    for (const uid of uids) {
      const ct: any = (strapi.contentTypes as any)[uid] || {};
      const attributes: Record<string, any> = ct.attributes || {};
      const textFieldKeys = Object.keys(attributes)
        .filter((key) => ['string', 'text', 'richtext', 'email'].includes((attributes[key] || {}).type));

      const baseCols = ['id', 'documentId', 'createdAt', 'updatedAt', 'publishedAt'];
      const columns = [...baseCols, ...textFieldKeys];
      const sheetName = proposeSheetName(uid, ct, usedNames);
      const ws = addWorksheetSafe(workbook, sheetName, usedNames);
      ws.columns = columns.map((c) => ({ header: c, key: c, width: Math.max(14, c.length + 2) }));

      const rowLimit = typeof limit === 'number' && limit > 0 ? limit : 1000;
      const rows = await (strapi.db as any).query(uid).findMany({ select: columns, limit: rowLimit });
      for (const row of rows) {
        const r: any = {};
        for (const c of columns) r[c] = (row as any)[c];
        ws.addRow(r);
      }

      let count = 0;
      try {
        count = await (strapi.db as any).query(uid).count();
      } catch {}

      summarySheet.addRow({ tabla: sheetName, uid, hoja: sheetName, cantidad: count, columnas: columns.join(', ') });
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const filename = `backup_summary_${tsString()}.xlsx`;
    return { filename, buffer };
  },

  /**
   * Sincronizar índice de backups (detecta huérfanos y registrados)
   */
  async syncBackups() {
    const result = await syncBackupsIndex(strapi as any, { removeOrphanFiles: false });
    return result;
  },
}));
