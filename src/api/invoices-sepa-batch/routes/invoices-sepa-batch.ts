export default {
  routes: [
    {
      method: "POST",
      path: "/invoices/sepa/batch/enrollments",
      handler: "invoices-sepa-batch.generateEnrollments",
      config: { policies: [] },
    },
    {
      method: "POST",
      path: "/invoices/sepa/batch/employees",
      handler: "invoices-sepa-batch.generateEmployees",
      config: { policies: [] },
    },
  ],
};