/**
 * Service wrapper for Reports module: Modelo 233
 * Reuses the existing fiscal-report service to avoid duplicating logic
 */

import fiscal233Service from './fiscal-reports/report-233';

export default {
  preview: (params: any) => fiscal233Service.preview(params),
  generate: (params: any) => fiscal233Service.generate(params),
};