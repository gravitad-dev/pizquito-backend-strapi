import { normalizeInvoiceAmounts } from '../../../../utils/invoice-amounts';

/**
 * Invoice lifecycles
 * Automatically sets registeredBy field when creating invoices
 */

export default {
  async beforeCreate(event) {
    const { data } = event.params;
    // Normalizar amounts según nueva estructura
    if (data && 'amounts' in data) {
      data.amounts = normalizeInvoiceAmounts(data.amounts);
    }
    // Si no se especifica registeredBy, asignar 'administration' por defecto
    // (las facturas del cron ya tienen registeredBy: 'system')
    if (!data.registeredBy) {
      data.registeredBy = 'administration';
    }
  },

  async beforeUpdate(event) {
    const { data } = event.params;
    // Normalizar amounts al actualizar
    if (data && 'amounts' in data) {
      data.amounts = normalizeInvoiceAmounts(data.amounts);
    }
    // Si se está actualizando y no se especifica registeredBy, mantener 'administration'
    if (data.registeredBy === undefined) {
      // No modificar si no se está actualizando este campo
      return;
    }
  },
};