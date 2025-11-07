/**
 * Invoice lifecycles
 * Automatically sets registeredBy field when creating invoices
 */

import { normalizeInvoiceAmounts } from "../../../../utils/cron/invoice-amounts";
import { buildPartySnapshot } from "../../../../utils/cron/invoice-snapshot";

export default {
  async beforeCreate(event) {
    const { data } = event.params;
    // Normalizar amounts según nueva estructura
    if (data && "amounts" in data) {
      data.amounts = normalizeInvoiceAmounts(data.amounts);
    }
    // Construir snapshot y documentIds
    try {
      const snapshot = await buildPartySnapshot(strapi, data);
      data.partySnapshot = snapshot;
      data.partyType = snapshot.partyType;
      data.partyDocumentId = snapshot.partyDocumentId;
      if (snapshot.employeeDocumentId)
        data.employeeDocumentId = snapshot.employeeDocumentId;
      if (snapshot.enrollmentDocumentId)
        data.enrollmentDocumentId = snapshot.enrollmentDocumentId;
      if (snapshot.guardianDocumentId)
        data.guardianDocumentId = snapshot.guardianDocumentId;
      data.snapshotVersion = snapshot.snapshotVersion || "v1";
    } catch (e) {
      strapi.log &&
        strapi.log.warn(
          `No se pudo construir snapshot de factura (create): ${e?.message}`,
        );
    }
    // Si no se especifica registeredBy, asignar 'administration' por defecto
    // (las facturas del cron ya tienen registeredBy: 'system')
    if (!data.registeredBy) {
      data.registeredBy = "administration";
    }
  },

  async beforeUpdate(event) {
    const { data } = event.params;
    // Normalizar amounts al actualizar
    if (data && "amounts" in data) {
      data.amounts = normalizeInvoiceAmounts(data.amounts);
    }
    // Reconstruir snapshot si cambian campos relevantes
    try {
      const snapshot = await buildPartySnapshot(strapi, data);
      data.partySnapshot = snapshot;
      data.partyType = snapshot.partyType;
      data.partyDocumentId = snapshot.partyDocumentId;
      if (snapshot.employeeDocumentId)
        data.employeeDocumentId = snapshot.employeeDocumentId;
      if (snapshot.enrollmentDocumentId)
        data.enrollmentDocumentId = snapshot.enrollmentDocumentId;
      if (snapshot.guardianDocumentId)
        data.guardianDocumentId = snapshot.guardianDocumentId;
      data.snapshotVersion = snapshot.snapshotVersion || "v1";
    } catch (e) {
      strapi.log &&
        strapi.log.warn(
          `No se pudo construir snapshot de factura (update): ${e?.message}`,
        );
    }
    // Si se está actualizando y no se especifica registeredBy, mantener 'administration'
    if (data.registeredBy === undefined) {
      // No modificar si no se está actualizando este campo
      return;
    }
  },
};
