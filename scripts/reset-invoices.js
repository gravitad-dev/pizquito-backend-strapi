/**
 * Script para limpiar todas las facturas existentes y crear facturas de prueba
 * Crea: 2 enrollment, 2 empleados, 1 service, 1 general
 */

// Tasa de IVA (21% en España)
const IVA_RATE = 0.21;

/**
 * Calcula el IVA y el total con IVA incluido
 */
const calculateIVA = (subtotal) => {
  const iva = Math.round(subtotal * IVA_RATE * 100) / 100;
  const total = Math.round((subtotal + iva) * 100) / 100;
  return { iva, total };
};

/**
 * Genera una fecha ISO para el mes/año especificado
 */
const isoDate = (year, month, day = 1) => {
  return new Date(year, month - 1, day).toISOString();
};

/**
 * Obtiene el primer enrollment activo disponible
 */
const getFirstEnrollment = async () => {
  const enrollments = await strapi.entityService.findMany('api::enrollment.enrollment', {
    filters: { isActive: true },
    populate: { student: true },
    limit: 1,
  });
  return Array.isArray(enrollments) ? enrollments[0] : enrollments;
};

/**
 * Obtiene el segundo enrollment activo disponible
 */
const getSecondEnrollment = async () => {
  const enrollments = await strapi.entityService.findMany('api::enrollment.enrollment', {
    filters: { isActive: true },
    populate: { student: true },
    limit: 2,
  });
  const list = Array.isArray(enrollments) ? enrollments : [enrollments];
  return list.length > 1 ? list[1] : list[0]; // Fallback al primero si solo hay uno
};

/**
 * Obtiene el primer empleado activo disponible
 */
const getFirstEmployee = async () => {
  const employees = await strapi.entityService.findMany('api::employee.employee', {
    filters: { isActive: true },
    limit: 1,
  });
  return Array.isArray(employees) ? employees[0] : employees;
};

/**
 * Obtiene el segundo empleado activo disponible
 */
const getSecondEmployee = async () => {
  const employees = await strapi.entityService.findMany('api::employee.employee', {
    filters: { isActive: true },
    limit: 2,
  });
  const list = Array.isArray(employees) ? employees : [employees];
  return list.length > 1 ? list[1] : list[0]; // Fallback al primero si solo hay uno
};

/**
 * Obtiene el guardian principal de un enrollment
 * Prioriza por guardianType: biological_parent > adoptive_parent > legal_guardian > other
 */
const getPrimaryGuardianFromEnrollment = async (enrollmentId) => {
  const enrollment = await strapi.entityService.findOne(
    'api::enrollment.enrollment', 
    enrollmentId, 
    { populate: { guardians: true } }
  );
  
  const guardians = enrollment?.guardians || [];
  if (guardians.length === 0) return null;
  
  // Orden de prioridad para seleccionar guardian responsable
  const priorityOrder = ['biological_parent', 'adoptive_parent', 'legal_guardian', 'other'];
  
  // Ordenar guardians por prioridad de tipo
  const sortedGuardians = guardians.sort((a, b) => {
    const aPriority = priorityOrder.indexOf(a.guardianType) !== -1 
      ? priorityOrder.indexOf(a.guardianType) 
      : 999;
    const bPriority = priorityOrder.indexOf(b.guardianType) !== -1 
      ? priorityOrder.indexOf(b.guardianType) 
      : 999;
    return aPriority - bPriority;
  });
  
  return sortedGuardians[0];
};

/**
 * Elimina todas las facturas existentes
 */
const deleteAllInvoices = async () => {
  console.log('🗑️  Eliminando todas las facturas existentes...');
  
  const invoices = await strapi.entityService.findMany('api::invoice.invoice', {
    limit: 10000, // Obtener todas
  });
  
  const invoiceList = Array.isArray(invoices) ? invoices : [invoices].filter(Boolean);
  
  for (const invoice of invoiceList) {
    try {
      await strapi.entityService.delete('api::invoice.invoice', invoice.id);
    } catch (error) {
      console.error(`Error eliminando factura ${invoice.id}:`, error.message);
    }
  }
  
  console.log(`✅ Eliminadas ${invoiceList.length} facturas`);
};

/**
 * Crea facturas de enrollment (matrículas)
 */
