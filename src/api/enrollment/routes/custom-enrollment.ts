export default {
  routes: [
    {
      method: 'GET',
      path: '/enrollments/:documentId/billing-months',
      handler: 'enrollment.billingMonths',
      config: {
        policies: [],
        middlewares: [],
      },
    },
  ],
};