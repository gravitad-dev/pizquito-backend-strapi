/**
 * Custom routes for Modelo 233 (preview & generate)
 */

export default {
  routes: [
    {
      method: "GET",
      path: "/fiscal-report/233/preview",
      handler: "report-233.preview",
      config: {
        policies: [],
      },
    },
    {
      method: "POST",
      path: "/fiscal-report/233/generate",
      handler: "report-233.generate",
      config: {
        policies: [],
      },
    },
  ],
};
