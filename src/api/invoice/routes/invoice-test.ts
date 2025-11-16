export default {
  routes: [
    {
      method: "POST",
      path: "/invoices/test/generate-year",
      handler: "invoice-test.generateYear",
      config: {
        policies: [],
        middlewares: [],
      },
    },
    {
      method: "DELETE",
      path: "/invoices/test/cleanup",
      handler: "invoice-test.cleanup",
      config: {
        policies: [],
        middlewares: [],
      },
    },
    {
      method: "GET",
      path: "/invoices/test/status",
      handler: "invoice-test.status",
      config: {
        policies: [],
        middlewares: [],
      },
    },
  ],
};
