/**
 * Service wrapper for Reports module: PDF generation
 */

import pdfGenerator from './pdf/pdf-generator';

export default {
  async invoice(id: number) {
    return pdfGenerator.generateInvoicePdf(id, 'invoice');
  },
  async payroll(id: number) {
    // Payrolls are backed by employee invoices (invoice_employ)
    return pdfGenerator.generateInvoicePdf(id, 'payroll');
  },
  async service(id: number) {
    // Service invoices are backed by service invoices (invoice_service)
    return pdfGenerator.generateInvoicePdf(id, 'service');
  },
  async general(id: number) {
    // General invoices are backed by general invoices (invoice_general)
    return pdfGenerator.generateInvoicePdf(id, 'general');
  },
  async invoiceBuffer(id: number) {
    return pdfGenerator.generateInvoicePdfBuffer(id, 'invoice');
  },
  async payrollBuffer(id: number) {
    return pdfGenerator.generateInvoicePdfBuffer(id, 'payroll');
  },
  async serviceBuffer(id: number) {
    return pdfGenerator.generateInvoicePdfBuffer(id, 'service');
  },
  async generalBuffer(id: number) {
    return pdfGenerator.generateInvoicePdfBuffer(id, 'general');
  },
};