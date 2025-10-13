export default {
  routes: [
    {
      method: 'GET',
      path: '/invoices/enrollments',
      handler: 'invoice.findEnrollments',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'GET',
      path: '/invoices/payrolls',
      handler: 'invoice.findPayrolls',
      config: {
        policies: [],
        middlewares: [],
      },
    },
  ],
};