/**
 * Statistics router
 */

export default {
  routes: [
    {
      method: 'GET',
      path: '/statistics/dashboard',
      handler: 'statistics.dashboard',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'GET',
      path: '/statistics/enrollment/:documentId',
      handler: 'statistics.enrollmentStats',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'GET',
      path: '/statistics/employee/:documentId/payroll',
      handler: 'statistics.employeePayrollStats',
      config: {
        policies: [],
        middlewares: [],
      },
    },
  ],
};