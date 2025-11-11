import { syncBackupsIndex } from "./utils/backup-sync";
import registerBackfillInvoices, {
  runBackfill,
} from "./utils/cron/backfill-invoice-snapshot";
// import type { Core } from '@strapi/strapi';

export default {
  /**
   * An asynchronous register function that runs before
   * your application is initialized.
   *
   * This gives you an opportunity to extend code.
   */
  register(/* { strapi }: { strapi: Core.Strapi } */) {},

  /**
   * An asynchronous bootstrap function that runs before
   * your application gets started.
   *
   * This gives you an opportunity to set up your data model,
   * run jobs, or perform some special logic.
   */
  async bootstrap({ strapi }: any) {
    try {
      // Registrar helper para backfill de snapshots de facturas en strapi.backfillInvoices
      try {
        registerBackfillInvoices(strapi);
        strapi.log.info(
          "🧩 BackfillInvoices helper registrado en strapi.backfillInvoices",
        );
      } catch (e: any) {
        strapi.log.warn(
          `No se pudo registrar el helper de backfill: ${e?.message}`,
        );
      }

      // Ejecutar backfill SIEMPRE al arrancar el contenedor (una vez por arranque)
      // Se puede desactivar con BACKFILL_ALWAYS=0
      try {
        const alwaysRunEnv = String(process.env.BACKFILL_ALWAYS || "1").toLowerCase();
        const shouldRun = ["1", "true", "yes"].includes(alwaysRunEnv);
        if (shouldRun) {
          strapi.log.info(
            "🔄 [Backfill] Ejecutando al arranque el backfill de partySnapshot para invoices (BACKFILL_ALWAYS=on)...",
          );
          const { processed, updated } = await runBackfill(strapi, { debug: true });
          strapi.log.info(
            `✅ [Backfill] Backfill completado. Procesados: ${processed}, Actualizados: ${updated}`,
          );
        } else {
          strapi.log.info("⏸️  [Backfill] BACKFILL_ALWAYS=off - no se ejecuta al arranque");
        }
      } catch (e: any) {
        strapi.log.error(`❌ [Backfill] Error ejecutando backfill en bootstrap: ${e?.message || e}`);
      }

      const env = String(process.env.BACKUP_SYNC_ON_START || "1").toLowerCase();
      if (["1", "true", "yes"].includes(env)) {
        await syncBackupsIndex(strapi, { removeOrphanFiles: true });
      }
    } catch (e: any) {
      strapi.log.warn(`Sync de backups en bootstrap falló: ${e?.message}`);
    }
  },
};
