export default {
  routes: [
    {
      method: 'GET',
      path: '/employees/:documentId/billing-months',
      handler: 'employee.billingMonths',
      config: {
        policies: [],
        middlewares: [],
      },
    },
  ],
};