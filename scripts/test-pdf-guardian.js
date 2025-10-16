/**
 * Script para probar la generación de PDFs con guardians asociados
 */

const fs = require('fs');
const path = require('path');

async function bootstrap() {
  const { createStrapi, compileStrapi } = require('@strapi/strapi');
  
  const appContext = await compileStrapi();
  const app = await createStrapi(appContext).load();
  app.log.level = 'error';
  
  try {
    await testPdfGeneration();
    console.log('\n✅ Test finalizado');
  } catch (error) {
    console.error('\n❌ Error fatal:', error);
    throw error;
  } finally {
    await app.destroy();
    process.exit(0);
  }
}

const testPdfGeneration = async () => {
  console.log('🧪 Probando generación de PDFs con guardians asociados...');
  
  try {
    // Obtener facturas de enrollment con guardians
    const invoices = await strapi.entityService.findMany('api::invoice.invoice', {
      filters: { 
        invoiceCategory: 'invoice_enrollment'
      },
      populate: {
        enrollment: {
          populate: {
            student: true,
            guardians: true,
            classroom: true,
          },
        },
        guardian: true, // Guardian directo
      },
      limit: 2,
    });

    if (!invoices || invoices.length === 0) {
      console.log('⚠️  No se encontraron facturas de enrollment');
      return;
    }

    console.log(`📋 Encontradas ${invoices.length} facturas de enrollment`);

    for (const invoice of invoices) {
      console.log(`\n📄 Procesando factura: ${invoice.title}`);
      console.log(`   ID: ${invoice.id}`);
      console.log(`   DocumentId: ${invoice.documentId}`);
      
      // Mostrar información del guardian directo
      if (invoice.guardian) {
        console.log(`   🔗 Guardian directo: ${invoice.guardian.name} ${invoice.guardian.lastname} (${invoice.guardian.guardianType})`);
      } else {
        console.log(`   ❌ Sin guardian directo asociado`);
      }
      
      // Mostrar guardians del enrollment
      const enrollmentGuardians = invoice.enrollment?.guardians || [];
      console.log(`   👥 Guardians del enrollment: ${enrollmentGuardians.length}`);
      enrollmentGuardians.forEach((g, i) => {
        console.log(`      ${i + 1}. ${g.name} ${g.lastname} (${g.guardianType})`);
      });

      // Generar PDF
      try {
        console.log(`   📄 Generando PDF...`);
        const pdfResult = await strapi.service('api::reports.reports-pdf').invoiceBuffer(invoice.id);
        
        if (pdfResult && pdfResult.buffer) {
          // Guardar PDF para verificación manual
          const fileName = `test-invoice-${invoice.id}-${Date.now()}.pdf`;
          const filePath = path.join(__dirname, '..', 'temp', fileName);
          
          // Crear directorio temp si no existe
          const tempDir = path.dirname(filePath);
          if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
          }
          
          fs.writeFileSync(filePath, pdfResult.buffer);
          console.log(`   ✅ PDF generado exitosamente: ${fileName}`);
          console.log(`   📁 Guardado en: ${filePath}`);
        } else {
          console.log(`   ❌ Error: No se pudo generar el buffer del PDF`);
        }
      } catch (pdfError) {
        console.log(`   ❌ Error generando PDF: ${pdfError.message}`);
      }
    }

  } catch (error) {
    console.error('❌ Error en el test:', error.message);
  }
};

if (require.main === module) {
  bootstrap().catch((error) => {
    console.error('\n❌ Error fatal:', error);
    process.exit(1);
  });
}

module.exports = { testPdfGeneration };