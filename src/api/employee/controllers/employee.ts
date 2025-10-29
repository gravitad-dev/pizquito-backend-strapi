/**
 * employee controller
 */

import { factories } from '@strapi/strapi'
import ExcelJS from 'exceljs'
import { Context } from 'koa'

export default factories.createCoreController('api::employee.employee', ({ strapi }) => ({
  
  /**
   * Export employee invoice history to Excel
   * GET /api/employees/:documentId/export-invoice-history
   * @param documentId - Identificador de documento del empleado (documentId)
   */
  async exportInvoiceHistory(ctx: Context) {
    strapi.log.warn('DEPRECATED: usa /api/reports/xlsx/invoices/{employees|enrollments|general|services}/:documentId con los mismos query params');
    try {
      const { documentId } = ctx.params
      const { 
        startDate, 
        endDate, 
        status, 
        category = 'invoice_employ' 
      } = ctx.query

      // Validar que el empleado existe usando documentId
      let employee;
      const employeeByDocFilters: any = { documentId: { $eq: documentId } };
      const found = await strapi.entityService.findMany('api::employee.employee', {
        filters: employeeByDocFilters,
        populate: ['profileImage'],
        limit: 1
      });
      employee = found?.[0];

      if (!employee) {
        return ctx.notFound('Empleado no encontrado')
      }

      // Construir filtros para las facturas usando el documentId del empleado
      const filters: any = {
        employee: {
          documentId: {
            $eq: employee.documentId
          }
        }
      }

      // Solo agregar filtro de categoría si se proporciona
      if (category) {
        filters.invoiceCategory = {
          $eq: category
        }
      }

      // Filtros opcionales
      if (startDate || endDate) {
        filters.emissionDate = {}
        if (startDate) filters.emissionDate.$gte = new Date(startDate as string)
        if (endDate) filters.emissionDate.$lte = new Date(endDate as string)
      }

      if (status) {
        filters.invoiceStatus = {
          $eq: status
        }
      }

      strapi.log.info(`Exportando facturas del empleado con documentId ${documentId} (ID interno: ${employee.id}) con filtros:`, JSON.stringify(filters, null, 2))

      // Consultar facturas del empleado
      const invoices = await strapi.entityService.findMany('api::invoice.invoice', {
        filters,
        sort: { emissionDate: 'desc' },
        populate: ['files'],
        limit: 1000 // Límite razonable
      })

      strapi.log.info(`Facturas encontradas: ${invoices.length}`)
      if (invoices.length > 0) {
        strapi.log.info(`Categorías de facturas encontradas:`, invoices.map(inv => inv.invoiceCategory))
      }

      // Generar Excel
      const workbook = new ExcelJS.Workbook()
      const worksheet = workbook.addWorksheet('Historial de Facturas')

      // Configurar metadatos del archivo
      workbook.creator = 'Sistema Pizquito'
      workbook.lastModifiedBy = 'Sistema Pizquito'
      workbook.created = new Date()
      workbook.modified = new Date()

      // Configurar encabezados
      const headers = [
        'ID Factura',
        'Título',
        'Fecha Emisión',
        'Fecha Vencimiento',
        'Estado',
        'Categoría',
        'Tipo',
        'Subtotal',
        'IVA',
        'Total',
        'Origen',
        'Notas'
      ]

      // Agregar encabezados con estilo
      const headerRow = worksheet.addRow(headers)
      headerRow.font = { bold: true, color: { argb: 'FFFFFF' } }
      headerRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: '366092' }
      }

      // Configurar ancho de columnas
      worksheet.columns = [
        { width: 12 }, // ID
        { width: 25 }, // Título
        { width: 15 }, // Fecha Emisión
        { width: 15 }, // Fecha Vencimiento
        { width: 12 }, // Estado
        { width: 15 }, // Categoría
        { width: 12 }, // Tipo
        { width: 12 }, // Subtotal
        { width: 10 }, // IVA
        { width: 12 }, // Total
        { width: 15 }, // Origen
        { width: 25 }  // Notas
      ]

      // Agregar datos de las facturas
      let totalAmount = 0
      let totalIVA = 0

      // Mapas de traducción para valores en inglés a etiquetas amigables en español
      const statusMap: Record<string, string> = {
        unpaid: 'Pendiente',
        inprocess: 'En proceso',
        paid: 'Pagada',
        canceled: 'Cancelada'
      }
      const categoryMap: Record<string, string> = {
        invoice_employ: 'Nómina empleado',
        invoice_enrollment: 'Matrícula',
        invoice_general: 'General',
        invoice_service: 'Servicio'
      }
      const typeMap: Record<string, string> = {
        charge: 'Cargo',
        payment: 'Pago',
        income: 'Ingreso',
        expense: 'Gasto'
      }
      const registeredByMap: Record<string, string> = {
        administration: 'Administración',
        bank: 'Banco',
        system: 'Sistema'
      }

      for (const invoice of invoices) {
        const invoiceTotal = parseFloat(String(invoice.total || '0'))
        const invoiceIVA = parseFloat(String(invoice.IVA || '0'))
        const subtotal = invoiceTotal - invoiceIVA
        totalAmount += invoiceTotal
        totalIVA += invoiceIVA

        const row = worksheet.addRow([
          invoice.id,
          invoice.title || '',
          invoice.emissionDate ? new Date(invoice.emissionDate).toLocaleDateString('es-ES') : '',
          invoice.expirationDate ? new Date(invoice.expirationDate).toLocaleDateString('es-ES') : '',
          statusMap[invoice.invoiceStatus || ''] || (invoice.invoiceStatus || ''),
          categoryMap[invoice.invoiceCategory || ''] || (invoice.invoiceCategory || ''),
          typeMap[invoice.invoiceType || ''] || (invoice.invoiceType || ''),
          subtotal.toFixed(2),
          invoiceIVA.toFixed(2),
          invoiceTotal.toFixed(2),
          registeredByMap[invoice.registeredBy || ''] || (invoice.registeredBy || ''),
          invoice.notes || ''
        ])

        // Alternar colores de filas
        if (worksheet.rowCount % 2 === 0) {
          row.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'F8F9FA' }
          }
        }
      }

      // Agregar fila de totales
      if (invoices.length > 0) {
        worksheet.addRow([]) // Fila vacía
        const totalRow = worksheet.addRow([
          '', '', '', '', '', '', 'TOTALES:',
          (totalAmount - totalIVA).toFixed(2),
          totalIVA.toFixed(2),
          totalAmount.toFixed(2),
          '', ''
        ])
        totalRow.font = { bold: true }
        totalRow.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'E3F2FD' }
        }
      }

      // Agregar información del empleado en la parte superior
      worksheet.insertRow(1, [])
      worksheet.insertRow(1, [`Empleado: ${employee.name} ${employee.lastname}`])
      worksheet.insertRow(2, [`DNI: ${employee.DNI || 'N/A'}`])
      worksheet.insertRow(3, [`Email: ${employee.email || 'N/A'}`])
      worksheet.insertRow(4, [`Fecha de exportación: ${new Date().toLocaleDateString('es-ES')}`])
      worksheet.insertRow(5, [])

      // Estilo para la información del empleado
      for (let i = 1; i <= 4; i++) {
        const row = worksheet.getRow(i)
        row.font = { bold: true }
      }

      // Configurar respuesta HTTP
      const fileName = `historial_facturas_${employee.name}_${employee.lastname}_${new Date().toISOString().split('T')[0]}.xlsx`
      
      ctx.set({
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Access-Control-Expose-Headers': 'Content-Disposition'
      })

      // Escribir el archivo Excel al response
      const buffer = await workbook.xlsx.writeBuffer()
      ctx.body = buffer

      // Log de la operación
      strapi.log.info(`📊 Excel generado: ${fileName} - ${invoices.length} facturas`)

    } catch (error) {
      strapi.log.error('❌ Error generando Excel de facturas:', error)
      return ctx.internalServerError('Error generando el archivo Excel')
    }
  }

}));
