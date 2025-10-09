/**
 * Routes for Reports module: PDF generation (Invoices and Payrolls)
 */

export default {
  routes: [
    {
      method: 'GET',
      path: '/reports/pdf/invoice/:id',
      handler: 'reports-pdf.invoice',
      config: { policies: [], auth: false },
    },
    {
      method: 'GET',
      path: '/reports/pdf/payroll/:id',
      handler: 'reports-pdf.payroll',
      config: { policies: [], auth: false },
    },
    {
      method: 'GET',
      path: '/reports/pdf/service/:id',
      handler: 'reports-pdf.service',
      config: { policies: [], auth: false },
    },
    {
      method: 'GET',
      path: '/reports/pdf/general/:id',
      handler: 'reports-pdf.general',
      config: { policies: [], auth: false },
    },
  ],
};