const createEnrollmentInvoices = async () => {
  console.log('📚 Creando facturas de enrollment...');
  
  const enrollment1 = await getFirstEnrollment();
  const enrollment2 = await getSecondEnrollment();
  
  if (!enrollment1) {
    console.log('⚠️  No se encontraron enrollments activos para crear facturas');
    return;
  }
  
  // Obtener guardian principal para enrollment1
  const primaryGuardian1 = await getPrimaryGuardianFromEnrollment(enrollment1.id);
  
  // Factura 1: Matrícula
  const matriculaAmount = 250;
  const { iva: ivaMatricula, total: totalMatricula } = calculateIVA(matriculaAmount);
  
  const matriculaInvoiceData = {
    title: `Matrícula ${enrollment1.student?.name || 'Estudiante'} - ${new Date().getFullYear()}`,
    invoiceCategory: 'invoice_enrollment',
    invoiceType: 'charge',
    invoiceStatus: 'unpaid',
    registeredBy: 'administration',
    issuedby: 'Administración',
    enrollment: enrollment1.id,
    emissionDate: isoDate(2024, 12, 1),
    expirationDate: isoDate(2024, 12, 31),
    amounts: { matricula: matriculaAmount },
    total: totalMatricula,
    IVA: ivaMatricula,
    notes: 'Factura de matrícula generada por script de prueba',
    publishedAt: new Date().toISOString(),
  };
  
  // Asociar guardian si existe
  if (primaryGuardian1) {
    matriculaInvoiceData.guardian = primaryGuardian1.id;
    console.log(`🔗 Asociando factura de matrícula con guardian: ${primaryGuardian1.name} ${primaryGuardian1.lastname}`);
  }
  
  await strapi.entityService.create('api::invoice.invoice', {
    data: matriculaInvoiceData,
  });
  
  // Factura 2: Comedor (usar enrollment2 si existe, sino enrollment1)
  const targetEnrollment = enrollment2 || enrollment1;
  const primaryGuardian2 = await getPrimaryGuardianFromEnrollment(targetEnrollment.id);
  
  const comedorAmount = 120;
  const { iva: ivaComedor, total: totalComedor } = calculateIVA(comedorAmount);
  
  const comedorInvoiceData = {
    title: `Comedor ${targetEnrollment.student?.name || 'Estudiante'} - Diciembre 2024`,
    invoiceCategory: 'invoice_enrollment',
    invoiceType: 'charge',
    invoiceStatus: 'paid',
    registeredBy: 'administration',
    issuedby: 'Administración',
    enrollment: targetEnrollment.id,
    emissionDate: isoDate(2024, 12, 15),
    expirationDate: isoDate(2024, 12, 31),
    amounts: { comedor: comedorAmount },
    total: totalComedor,
    IVA: ivaComedor,
    notes: 'Factura de comedor generada por script de prueba',
    publishedAt: new Date().toISOString(),
  };
  
  // Asociar guardian si existe
  if (primaryGuardian2) {
    comedorInvoiceData.guardian = primaryGuardian2.id;
    console.log(`🔗 Asociando factura de comedor con guardian: ${primaryGuardian2.name} ${primaryGuardian2.lastname}`);
  }
  
  await strapi.entityService.create('api::invoice.invoice', {
    data: comedorInvoiceData,
  });
  
  console.log('✅ Creadas 2 facturas de enrollment con guardians asociados');
};

/**
 * Crea facturas de empleados (nóminas)
 */
const createEmployeeInvoices = async () => {
  console.log('👥 Creando facturas de empleados...');
  
  const employee1 = await getFirstEmployee();
  const employee2 = await getSecondEmployee();
  
  if (!employee1) {
    console.log('⚠️  No se encontraron empleados activos para crear facturas');
    return;
  }
  
  // Nómina 1
  const salary1 = 1200;
  const { iva: iva1, total: total1 } = calculateIVA(salary1);
  
  await strapi.entityService.create('api::invoice.invoice', {
    data: {
      title: `Nómina ${employee1.name || 'Empleado'} ${employee1.lastname || ''} - Diciembre 2024`,
      invoiceCategory: 'invoice_employ',
      invoiceType: 'expense',
      invoiceStatus: 'paid',
      registeredBy: 'administration',
      issuedby: 'Administración',
      employee: employee1.id,
      emissionDate: isoDate(2024, 12, 31),
      expirationDate: isoDate(2025, 1, 15),
      amounts: { salario: salary1 },
      total: total1,
      IVA: iva1,
      notes: 'Nómina generada por script de prueba',
      publishedAt: new Date().toISOString(),
    },
  });
  
  // Nómina 2 (usar employee2 si existe, sino employee1)
  const targetEmployee = employee2 || employee1;
  const salary2 = 1000;
  const { iva: iva2, total: total2 } = calculateIVA(salary2);
  
  await strapi.entityService.create('api::invoice.invoice', {
    data: {
      title: `Nómina ${targetEmployee.name || 'Empleado'} ${targetEmployee.lastname || ''} - Noviembre 2024`,
      invoiceCategory: 'invoice_employ',
      invoiceType: 'expense',
      invoiceStatus: 'unpaid',
      registeredBy: 'administration',
      issuedby: 'Administración',
      employee: targetEmployee.id,
      emissionDate: isoDate(2024, 11, 30),
      expirationDate: isoDate(2024, 12, 15),
      amounts: { salario: salary2 },
      total: total2,
      IVA: iva2,
      notes: 'Nómina generada por script de prueba',
      publishedAt: new Date().toISOString(),
    },
  });
  
  console.log('✅ Creadas 2 facturas de empleados');
};

