/**
 * Service wrapper for Reports module: PDF generation
 */

import pdfGenerator from "./pdf/pdf-generator";

export default {
  // Generar PDF de recibo y almacenarlo en Strapi
  async invoice(documentId: string) {
    return pdfGenerator.generateInvoicePdf(documentId, "invoice");
  },
  // Generar PDF de nómina y almacenarlo en Strapi
  async payroll(documentId: string) {
    return pdfGenerator.generateInvoicePdf(documentId, "payroll");
  },
  // Generar PDF de servicio y almacenarlo en Strapi
  async service(documentId: string) {
    return pdfGenerator.generateInvoicePdf(documentId, "service");
  },
  // Generar PDF general y almacenarlo en Strapi
  async general(documentId: string) {
    return pdfGenerator.generateInvoicePdf(documentId, "general");
  },
  async invoiceBuffer(documentId: string) {
    return pdfGenerator.generateInvoicePdfBuffer(documentId, "invoice");
  },
  async payrollBuffer(documentId: string) {
    return pdfGenerator.generateInvoicePdfBuffer(documentId, "payroll");
  },
  async serviceBuffer(documentId: string) {
    return pdfGenerator.generateInvoicePdfBuffer(documentId, "service");
  },
  async generalBuffer(documentId: string) {
    return pdfGenerator.generateInvoicePdfBuffer(documentId, "general");
  },
};
