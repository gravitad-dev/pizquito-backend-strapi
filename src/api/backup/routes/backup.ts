/**
 * backup router (simplificado)
 */

export default {
  routes: [
    // Listar todos los backups
    {
      method: "GET",
      path: "/backups",
      handler: "backup.find",
      config: {
        description: "Lista todos los backups con filtros opcionales",
      },
    },
    // Crear backup simple (todas las tablas)
    {
      method: "POST",
      path: "/backups",
      handler: "backup.create",
      config: {
        description:
          "Crea un backup simple de todas las tablas y lo guarda en /backups",
      },
    },
    // Descargar archivo de backup (.dump)
    {
      method: "GET",
      path: "/backups/:documentId/download",
      handler: "backup.download",
      config: {
        description:
          "Descarga el archivo del backup .dump (u origen remoto si está en Cloudinary). Se envía como application/octet-stream",
      },
    },
    // Exportar resumen en XLSX (BD actual)
    {
      method: "GET",
      path: "/backups/export/xlsx",
      handler: "backup.exportXlsx",
      config: {
        description:
          "Genera y descarga un XLSX con resumen por tabla desde la BD actual y muestras de campos de texto",
      },
    },
    // Exportar XLSX desde un backup específico (.dump o .tar.gz)
    {
      method: "GET",
      path: "/backups/:documentId/export/xlsx",
      handler: "backup.exportXlsxByDocument",
      config: {
        description:
          "Genera y descarga un XLSX basado en los datos del backup indicado por documentId. Si es .tar.gz se extrae del archivo; si es .dump o falta el archivo, se exporta desde la BD actual",
      },
    },
    // Exportar JSON consolidado desde un backup específico (.dump o .tar.gz)
    {
      method: "GET",
      path: "/backups/:documentId/export/json",
      handler: "backup.exportJsonByDocument",
      config: {
        description:
          "Genera y descarga un JSON consolidado del backup indicado por documentId. Si es .tar.gz se extrae del archivo; si es .dump o falta el archivo, se exporta desde la BD actual (excluye api::backup.backup)",
      },
    },
    // (El endpoint de exportación XLSX ha sido retirado en la nueva implementación tar.gz)
    // Eliminar backup
    {
      method: "DELETE",
      path: "/backups/:documentId",
      handler: "backup.delete",
      config: {
        description: "Elimina un backup (registro y archivo)",
      },
    },
    // Restaurar backup
    {
      method: "POST",
      path: "/backups/:documentId/restore",
      handler: "backup.restore",
      config: {
        description:
          "Restaura un backup específico. Para sqlite requiere reiniciar el servidor tras la operación.",
      },
    },
    // Restaurar desde archivo subido (upload .dump)
    {
      method: "POST",
      path: "/backups/restore/upload",
      handler: "backup.restoreFromUpload",
      config: {
        description:
          "Sube un archivo de backup (.dump de pg_dump) y restaura la base de datos sin modificar api::backup.backup",
      },
    },
    {
      method: "POST",
      path: "/backups/sync",
      handler: "backup.sync",
      config: {
        description: "Sincroniza",
      },
    },
  ],
};