/**
 * Crea factura de servicio
 */
const createServiceInvoice = async () => {
  console.log('🔧 Creando factura de servicio...');
  
  const serviceAmount = 350;
  const { iva, total } = calculateIVA(serviceAmount);
  
  await strapi.entityService.create('api::invoice.invoice', {
    data: {
      title: 'Mantenimiento Sistema Informático - Diciembre 2024',
      invoiceCategory: 'invoice_service',
      invoiceType: 'expense',
      invoiceStatus: 'unpaid',
      registeredBy: 'administration',
      issuedby: 'Administración',
      emissionDate: isoDate(2024, 12, 10),
      expirationDate: isoDate(2024, 12, 25),
      amounts: { 
        'Mantenimiento hardware': 200,
        'Actualización software': 150
      },
      total,
      IVA: iva,
      notes: 'Factura de servicio técnico generada por script de prueba',
      publishedAt: new Date().toISOString(),
    },
  });
  
  console.log('✅ Creada 1 factura de servicio');
};

/**
 * Crea factura general
 */
const createGeneralInvoice = async () => {
  console.log('📄 Creando factura general...');
  
  const generalAmount = 85;
  const { iva, total } = calculateIVA(generalAmount);
  
  await strapi.entityService.create('api::invoice.invoice', {
    data: {
      title: 'Material de Limpieza - Diciembre 2024',
      invoiceCategory: 'invoice_general',
      invoiceType: 'expense',
      invoiceStatus: 'paid',
      registeredBy: 'administration',
      issuedby: 'Administración',
      emissionDate: isoDate(2024, 12, 5),
      expirationDate: isoDate(2024, 12, 20),
      amounts: { 
        'Productos limpieza': 60,
        'Material higiene': 25
      },
      total,
      IVA: iva,
      notes: 'Factura general de suministros generada por script de prueba',
      publishedAt: new Date().toISOString(),
    },
  });
  
  console.log('✅ Creada 1 factura general');
};

/**
 * Función principal
 */
const main = async () => {
  console.log('🚀 Iniciando script de reset de facturas...\n');
  
  try {
    // 1. Eliminar todas las facturas existentes
    await deleteAllInvoices();
    console.log('');
    
    // 2. Crear nuevas facturas de prueba
    await createEnrollmentInvoices();
    await createEmployeeInvoices();
    await createServiceInvoice();
    await createGeneralInvoice();
    
    console.log('\n🎉 Script completado exitosamente!');
    console.log('📊 Resumen:');
    console.log('   - 2 facturas de enrollment (matrícula y comedor)');
    console.log('   - 2 facturas de empleados (nóminas)');
    console.log('   - 1 factura de servicio (mantenimiento)');
    console.log('   - 1 factura general (material limpieza)');
    console.log('   - Total: 6 facturas creadas');
    
  } catch (error) {
    console.error('❌ Error ejecutando el script:', error);
    throw error;
  }
};

// Ejecutar el script
async function bootstrap() {
  const { createStrapi, compileStrapi } = require('@strapi/strapi');
  
  const appContext = await compileStrapi();
  const app = await createStrapi(appContext).load();
  app.log.level = 'error';
  
  try {
    await main();
    console.log('\n✅ Script finalizado');
  } catch (error) {
    console.error('\n❌ Error fatal:', error);
    throw error;
  } finally {
    await app.destroy();
    process.exit(0);
  }
}

if (require.main === module) {
  bootstrap().catch((error) => {
    console.error('\n❌ Error fatal:', error);
    process.exit(1);
  });
}

module.exports = { main };