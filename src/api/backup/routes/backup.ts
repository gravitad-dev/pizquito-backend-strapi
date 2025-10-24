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
        description: 'Lista todos los backups con filtros opcionales'
      },
    },
    // Crear backup simple (todas las tablas)
    {
      method: "POST",
      path: "/backups",
      handler: "backup.create",
      config: {
        description: 'Crea un backup simple de todas las tablas y lo guarda en /backups'
      },
    },
    // Descargar archivo de backup
    {
      method: "GET",
      path: "/backups/:documentId/download",
      handler: "backup.download",
      config: {
        description: 'Descarga el archivo del backup (stream binario con Content-Disposition)'
      },
    },
    // Exportar resumen en XLSX (BD actual)
    {
      method: "GET",
      path: "/backups/export/xlsx",
      handler: "backup.exportXlsx",
      config: {
        description: 'Genera y descarga un XLSX con resumen por tabla desde la BD actual y muestras de campos de texto',
      },
    },
    // Exportar XLSX desde un backup específico
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
        description: 'Restaura un backup específico. Para sqlite requiere reiniciar el servidor tras la operación.'
      },
    },
    // Restaurar desde archivo subido (upload)
    {
      method: "POST",
      path: "/backups/restore/upload",
      handler: "backup.restoreFromUpload",
      config: {
        description: 'Sube un archivo de backup (.sqlite o .json) y restaura la base de datos (sqlite implementado)'
      },
    },
    // Sincronizar backups (repoblar tabla desde filesystem)
    {
      method: "POST",
      path: "/backups/sync",
      handler: "backup.sync",
      config: {
        description: 'Sincroniza la tabla de backups con los archivos presentes en /backups'
      },
    },
  ],
};
