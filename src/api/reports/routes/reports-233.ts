/**
 * Routes for Reports module: Modelo 233
 */

export default {
  routes: [
    {
      method: 'GET',
      path: '/reports/233/preview',
      handler: 'reports-233.preview',
      config: { policies: [], auth: false },
    },
    {
      method: 'POST',
      path: '/reports/233/generate',
      handler: 'reports-233.generate',
      config: { policies: [], auth: false },
    },
    {
      method: 'GET',
      path: '/reports/233/history',
      handler: 'reports-233.history',
      config: { policies: [], auth: false },
    },
  ],
};