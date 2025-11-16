/**
 * backup service (tar.gz nativo)
 */

import { factories } from "@strapi/strapi";
import path from "path";
import fse from "fs-extra";
import { promises as fsp, createReadStream, existsSync } from "fs";
import crypto from "crypto";
import * as tar from "tar";
import { spawn } from "child_process";
import { syncBackupsIndex } from "../../../utils/backup-sync";
import {
  getEntryByDocumentId,
  deleteEntryByDocumentId,
} from "../../../utils/document-id";
import ExcelJS from "exceljs";
const cloudinary = require("cloudinary").v2;

function tsString(d = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

async function ensureDir(dir: string) {
  await fse.mkdirp(dir);
}

// Devuelve el nombre del atributo en el target que actúa como lado propietario
// para establecer la relación (p.ej. en oneToMany, el owner suele ser el manyToOne del target)
function findTargetOwningField(
  strapi: any,
  targetUid: string,
  sourceUid: string,
  hintedKey?: string,
): string | undefined {
  // Si nos dieron una pista (inversedBy) úsala primero
  if (hintedKey) return hintedKey;
  const tct: any = (strapi.contentTypes as any)[targetUid] || {};
  const tAttrs: Record<string, any> = tct.attributes || {};
  for (const [k, a] of Object.entries(tAttrs)) {
    const rel = (a as any)?.relation || "";
    const tgt = (a as any)?.target;
    if ((a as any)?.type === "relation" && tgt === sourceUid) {
      // Preferir claves en el target que sean manyToOne / oneToOne (lado con FK)
      if (rel === "manyToOne" || rel === "oneToOne") return k;
      // Para manyToMany, cualquiera de los lados puede funcionar (se retorna el primero)
      if (rel === "manyToMany") return k;
    }
  }
  return undefined;
}

function sha256File(buffer: Buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function safeUidFileName(uid: string) {
  return uid.replace(/[:]/g, "__");
}

// Proponer nombres legibles de hoja para Excel a partir del UID y el displayName del CT
function proposeSheetName(uid: string, ct: any | undefined, used: Set<string>) {
  // Priorizar displayName del schema si existe
  let base =
    (ct?.info?.displayName as string) ||
    uid.split(".").pop() ||
    uid.replace(/^api::/, "");
  // Saneado de caracteres no permitidos por Excel
  base = base.replace(/[\\\/:\?\*\[\]]/g, "").trim();
  // Evitar nombres protegidos por Excel (p.ej., "History")
  const reserved = new Set<string>(["history"]);
  if (reserved.has(base.toLowerCase())) {
    base = base.toLowerCase() === "history" ? "Historial" : `${base}_`;
  }
  // Reservar espacio para sufijos si hay duplicados (límite Excel: 31)
  if (base.length > 28) base = base.slice(0, 28);
  let name = base || "Hoja";
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
function addWorksheetSafe(
  workbook: ExcelJS.Workbook,
  desiredName: string,
  used: Set<string>,
) {
  // Saneado básico
  let name = (desiredName || "Hoja").replace(/[\/:\?\*\[\]]/g, "").trim();
  if (!name) name = "Hoja";
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
  const variants = [
    name,
    `${base}_`,
    `${base}-1`,
    `${base} hoja`,
    `${base} alt`,
  ];
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

// Recolectar conteos por content-type (collectionType) de la BD actual
async function collectContentTypeCounts(strapi: any) {
  const result: { uid: string; count: number }[] = [];
  const uids = Object.keys(strapi.contentTypes || {}).filter((uid) => {
    const ct: any = (strapi.contentTypes as any)[uid];
    return (
      ct && ct.kind === "collectionType" && uid.startsWith("api::") && uid !== "api::backup.backup"
    );
  });
  for (const uid of uids) {
    let count = -1;
    try {
      count = await (strapi.db as any).query(uid).count();
    } catch {}
    result.push({ uid, count });
  }
  return result;
}

// Configuración de Postgres y utilidades para ejecutar pg_dump/pg_restore
function pgConfig() {
  const client = process.env.DATABASE_CLIENT || "sqlite";
  if (client !== "postgres") {
    throw new Error(
      "El motor actual no es Postgres. pg_dump/pg_restore solo disponibles para Postgres.",
    );
  }
  const url = process.env.DATABASE_URL;
  const host = process.env.DATABASE_HOST || "localhost";
  const port = Number(process.env.DATABASE_PORT || 5432);
  const database = process.env.DATABASE_NAME || "postgres";
  const user = process.env.DATABASE_USERNAME || "postgres";
  const password = process.env.DATABASE_PASSWORD || "";
  const schema = process.env.DATABASE_SCHEMA || "public";
  return { url, host, port, database, user, password, schema };
}

function pgBins() {
  const dump = process.env.PG_DUMP_PATH || "pg_dump";
  const restore = process.env.PG_RESTORE_PATH || "pg_restore";
  return { dump, restore };
}

async function spawnAsync(cmd: string, args: string[], env: Record<string, string | undefined> = {}) {
  return await new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(cmd, args, { env: { ...process.env, ...env } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += String(d); });
    child.stderr.on("data", (d) => { stderr += String(d); });
    child.on("close", (code) => resolve({ code: code ?? 0, stdout, stderr }));
  });
}

// Descargar un archivo remoto (http/https) a Buffer sin dependencias externas
async function fetchToBuffer(url: string): Promise<Buffer> {
  const isHttps = url.startsWith("https://");
  const lib = await import(isHttps ? "https" : "http");
  return await new Promise<Buffer>((resolve, reject) => {
    const req = (lib as any).get(url, (res: any) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // seguir redirección simple
        fetchToBuffer(res.headers.location).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} al descargar ${url}`));
        return;
      }
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(Buffer.from(c)));
      res.on("end", () => resolve(Buffer.concat(chunks)));
    });
    req.on("error", (err: any) => reject(err));
  });
}

// Crear entrada en History
async function logHistory(
  strapi: any,
  data: {
    title?: string;
    message?: string;
    trace_id?: string;
    module?: string;
    event_type?: string;
    level?: "INFO" | "WARN" | "ERROR" | "DEBUG";
    status_code?: string;
    duration_ms?: string;
    user_id?: string;
    payload?: any;
  },
) {
  try {
    await strapi.entityService.create("api::history.history", {
      data: {
        ...data,
        timestamp: new Date().toISOString(),
        publishedAt: new Date().toISOString(),
      },
    });
  } catch (e: any) {
    strapi.log.error(`No se pudo registrar History: ${e?.message || e}`);
  }
}

export default factories.createCoreService(
  "api::backup.backup",
  ({ strapi }) => ({
    /**
     * Crear backup en formato tar.gz
     * - Exporta data de todos los collection types api::* excepto api::backup.backup
     * - Copia assets de public/uploads
     * - Genera manifest.json con metadatos y checksums
     */
    async createTarGzBackup(description?: string) {
      const backupsDir = path.resolve(process.cwd(), "backups");
      await ensureDir(backupsDir);

      const tmpDir = path.resolve(process.cwd(), "tmp", `backup_${tsString()}`);
      const dataDir = path.join(tmpDir, "data");
      const assetsDir = path.join(tmpDir, "assets");
      const uploadsDir = path.join(assetsDir, "uploads");
      await ensureDir(dataDir);
      await ensureDir(uploadsDir);

      const uids = Object.keys(strapi.contentTypes || {}).filter((uid) => {
        const ct: any = (strapi.contentTypes as any)[uid];
        return (
          ct &&
          ct.kind === "collectionType" &&
          uid.startsWith("api::") &&
          uid !== "api::backup.backup"
        );
      });

      const manifest: any = {
        type: "strapi-backup",
        version: "1.0",
        createdAt: new Date().toISOString(),
        database: {
          client: process.env.DATABASE_CLIENT || "sqlite",
        },
        contentTypes: [],
        files: {
          data: {},
          assets: [],
        },
      };

      // Exportar data en JSON por UID
      for (const uid of uids) {
        const items = await strapi.entityService.findMany(uid as any, {
          populate: "*",
        });
        const fileName = `${safeUidFileName(uid)}.json`;
        await fsp.writeFile(
          path.join(dataDir, fileName),
          JSON.stringify(items, null, 2),
          "utf-8",
        );
        manifest.contentTypes.push(uid);
        manifest.files.data[uid] = `data/${fileName}`;
      }

      // Copiar assets (uploads)
      const publicUploads = path.resolve(process.cwd(), "public", "uploads");
      if (existsSync(publicUploads)) {
        await fse.copy(publicUploads, uploadsDir, {
          overwrite: true,
          errorOnExist: false,
        });
        // Registrar archivos relativos (no recursivo profundo, pero suficiente como marca)
        const entries = await fse.readdir(uploadsDir);
        manifest.files.assets = entries.map((e) => `assets/uploads/${e}`);
      }

      // Guardar manifest
      const manifestPath = path.join(tmpDir, "manifest.json");
      await fsp.writeFile(
        manifestPath,
        JSON.stringify(manifest, null, 2),
        "utf-8",
      );

      // Crear tar.gz
      const ts = tsString();
      const filename = `backup_${ts}.tar.gz`;
      const destPath = path.join(backupsDir, filename);
      await tar.c({ gzip: true, file: destPath, cwd: tmpDir }, [
        "manifest.json",
        "data",
        "assets",
      ]);

      // Calcular tamaños y checksum
      const stat = await fsp.stat(destPath);
      const buf = await fsp.readFile(destPath);
      const checksum = sha256File(buf);

      // Crear registro de backup (documentId se genera por Strapi)
      const created = await strapi.entityService.create("api::backup.backup", {
        data: {
          filename,
          originalSize: stat.size,
          compressedSize: stat.size,
          checksum,
          statusBackup: "completed",
          backupType: "manual",
          description: description || "Backup completo tar.gz",
          metadata: { ...manifest },
          filePath: destPath,
          // Publicar el backup para que aparezca como Published en el admin
          publishedAt: new Date().toISOString(),
        },
      });

      // Limpieza tmp
      try {
        await fse.remove(tmpDir);
      } catch {}

      return created;
    },

    /**
     * Nuevo flujo: crear backup con pg_dump (.dump)
     */
    async createPgDumpBackup(description?: string) {
      const backupsDir = path.resolve(process.cwd(), "backups");
      await ensureDir(backupsDir);
      const ts = tsString();
      const filename = `backup_${ts}.dump`;
      const destPath = path.join(backupsDir, filename);
      const t0 = Date.now();

      const { host, port, database, user, password, schema } = pgConfig();
      const { dump } = pgBins();
      const args = ["-h", host, "-p", String(port), "-U", user, "-F", "c", "-f", destPath, database, "-n", schema, "--no-owner", "--no-privileges"];
      const res = await spawnAsync(dump, args, { PGPASSWORD: String(password) });
      if (res.code !== 0) {
        strapi.log.error(`pg_dump falló: ${res.stderr}`);
        throw new Error("No se pudo crear el backup con pg_dump");
      }
      // Calcular tamaños y checksum del archivo local generado
      const stat = await fsp.stat(destPath);
      const buf = await fsp.readFile(destPath);
      const checksum = sha256File(buf);

      let filePathToStore = destPath;
      const storage = String(process.env.BACKUP_STORAGE || "local").toLowerCase();
      if (storage === "cloudinary") {
        const folder = process.env.CLOUDINARY_BACKUP_FOLDER || "backups";
        try {
          const uploaded = await cloudinary.uploader.upload(destPath, {
            resource_type: "raw",
            folder,
            public_id: filename.replace(/\.dump$/, ""),
            overwrite: true,
          });
          filePathToStore = uploaded?.secure_url || uploaded?.url || filePathToStore;
          const keepLocal = String(process.env.BACKUP_KEEP_LOCAL || "false").toLowerCase();
          if (!["1", "true", "yes"].includes(keepLocal)) {
            try { await fsp.unlink(destPath); } catch {}
          }
        } catch (e: any) {
          strapi.log.error(`Error subiendo dump a Cloudinary: ${e?.message || e}`);
        }
      }

      const created = await strapi.entityService.create("api::backup.backup", {
        data: {
          filename,
          originalSize: stat.size,
          compressedSize: stat.size,
          checksum,
          statusBackup: "completed",
          backupType: "manual",
          description: description || "Backup Postgres (pg_dump)",
          metadata: { type: "postgres-dump", createdAt: new Date().toISOString(), schema },
          filePath: filePathToStore,
          publishedAt: new Date().toISOString(),
        },
      });

      // History: registrar creación de backup
      try {
        await logHistory(strapi as any, {
          title: "Backup creado",
          message: "Backup PostgreSQL (pg_dump) creado",
          module: "backup",
          event_type: "backup_created",
          level: "INFO",
          status_code: "200",
          duration_ms: String(Date.now() - t0),
          payload: {
            backup_id: created?.id,
            filename,
            filePath: filePathToStore,
            originalSize: stat.size,
            checksum,
            storage: String(process.env.BACKUP_STORAGE || "local").toLowerCase(),
            schema,
          },
        });
      } catch {}

      return created;
    },

    /**
     * Restaurar con pg_restore a partir de documentId
     */
    async restoreFromPgDumpByDocumentId(documentId: string) {
      const t0 = Date.now();
      const backup = await getEntryByDocumentId(strapi as any, "api::backup.backup", documentId);
      if (!backup) throw new Error("Backup no encontrado");
      const filePath: string | undefined = (backup as any).filePath;
      if (!filePath) throw new Error("Archivo de backup no encontrado");

      // Compatibilidad hacia atrás: si el backup es .tar.gz, usar el restaurador antiguo
      if (/\.tar\.gz$/i.test(filePath)) {
        return await (this as any).restoreFromTarGzByDocumentId(documentId, { preserveBackupsTable: true });
      }

      let localPath = filePath;
      if (/^https?:\/\//i.test(filePath)) {
        const tmpDir = path.resolve(process.cwd(), "tmp");
        await ensureDir(tmpDir);
        localPath = path.join(tmpDir, `restore_${tsString()}.dump`);
        const buf = await fetchToBuffer(filePath);
        await fsp.writeFile(localPath, buf);
      }
      if (!existsSync(localPath)) throw new Error("Archivo de backup no encontrado");

      const { host, port, database, user, password } = pgConfig();
      const { restore } = pgBins();
      const args = ["-h", host, "-p", String(port), "-U", user, "-d", database, "--clean", "--if-exists", "--no-owner", "--no-privileges", "--role", user, localPath];
      const res = await spawnAsync(restore, args, { PGPASSWORD: String(password) });
      let toleratedTxnWarning = false;
      if (res.code !== 0) {
        const stderr = String(res.stderr || "");
        const onlyUnrecognizedGucErrors = /ERROR:\s+unrecognized configuration parameter/i.test(stderr)
          && !/ERROR:(?![^\n]*unrecognized configuration parameter)/i.test(stderr.replace(/\n/g, ' \n '));
        if (onlyUnrecognizedGucErrors) {
          toleratedTxnWarning = true;
          strapi.log.warn("pg_restore terminó con error de 'transaction_timeout' no reconocido, continuando como éxito por compatibilidad de versiones.");
        } else {
          strapi.log.error(`pg_restore falló: ${res.stderr}`);
          throw new Error("No se pudo restaurar el backup con pg_restore");
        }
      }
      // Log provisional: mostrar conteos por tabla restaurada
      try {
        const stats = await collectContentTypeCounts(strapi as any);
        strapi.log.info("[restore] Resumen tras restauración:");
        for (const s of stats) {
          strapi.log.info(`[restore] ${s.uid}: ${s.count}`);
        }
        // History: registrar restauración de backup
        try {
          await logHistory(strapi as any, {
            title: "Backup restaurado",
            message: "Restauración desde backup .dump",
            trace_id: documentId,
            module: "backup",
            event_type: "backup_restored",
            level: toleratedTxnWarning ? "WARN" : "INFO",
            status_code: "200",
            duration_ms: String(Date.now() - t0),
            payload: {
              documentId,
              source_path: filePath,
              local_path: localPath,
              toleratedTxnWarning,
              stats,
            },
          });
        } catch {}
        return { restored: true, stats };
      } catch (e) {
        try {
          await logHistory(strapi as any, {
            title: "Backup restaurado",
            message: "Restauración desde backup .dump (sin estadísticas)",
            trace_id: documentId,
            module: "backup",
            event_type: "backup_restored",
            level: "INFO",
            status_code: "200",
            duration_ms: String(Date.now() - t0),
            payload: {
              documentId,
              source_path: filePath,
              local_path: localPath,
              stats_error: (e as any)?.message || String(e),
            },
          });
        } catch {}
        return { restored: true };
      }
    },

    /**
     * Restaurar desde upload de archivo .dump
     */
    async restoreFromUploadPgDump(file: any) {
      const t0 = Date.now();
      const backupsDir = path.resolve(process.cwd(), "backups");
      await ensureDir(backupsDir);
      const filename = `upload_restore_${tsString()}.dump`;
      const destPath = path.join(backupsDir, filename);
      const inputPath: string = file?.path || file?.filepath || file?.tempFilePath;
      if (!inputPath || !existsSync(inputPath)) throw new Error("Archivo de upload no disponible");
      await fse.copy(inputPath, destPath);

      const { host, port, database, user, password } = pgConfig();
      const { restore } = pgBins();
      const args = ["-h", host, "-p", String(port), "-U", user, "-d", database, "--clean", "--if-exists", "--no-owner", "--no-privileges", "--role", user, destPath];
      const res = await spawnAsync(restore, args, { PGPASSWORD: String(password) });
      try { await fsp.unlink(destPath); } catch {}
      let toleratedTxnWarning = false;
      if (res.code !== 0) {
        const stderr = String(res.stderr || "");
        const onlyUnrecognizedGucErrors = /ERROR:\s+unrecognized configuration parameter/i.test(stderr)
          && !/ERROR:(?![^\n]*unrecognized configuration parameter)/i.test(stderr.replace(/\n/g, ' \n '));
        if (onlyUnrecognizedGucErrors) {
          toleratedTxnWarning = true;
          strapi.log.warn("pg_restore terminó con error de 'transaction_timeout' no reconocido, continuando como éxito por compatibilidad de versiones.");
        } else {
          strapi.log.error(`pg_restore falló: ${res.stderr}`);
          throw new Error("No se pudo restaurar el backup con pg_restore");
        }
      }
      // Log provisional: mostrar conteos por tabla restaurada
      try {
        const stats = await collectContentTypeCounts(strapi as any);
        strapi.log.info("[restoreFromUpload] Resumen tras restauración:");
        for (const s of stats) {
          strapi.log.info(`[restoreFromUpload] ${s.uid}: ${s.count}`);
        }
        // History: registrar restauración (upload)
        try {
          await logHistory(strapi as any, {
            title: "Backup restaurado",
            message: "Restauración desde upload .dump",
            module: "backup",
            event_type: "backup_restored",
            level: toleratedTxnWarning ? "WARN" : "INFO",
            status_code: "200",
            duration_ms: String(Date.now() - t0),
            payload: {
              source: "upload",
              originalName: file?.name || file?.filename,
              toleratedTxnWarning,
              stats,
            },
          });
        } catch {}
        return { restored: true, stats };
      } catch (e) {
        try {
          await logHistory(strapi as any, {
            title: "Backup restaurado",
            message: "Restauración desde upload .dump (sin estadísticas)",
            module: "backup",
            event_type: "backup_restored",
            level: "INFO",
            status_code: "200",
            duration_ms: String(Date.now() - t0),
            payload: {
              source: "upload",
              originalName: file?.name || file?.filename,
              stats_error: (e as any)?.message || String(e),
            },
          });
        } catch {}
        return { restored: true };
      }
    },

    /**
     * Descargar backup por documentId (stream)
     */
  async streamDownloadByDocumentId(documentId: string, ctx: any) {
      const backup = await getEntryByDocumentId(
        strapi as any,
        "api::backup.backup",
        documentId,
      );
      if (!backup) return ctx.notFound("Backup no encontrado");
      const filePath: string | undefined = (backup as any).filePath;
      if (!filePath) return ctx.notFound("Archivo de backup no encontrado");

      const filename = (backup as any).filename || path.basename(filePath);
      // Si el archivo está en Cloudinary/URL, redirigir
      if (/^https?:\/\//i.test(filePath)) {
        ctx.redirect(filePath);
        return;
      }
      if (!existsSync(filePath)) return ctx.notFound("Archivo de backup no encontrado");
      ctx.set("Content-Type", "application/octet-stream");
      ctx.set("Content-Disposition", `attachment; filename="${filename}"`);
      ctx.body = createReadStream(filePath);
    },

    /**
     * Eliminar backup por documentId
     */
    async deleteByDocumentId(documentId: string) {
      const backup = await getEntryByDocumentId(
        strapi as any,
        "api::backup.backup",
        documentId,
      );
      if (!backup) throw new Error("Backup no encontrado");

      // Eliminar primero el archivo físico (en caso de que el lifecycle no alcance)
      const filePath: string | undefined = (backup as any).filePath;
      if (filePath && existsSync(filePath)) {
        try {
          await fsp.unlink(filePath);
        } catch {}
      }

      // Intentar eliminar el documento completo usando el Document Service (Strapi v5)
      try {
        const docs = (strapi as any).documents("api::backup.backup");
        if (docs && typeof docs.delete === "function") {
          await docs.delete({ documentId });
          return { ok: true };
        }
      } catch (e: any) {
        // Fallback a eliminación directa por query si falla documents.delete
        strapi.log?.warn?.(
          `Fallo documents.delete para backup ${documentId}, usando delete por query: ${e?.message || e}`,
        );
      }

      await deleteEntryByDocumentId(
        strapi as any,
        "api::backup.backup",
        documentId,
      );
      return { ok: true };
    },

    /**
     * Restaurar desde tar.gz por documentId
     * No modifica NUNCA la tabla ni entries del CT backup
     */
    async restoreFromTarGzByDocumentId(
      documentId: string,
      opts: {
        preserveBackupsTable?: boolean;
        pruneMissing?: boolean;
        pruneUids?: string[];
      } = {},
    ) {
      const backup = await getEntryByDocumentId(
        strapi as any,
        "api::backup.backup",
        documentId,
      );
      if (!backup) throw new Error("Backup no encontrado");
      const filePath: string | undefined = (backup as any).filePath;
      if (!filePath || !existsSync(filePath))
        throw new Error("Archivo de backup no encontrado");
      return await (this as any).restoreFromTarGzFile(filePath, opts);
    },

    /**
     * Restaurar desde upload .tar.gz (sin crear/modificar ningún registro de backups)
     */
    async restoreFromUploadTarGz(
      file: any,
      opts: {
        preserveBackupsTable?: boolean;
        pruneMissing?: boolean;
        pruneUids?: string[];
      } = {},
    ) {
      const backupsDir = path.resolve(process.cwd(), "backups");
      await ensureDir(backupsDir);
      const filename = `upload_restore_${tsString()}.tar.gz`;
      const destPath = path.join(backupsDir, filename);

      // Mover/guardar el archivo temporal recibido (según provider de bodyparser)
      const inputPath: string =
        file?.path || file?.filepath || file?.tempFilePath;
      if (!inputPath || !existsSync(inputPath))
        throw new Error("Archivo de upload no disponible");
      await fse.copy(inputPath, destPath);
      const summary = await (this as any).restoreFromTarGzFile(destPath, opts);
      // Limpieza del archivo subido (opcional conservar)
      try {
        await fsp.unlink(destPath);
      } catch {}
      return summary;
    },

    /**
     * Lógica común de restore desde un archivo tar.gz
     * Importa data de todos los UIDs excepto api::backup.backup y copia assets
     */
    async restoreFromTarGzFile(
      filePath: string,
      opts: {
        preserveBackupsTable?: boolean;
        pruneMissing?: boolean;
        pruneUids?: string[];
      } = {},
    ) {
      const tmpDir = path.resolve(
        process.cwd(),
        "tmp",
        `restore_${tsString()}`,
      );
      await ensureDir(tmpDir);

      // Extraer tar.gz
      await tar.x({ file: filePath, cwd: tmpDir });

      // Leer manifest
      const manifestPath = path.join(tmpDir, "manifest.json");
      const manifest = JSON.parse(await fsp.readFile(manifestPath, "utf-8"));

      const dataDir = path.join(tmpDir, "data");
      const assetsUploadsDir = path.join(tmpDir, "assets", "uploads");

      let imported = 0;
      let updated = 0;
      let pruned = 0;
      const skippedUids: string[] = [];

      // Mapa: UID -> { documentId -> id }
      const idByDoc: Record<string, Record<string, number>> = {};
      // Relación pendiente para segunda pasada
      type PendingRel = {
        sourceUid: string;
        sourceDocId: string;
        key: string;
        targetUid: string;
        relatedDocIds: string[];
      };
      const pendingRelations: PendingRel[] = [];

      // Mantener set de documentIds presentes en el backup por UID
      const backupDocIdsByUid: Record<string, Set<string>> = {};

      // Primera pasada: crear/actualizar registros sin relaciones
      for (const uid of manifest.contentTypes as string[]) {
        if (uid === "api::backup.backup") {
          skippedUids.push(uid);
          continue;
        }
        const fileRel = manifest.files?.data?.[uid];
        const fileAbs = path.join(
          tmpDir,
          fileRel || path.join("data", `${safeUidFileName(uid)}.json`),
        );
        if (!existsSync(fileAbs)) continue;
        const items = JSON.parse(await fsp.readFile(fileAbs, "utf-8"));
        if (!Array.isArray(items)) continue;

        const ct: any = (strapi.contentTypes as any)[uid] || {};
        const attributes: Record<string, any> = ct.attributes || {};
        const relationKeys = Object.keys(attributes).filter(
          (k) => (attributes[k] || {}).type === "relation",
        );

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

          const existing = await (strapi.db as any)
            .query(uid)
            .findOne({ where: { documentId }, select: ["id", "documentId"] });
          let savedId: number | undefined = existing?.id;
          if (existing?.id) {
            await (strapi.db as any)
              .query(uid)
              .update({ where: { documentId }, data });
            updated++;
          } else {
            const created = await strapi.entityService.create(uid as any, {
              data,
            });
            savedId = (created as any)?.id;
            imported++;
          }
          if (!savedId) {
            // obtener id después de create/update si no estuvo disponible
            const ref = await (strapi.db as any)
              .query(uid)
              .findOne({ where: { documentId }, select: ["id"] });
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
              if (Array.isArray(v))
                return v
                  .map((x) => x?.documentId || x?.id || x)
                  .filter(Boolean);
              if (typeof v === "object")
                return [v?.documentId].filter(Boolean) as string[];
              if (typeof v === "string") return [v];
              return [];
            };
            const relatedDocIds = extractDocIds(value);
            if (relatedDocIds.length) {
              pendingRelations.push({
                sourceUid: uid,
                sourceDocId: documentId,
                key: rk,
                targetUid,
                relatedDocIds,
              });
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
          if (known) {
            targetIds.push(known);
            continue;
          }
          const ref = await (strapi.db as any)
            .query(rel.targetUid)
            .findOne({ where: { documentId: docId }, select: ["id"] });
          if (ref?.id) targetIds.push(ref.id);
        }
        if (!targetIds.length) continue;

        // Determinar cardinalidad y lado propietario
        const ct: any = (strapi.contentTypes as any)[rel.sourceUid] || {};
        const attr = ct.attributes?.[rel.key] || {};
        const relation: string = attr.relation || "";

        // Estrategia por tipo de relación
        if (relation === "manyToOne") {
          // El lado propietario es el origen (tiene la FK). Actualizar fuente con el id de destino.
          const data: any = {};
          data[rel.key] = targetIds[0];
          try {
            await strapi.entityService.update(rel.sourceUid as any, sourceId, {
              data,
            });
          } catch (e) {
            const connectData: any = {};
            connectData[rel.key] = { connect: [{ id: targetIds[0] }] };
            try {
              await strapi.entityService.update(
                rel.sourceUid as any,
                sourceId,
                { data: connectData },
              );
            } catch {}
          }
        } else if (relation === "oneToMany") {
          // El lado propietario suele ser el target (manyToOne hacia el source)
          const targetOwnerKey = findTargetOwningField(
            strapi,
            rel.targetUid,
            rel.sourceUid,
            attr?.inversedBy,
          );
          if (targetOwnerKey) {
            for (const tid of targetIds) {
              const tdata: any = {};
              tdata[targetOwnerKey] = sourceId;
              try {
                await strapi.entityService.update(rel.targetUid as any, tid, {
                  data: tdata,
                });
              } catch (e) {
                // Alternativa: connect desde el target
                const cdata: any = {};
                cdata[targetOwnerKey] = { connect: [{ id: sourceId }] };
                try {
                  await strapi.entityService.update(rel.targetUid as any, tid, {
                    data: cdata,
                  });
                } catch {}
              }
            }
          } else {
            // Fallback: intentar asignar desde el origen usando connect
            const connectData: any = {};
            connectData[rel.key] = { connect: targetIds.map((id) => ({ id })) };
            try {
              await strapi.entityService.update(
                rel.sourceUid as any,
                sourceId,
                { data: connectData },
              );
            } catch {}
          }
        } else if (relation === "manyToMany") {
          // Usar connect en el origen
          const connectData: any = {};
          connectData[rel.key] = { connect: targetIds.map((id) => ({ id })) };
          try {
            await strapi.entityService.update(rel.sourceUid as any, sourceId, {
              data: connectData,
            });
          } catch (e) {
            // Fallback: intentar asignación directa si el esquema lo permite
            const data: any = {};
            data[rel.key] = targetIds;
            try {
              await strapi.entityService.update(
                rel.sourceUid as any,
                sourceId,
                { data },
              );
            } catch {}
          }
        } else if (relation === "oneToOne") {
          // Intentar primero en el origen
          const data: any = {};
          data[rel.key] = targetIds[0];
          let ok = false;
          try {
            await strapi.entityService.update(rel.sourceUid as any, sourceId, {
              data,
            });
            ok = true;
          } catch {}
          if (!ok) {
            // Si falla, probar en el destino
            const targetOwnerKey = findTargetOwningField(
              strapi,
              rel.targetUid,
              rel.sourceUid,
              attr?.inversedBy,
            );
            if (targetOwnerKey) {
              const tdata: any = {};
              tdata[targetOwnerKey] = sourceId;
              try {
                await strapi.entityService.update(
                  rel.targetUid as any,
                  targetIds[0],
                  { data: tdata },
                );
              } catch {}
            }
          }
        } else {
          // Desconocido: intentar connect en origen como último recurso
          const connectData: any = {};
          connectData[rel.key] = { connect: targetIds.map((id) => ({ id })) };
          try {
            await strapi.entityService.update(rel.sourceUid as any, sourceId, {
              data: connectData,
            });
          } catch {}
        }
      }

      // Opcional: eliminar registros que NO están en el backup (prune)
      if (opts?.pruneMissing) {
        const targetUids: string[] =
          Array.isArray(opts.pruneUids) && opts.pruneUids.length
            ? opts.pruneUids
            : (manifest.contentTypes as string[]).filter(
                (u: string) => u !== "api::backup.backup",
              );

        for (const uid of targetUids) {
          try {
            const existing: Array<{ id: number; documentId: string }> = await (
              strapi.db as any
            )
              .query(uid)
              .findMany({ select: ["id", "documentId"] });
            const allowedSet = backupDocIdsByUid[uid] || new Set<string>();
            for (const row of existing) {
              if (!row?.documentId) continue;
              if (!allowedSet.has(row.documentId)) {
                try {
                  await strapi.entityService.delete(uid as any, row.id);
                  pruned++;
                } catch (e: any) {
                  strapi.log?.warn?.(
                    `No se pudo eliminar ${uid} id=${row.id} docId=${row.documentId}: ${e?.message || e}`,
                  );
                }
              }
            }
          } catch (e: any) {
            strapi.log?.warn?.(
              `Fallo al obtener existentes para ${uid}: ${e?.message || e}`,
            );
          }
        }
      }

      // Copiar assets a public/uploads
      const publicUploads = path.resolve(process.cwd(), "public", "uploads");
      if (existsSync(assetsUploadsDir)) {
        await ensureDir(publicUploads);
        await fse.copy(assetsUploadsDir, publicUploads, { overwrite: true });
      }

      // Limpieza tmp
      try {
        await fse.remove(tmpDir);
      } catch {}

      return { imported, updated, pruned, skippedUids };
    },

    /**
     * Exportar XLSX desde un backup .tar.gz por documentId
     */
    async exportXlsxFromTarGzByDocumentId(documentId: string, limit?: number) {
      const backup = await getEntryByDocumentId(
        strapi as any,
        "api::backup.backup",
        documentId,
      );
      if (!backup) throw new Error("Backup no encontrado");
      const filePath: string | undefined = (backup as any).filePath;
      // Fallback: si no existe el .tar.gz (o es un .dump), exportar desde la BD actual
      if (!filePath || !existsSync(filePath) || filePath.endsWith(".dump")) {
        const service = strapi.service("api::backup.backup") as any;
        const { filename, buffer } = await service.exportXlsx(limit);
        // Ajustar nombre para reflejar el backup origen si está disponible
        const base = (backup as any).filename?.replace(/\.(tar\.gz|dump)$/i, "") || tsString();
        const adjusted = filename?.includes("backup_summary_")
          ? `backup_${base}_data.xlsx`
          : filename;
        return { filename: adjusted, buffer };
      }

      const tmpDir = path.resolve(
        process.cwd(),
        "tmp",
        `export_xlsx_${tsString()}`,
      );
      await ensureDir(tmpDir);
      await tar.x({ file: filePath, cwd: tmpDir });

      const manifestPath = path.join(tmpDir, "manifest.json");
      const manifest = JSON.parse(await fsp.readFile(manifestPath, "utf-8"));
      const dataDir = path.join(tmpDir, "data");

      const workbook = new ExcelJS.Workbook();
      const usedNames = new Set<string>();
      const summarySheet = addWorksheetSafe(workbook, "Resumen", usedNames);
      summarySheet.columns = [
        { header: "Tabla", key: "tabla", width: 32 },
        { header: "UID", key: "uid", width: 40 },
        { header: "Hoja", key: "hoja", width: 32 },
        { header: "Cantidad", key: "cantidad", width: 12 },
        { header: "Columnas", key: "columnas", width: 60 },
      ];

      for (const uid of manifest.contentTypes || []) {
        if (uid === "api::backup.backup") continue;
        const fileRel =
          manifest.files?.data?.[uid] || `data/${safeUidFileName(uid)}.json`;
        const fileAbs = path.join(tmpDir, fileRel);
        if (!existsSync(fileAbs)) continue;
        const items = JSON.parse(await fsp.readFile(fileAbs, "utf-8"));
        if (!Array.isArray(items)) continue;

        // Columnas: base + todas las de texto detectadas (sin límite)
        const sample = items.find((x: any) => !!x) || {};
        const keys = Object.keys(sample);
        const baseCols = [
          "id",
          "documentId",
          "createdAt",
          "updatedAt",
          "publishedAt",
        ];
        const textKeys = keys.filter(
          (k) => typeof sample[k] === "string" && !baseCols.includes(k),
        );
        const columns = [...baseCols, ...textKeys];

        const ct = (strapi.contentTypes as any)[uid];
        const sheetName = proposeSheetName(uid, ct, usedNames);
        const ws = addWorksheetSafe(workbook, sheetName, usedNames);
        ws.columns = columns.map((c) => ({
          header: c,
          key: c,
          width: Math.max(14, c.length + 2),
        }));
        const rowLimit =
          typeof limit === "number" && limit > 0 ? limit : undefined;
        let added = 0;
        for (const it of items) {
          if (rowLimit && added >= rowLimit) break;
          const row: any = {};
          for (const c of columns) row[c] = (it as any)[c];
          ws.addRow(row);
          added++;
        }
        summarySheet.addRow({
          tabla: sheetName,
          uid,
          hoja: sheetName,
          cantidad: items.length,
          columnas: columns.join(", "),
        });
      }

      const buffer = await workbook.xlsx.writeBuffer();
      const filename = `backup_${(backup as any).filename?.replace(/\.(tar\.gz|dump)$/i, "") || tsString()}_data.xlsx`;
      // Limpieza tmp
      try {
        await fse.remove(tmpDir);
      } catch {}
      return { filename, buffer };
    },

    /**
     * Exportar JSON consolidado desde un backup .tar.gz por documentId
     */
    async exportJsonFromTarGzByDocumentId(documentId: string) {
      const backup = await getEntryByDocumentId(
        strapi as any,
        "api::backup.backup",
        documentId,
      );
      if (!backup) throw new Error("Backup no encontrado");
      const filePath: string | undefined = (backup as any).filePath;
      // Fallback: si no existe el .tar.gz (o es un .dump), exportar JSON desde la BD actual
      if (!filePath || !existsSync(filePath) || filePath.endsWith(".dump")) {
        const service = strapi.service("api::backup.backup") as any;
        const { filename, buffer } = await service.exportJson();
        const base = (backup as any).filename?.replace(/\.(tar\.gz|dump)$/i, "") || tsString();
        const adjusted = filename?.includes("backup_summary_")
          ? `backup_${base}_data.json`
          : filename;
        return { filename: adjusted, buffer };
      }

      const tmpDir = path.resolve(
        process.cwd(),
        "tmp",
        `export_json_${tsString()}`,
      );
      await ensureDir(tmpDir);
      await tar.x({ file: filePath, cwd: tmpDir });

      const manifestPath = path.join(tmpDir, "manifest.json");
      const manifest = JSON.parse(await fsp.readFile(manifestPath, "utf-8"));

      const output: any = {
        type: "strapi-backup-json",
        createdAt: new Date().toISOString(),
        sourceBackup: (backup as any).filename,
        manifest: { ...manifest },
        data: {},
      };

      for (const uid of manifest.contentTypes || []) {
        if (uid === "api::backup.backup") continue;
        const fileRel =
          manifest.files?.data?.[uid] || `data/${safeUidFileName(uid)}.json`;
        const fileAbs = path.join(tmpDir, fileRel);
        if (!existsSync(fileAbs)) continue;
        const items = JSON.parse(await fsp.readFile(fileAbs, "utf-8"));
        if (!Array.isArray(items)) continue;
        output.data[uid] = items;
      }

      const jsonStr = JSON.stringify(output, null, 2);
      const buffer = Buffer.from(jsonStr, "utf-8");
      const filename = `backup_${(backup as any).filename?.replace(/\.(tar\.gz|dump)$/i, "") || tsString()}_data.json`;
      try {
        await fse.remove(tmpDir);
      } catch {}
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
      const summarySheet = addWorksheetSafe(workbook, "Resumen", usedNames);
      summarySheet.columns = [
        { header: "Tabla", key: "tabla", width: 32 },
        { header: "UID", key: "uid", width: 40 },
        { header: "Hoja", key: "hoja", width: 32 },
        { header: "Cantidad", key: "cantidad", width: 12 },
        { header: "Columnas", key: "columnas", width: 60 },
      ];

      const uids = Object.keys(strapi.contentTypes || {}).filter((uid) => {
        const ct: any = (strapi.contentTypes as any)[uid];
        return (
          ct &&
          ct.kind === "collectionType" &&
          uid.startsWith("api::") &&
          uid !== "api::backup.backup"
        );
      });

      for (const uid of uids) {
        const ct: any = (strapi.contentTypes as any)[uid] || {};
        const attributes: Record<string, any> = ct.attributes || {};
        const textFieldKeys = Object.keys(attributes).filter((key) =>
          ["string", "text", "richtext", "email"].includes(
            (attributes[key] || {}).type,
          ),
        );

        const baseCols = [
          "id",
          "documentId",
          "createdAt",
          "updatedAt",
          "publishedAt",
        ];
        const columns = [...baseCols, ...textFieldKeys];
        const sheetName = proposeSheetName(uid, ct, usedNames);
        const ws = addWorksheetSafe(workbook, sheetName, usedNames);
        ws.columns = columns.map((c) => ({
          header: c,
          key: c,
          width: Math.max(14, c.length + 2),
        }));

        const rowLimit = typeof limit === "number" && limit > 0 ? limit : 1000;
        const rows = await (strapi.db as any)
          .query(uid)
          .findMany({ select: columns, limit: rowLimit });
        for (const row of rows) {
          const r: any = {};
          for (const c of columns) r[c] = (row as any)[c];
          ws.addRow(r);
        }

        let count = 0;
        try {
          count = await (strapi.db as any).query(uid).count();
        } catch {}

        summarySheet.addRow({
          tabla: sheetName,
          uid,
          hoja: sheetName,
          cantidad: count,
          columnas: columns.join(", "),
        });
      }

      const buffer = await workbook.xlsx.writeBuffer();
      const filename = `backup_summary_${tsString()}.xlsx`;
      return { filename, buffer };
    },

    /**
     * Exportar JSON consolidado desde la BD actual (fallback cuando el backup es .dump)
     */
    async exportJson(limit?: number) {
      const output: any = {
        type: "strapi-backup-json",
        createdAt: new Date().toISOString(),
        sourceBackup: "current-db",
        manifest: {
          contentTypes: [],
        },
        data: {},
      };

      const uids = Object.keys(strapi.contentTypes || {}).filter((uid) => {
        const ct: any = (strapi.contentTypes as any)[uid];
        return (
          ct &&
          ct.kind === "collectionType" &&
          uid.startsWith("api::") &&
          uid !== "api::backup.backup"
        );
      });

      const rowLimit = typeof limit === "number" && limit > 0 ? limit : undefined;
      for (const uid of uids) {
        const ct: any = (strapi.contentTypes as any)[uid] || {};
        const attributes: Record<string, any> = ct.attributes || {};
        const baseCols = [
          "id",
          "documentId",
          "createdAt",
          "updatedAt",
          "publishedAt",
        ];
        const scalarTypes = new Set([
          "string",
          "text",
          "richtext",
          "email",
          "integer",
          "biginteger",
          "float",
          "decimal",
          "boolean",
          "date",
          "datetime",
          "time",
          "uuid",
        ]);
        const scalarKeys = Object.keys(attributes).filter((key) =>
          scalarTypes.has((attributes[key] || {}).type),
        );
        const columns = Array.from(new Set([...baseCols, ...scalarKeys]));

        let rows: any[] = [];
        try {
          rows = await (strapi.db as any)
            .query(uid)
            .findMany({ select: columns, limit: rowLimit });
        } catch (e) {
          // Si falla el select específico, intentar sin select
          try {
            rows = await (strapi.db as any)
              .query(uid)
              .findMany({ limit: rowLimit });
          } catch {}
        }

        output.manifest.contentTypes.push(uid);
        output.data[uid] = rows;
      }

      const jsonStr = JSON.stringify(output, null, 2);
      const buffer = Buffer.from(jsonStr, "utf-8");
      const filename = `backup_summary_${tsString()}.json`;
      return { filename, buffer };
    },

    /**
     * Sincronizar índice de backups (detecta huérfanos y registrados)
     */
    async syncBackups() {
      const result = await syncBackupsIndex(strapi as any, {
        removeOrphanFiles: false,
      });
      return result;
    },
  }),
);
