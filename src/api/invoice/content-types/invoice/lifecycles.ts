/**
 * Invoice lifecycles
 * Automatically sets registeredBy field when creating invoices
 */

export default {
  async beforeCreate(event) {
    const { data } = event.params;
    
    // Si no se especifica registeredBy, asignar 'administration' por defecto
    // (las facturas del cron ya tienen registeredBy: 'system')
    if (!data.registeredBy) {
      data.registeredBy = 'administration';
    }
  },

  async beforeUpdate(event) {
    const { data } = event.params;
    
    // Si se está actualizando y no se especifica registeredBy, mantener 'administration'
    if (data.registeredBy === undefined) {
      // No modificar si no se está actualizando este campo
      return;
    }
  },
};