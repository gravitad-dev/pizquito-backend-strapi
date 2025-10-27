import { syncBackupsIndex } from './utils/backup-sync';
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
      const env = String(process.env.BACKUP_SYNC_ON_START || '1').toLowerCase();
      if (['1','true','yes'].includes(env)) {
        await syncBackupsIndex(strapi, { removeOrphanFiles: true });
      }
    } catch (e: any) {
      strapi.log.warn(`Sync de backups en bootstrap falló: ${e?.message}`);
    }
  },
};
