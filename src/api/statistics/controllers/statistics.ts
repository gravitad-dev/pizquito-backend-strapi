/**
 * Statistics controller
 */

export default {
  /**
   * Dashboard statistics endpoint
   * Returns comprehensive statistics for the dashboard
   */
  async dashboard(ctx) {
    try {
      const data = await strapi.service('api::statistics.statistics').getDashboardStats();
      ctx.body = {
        data,
        meta: {
          timestamp: new Date().toISOString(),
          endpoint: 'dashboard'
        }
      };
    } catch (error) {
      ctx.throw(500, `Error fetching dashboard statistics: ${error.message}`);
    }
  },

  /**
   * Enrollment statistics endpoint
   * Returns statistics for a specific enrollment by documentId
   */
  async enrollmentStats(ctx) {
    try {
      const { documentId } = ctx.params;
      
      if (!documentId) {
        return ctx.throw(400, 'DocumentId is required');
      }

      const data = await strapi.service('api::statistics.statistics').getEnrollmentStats(documentId);
      
      if (!data) {
        return ctx.throw(404, 'Enrollment not found');
      }

      ctx.body = {
        data,
        meta: {
          timestamp: new Date().toISOString(),
          endpoint: 'enrollmentStats',
          documentId
        }
      };
    } catch (error) {
      ctx.throw(500, `Error fetching enrollment statistics: ${error.message}`);
    }
  },

  /**
   * Employee payroll statistics endpoint
   * Returns payroll statistics for a specific employee by documentId
   */
  async employeePayrollStats(ctx) {
    try {
      const { documentId } = ctx.params;
      
      if (!documentId) {
        return ctx.throw(400, 'DocumentId is required');
      }

      const data = await strapi.service('api::statistics.statistics').getEmployeePayrollStats(documentId);
      
      if (!data) {
        return ctx.throw(404, 'Employee not found');
      }

      ctx.body = {
        data,
        meta: {
          timestamp: new Date().toISOString(),
          endpoint: 'employeePayrollStats',
          documentId
        }
      };
    } catch (error) {
      ctx.throw(500, `Error fetching employee payroll statistics: ${error.message}`);
    }
  }
};