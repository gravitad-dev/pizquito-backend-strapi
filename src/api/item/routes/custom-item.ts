export default {
  routes: [
    {
      method: 'GET',
      path: '/items/movements/export',
      handler: 'item.exportMovementsGeneral',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'GET',
      path: '/items/:documentId/movements/export',
      handler: 'item.exportMovements',
      config: {
        policies: [],
        middlewares: [],
      },
    },
  ],
};