/**
 * Routes for Reports module: XLSX generation (Invoice lists)
 */

export default {
  routes: [
    {
      method: 'GET',
      path: '/reports/xlsx/invoices/employees/:id',
      handler: 'reports-invoices-xlsx.employees',
      config: { policies: [], auth: false },
    },
    {
      method: 'GET',
      path: '/reports/xlsx/invoices/enrollments/:id',
      handler: 'reports-invoices-xlsx.enrollments',
      config: { policies: [], auth: false },
    },
    {
      method: 'GET',
      path: '/reports/xlsx/invoices/general',
      handler: 'reports-invoices-xlsx.general',
      config: { policies: [], auth: false },
    },
    {
      method: 'GET',
      path: '/reports/xlsx/invoices/services',
      handler: 'reports-invoices-xlsx.services',
      config: { policies: [], auth: false },
    },
  ],
};