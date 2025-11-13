export default {
  routes: [
    {
      method: 'GET',
      path: '/suppliers/:documentId/items-movements/export',
      handler: 'supplier.exportItemsMovements',
      config: {
        policies: [],
        middlewares: [],
      },
    },
  ],
};