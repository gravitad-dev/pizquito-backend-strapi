/**
 * Service wrapper for Reports module: PDF generation
 */

import pdfGenerator from './pdf/pdf-generator';

export default {
  async invoice(id: number) {
    return pdfGenerator.generateInvoicePdf(id);
  },
  async payroll(id: number) {
    // Payrolls are backed by employee invoices (invoice_employ)
    return pdfGenerator.generateInvoicePdf(id);
  },
  async service(id: number) {
    // Service invoices are backed by service invoices (invoice_service)
    return pdfGenerator.generateInvoicePdf(id);
  },
  async general(id: number) {
    // General invoices are backed by general invoices (invoice_general)
    return pdfGenerator.generateInvoicePdf(id);
  },
  async invoiceBuffer(id: number) {
    return pdfGenerator.generateInvoicePdfBuffer(id);
  },
  async payrollBuffer(id: number) {
    return pdfGenerator.generateInvoicePdfBuffer(id);
  },
  async serviceBuffer(id: number) {
    return pdfGenerator.generateInvoicePdfBuffer(id);
  },
  async generalBuffer(id: number) {
    return pdfGenerator.generateInvoicePdfBuffer(id);
  },
};