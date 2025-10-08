"use strict";

/**
 * Seed completo para preparar datos de reportes e facturación:
 * - Company (single type) con NIF declarante
 * - School Period (2024)
 * - 2 Students (Lucas y Marta) con info completa
 * - 3 Guardians (2 principales + 1 adicional)
 * - Services (Guardería, Comedor, Material escolar, Transporte)
 * - 2 Employees (Laura - teacher, Miguel - carer)
 * - 1 Classroom vinculado a Laura
 * - 2 Enrollments (uno por alumno) con servicios, tutores, aula y empleados
 * - Invoices de alumnos (matrícula, comedor, subvenciones/becas/ayudas, otros)
 * - Invoices de empleados (nóminas)
 * - Invoice general sin relación (gasto limpieza)
 *
 * Ejecutar: node scripts/seed-233.js
 */

async function main() {
  const { createStrapi, compileStrapi } = require("@strapi/strapi");

  const appContext = await compileStrapi();
  const app = await createStrapi(appContext).load();
  app.log.level = "error";

  const docs = (uid) => strapi.documents(uid);

  async function findOne(uid, filters) {
    const res = await docs(uid).findMany({ filters, pageSize: 1 });
    if (Array.isArray(res)) return res[0] || null;
    if (Array.isArray(res?.results)) return res.results[0] || null;
    return res?.results || res || null;
  }

  async function upsertSingleCompany(data) {
    const existing = await docs("api::company.company").findMany({ pageSize: 1 });
    let record = Array.isArray(existing?.results) ? existing.results[0] : existing?.results || existing;
    if (record?.id) {
      record = await docs("api::company.company").update({ documentId: record.id, data });
    } else {
      record = await docs("api::company.company").create({ data });
    }
    return record;
  }

  function isoDate(year, month, day) {
    const mm = String(month).padStart(2, "0");
    const dd = String(day).padStart(2, "0");
    return `${year}-${mm}-${dd}T09:00:00.000Z`;
  }

  try {
    // Company (NIF declarante)
    await upsertSingleCompany({
      name: "Guardería Pizquito",
      code: "AUTH-001",
      address: "C/ Mayor 1, Madrid",
      NIF: "B12345678",
      publishedAt: Date.now(),
    });

    // School Period 2024
    let schoolPeriod = await findOne("api::school-period.school-period", { title: { $eq: "Curso 2024" } });
    if (!schoolPeriod) {
      schoolPeriod = await docs("api::school-period.school-period").create({
        data: {
          title: "Curso 2024",
          period: [{ year: "2024", start: "2024-01-01", end: "2024-12-31" }],
          publishedAt: Date.now(),
        },
      });
    }

    // Guardians
    let guardian1 = await findOne("api::guardian.guardian", { NIF: { $eq: "12345678A" } });
    if (!guardian1) {
      guardian1 = await docs("api::guardian.guardian").create({
        data: {
          name: "Ana",
          lastname: "Pérez López",
          NIF: "12345678A",
          DNI: "12345678A",
          address: "Av. Sol 5",
          city: "Madrid",
          postcode: "28001",
          country: "ES",
          publishedAt: Date.now(),
        },
      });
    }

    let guardian2 = await findOne("api::guardian.guardian", { NIF: { $eq: "87654321B" } });
    if (!guardian2) {
      guardian2 = await docs("api::guardian.guardian").create({
        data: {
          name: "Carlos",
          lastname: "García Ruiz",
          NIF: "87654321B",
          DNI: "87654321B",
          address: "Av. Sol 5",
          city: "Madrid",
          postcode: "28001",
          country: "ES",
          publishedAt: Date.now(),
        },
      });
    }

    let guardian3 = await findOne("api::guardian.guardian", { NIF: { $eq: "54321234C" } });
    if (!guardian3) {
      guardian3 = await docs("api::guardian.guardian").create({
        data: {
          name: "María",
          lastname: "Sánchez Vega",
          NIF: "54321234C",
          DNI: "54321234C",
          address: "Av. Sol 5",
          city: "Madrid",
          postcode: "28001",
          country: "ES",
          publishedAt: Date.now(),
        },
      });
    }

    // Students
    let studentLucas = await findOne("api::student.student", { DNI: { $eq: "00000000A" } });
    if (!studentLucas) {
      studentLucas = await docs("api::student.student").create({
        data: {
          name: "Lucas",
          lastname: "García Pérez",
          DNI: "00000000A",
          birthdate: "2020-05-15",
          address: "Av. Sol 5",
          city: "Madrid",
          postcode: "28001",
          country: "ES",
          publishedAt: Date.now(),
        },
      });
    }

    let studentMarta = await findOne("api::student.student", { DNI: { $eq: "00000000B" } });
    if (!studentMarta) {
      studentMarta = await docs("api::student.student").create({
        data: {
          name: "Marta",
          lastname: "López Sánchez",
          DNI: "00000000B",
          birthdate: "2019-10-02",
          address: "Av. Sol 5",
          city: "Madrid",
          postcode: "28001",
          country: "ES",
          publishedAt: Date.now(),
        },
      });
    }

    // Services
    const ensureService = async (title, description, amount) => {
      let svc = await findOne("api::service.service", { title: { $eq: title } });
      if (!svc) {
        svc = await docs("api::service.service").create({
          data: {
            title,
            description,
            amount,
            serviceType: "school_service",
            serviceStatus: "active",
            publishedAt: Date.now(),
          },
        });
      }
      return svc;
    };

    const serviceGuarderia = await ensureService("Guardería", "Cuota mensual", 200);
    const serviceComedor = await ensureService("Comedor", "Servicio de comedor", 120);
    const serviceMaterial = await ensureService("Material escolar", "Cuota de materiales", 50);
    const serviceTransporte = await ensureService("Transporte", "Servicio de transporte escolar", 80);

    // Employees
    let employee1 = await findOne("api::employee.employee", { DNI: { $eq: "11111111C" } });
    if (!employee1) {
      employee1 = await docs("api::employee.employee").create({
        data: {
          name: "Laura",
          lastname: "Fernández Ruiz",
          DNI: "11111111C",
          NIF: "ES11111111C",
          BIC: "BIC11111111",
          SWIFT: "SWIFT11111111",
          role: "teacher",
          phone: "+34 600111111",
          address: "C/ Escuela 10",
          city: "Madrid",
          postcode: "28002",
          country: "ES",
          isActive: true,
          publishedAt: Date.now(),
        },
      });
    }

    let employee2 = await findOne("api::employee.employee", { DNI: { $eq: "22222222D" } });
    if (!employee2) {
      employee2 = await docs("api::employee.employee").create({
        data: {
          name: "Miguel",
          lastname: "López Soto",
          DNI: "22222222D",
          NIF: "ES22222222D",
          BIC: "BIC22222222",
          SWIFT: "SWIFT22222222",
          role: "carer",
          phone: "+34 600222222",
          address: "C/ Escuela 11",
          city: "Madrid",
          postcode: "28003",
          country: "ES",
          isActive: true,
          publishedAt: Date.now(),
        },
      });
    }

    // Classroom
    let classroom = await findOne("api::classroom.classroom", { title: { $eq: "Aula Peques 2024" } });
    if (!classroom) {
      classroom = await docs("api::classroom.classroom").create({
        data: {
          title: "Aula Peques 2024",
          description: "Aula de educación infantil",
          studentLimit: 25,
          classroomStatus: "available",
          employee: employee1.id, // tutora principal
          publishedAt: Date.now(),
        },
      });
    }

    // Enrollments
    let enrollmentLucas = await findOne("api::enrollment.enrollment", { title: { $eq: "Matrícula Lucas 2024" } });
    if (!enrollmentLucas) {
      enrollmentLucas = await docs("api::enrollment.enrollment").create({
        data: {
          title: "Matrícula Lucas 2024",
          description: "Guardería 2024",
          isActive: true,
          student: studentLucas.id,
          // Lucas: Ana (primera), Carlos (segundo)
          guardians: [guardian1.id, guardian2.id],
          services: [serviceGuarderia.id, serviceComedor.id, serviceMaterial.id, serviceTransporte.id],
          school_period: schoolPeriod.id,
          classroom: classroom.id,
          employees: [employee1.id, employee2.id],
          publishedAt: Date.now(),
        },
      });
    }

    let enrollmentMarta = await findOne("api::enrollment.enrollment", { title: { $eq: "Matrícula Marta 2024" } });
    if (!enrollmentMarta) {
      enrollmentMarta = await docs("api::enrollment.enrollment").create({
        data: {
          title: "Matrícula Marta 2024",
          description: "Guardería 2024",
          isActive: true,
          student: studentMarta.id,
          // Marta: María (primera), Carlos (segundo)
          guardians: [guardian3.id, guardian2.id],
          services: [serviceGuarderia.id, serviceComedor.id, serviceMaterial.id],
          school_period: schoolPeriod.id,
          classroom: classroom.id,
          employees: [employee1.id],
          publishedAt: Date.now(),
        },
      });
    }

    // Asegurar relaciones si existían
    try {
      await docs("api::enrollment.enrollment").update({
        documentId: enrollmentLucas.id,
        data: {
          guardians: [guardian1.id, guardian2.id],
          services: [serviceGuarderia.id, serviceComedor.id, serviceMaterial.id, serviceTransporte.id],
          classroom: classroom.id,
          employees: [employee1.id, employee2.id],
        },
      });
    } catch (_) {}
    try {
      await docs("api::enrollment.enrollment").update({
        documentId: enrollmentMarta.id,
        data: {
          guardians: [guardian3.id, guardian2.id],
          services: [serviceGuarderia.id, serviceComedor.id, serviceMaterial.id],
          classroom: classroom.id,
          employees: [employee1.id],
        },
      });
    } catch (_) {}

    // Invoices alumnos
    const invoicesLucas = [
      { title: "Matrícula Lucas 2024", emissionDate: isoDate(2024, 1, 10), amounts: { matricula: 250 }, total: 250 },
      { title: "Comedor Lucas Enero 2024", emissionDate: isoDate(2024, 1, 20), amounts: { comedor: 120, "Subvención comedor": 30 }, total: 150 },
      { title: "Comedor Lucas Febrero 2024", emissionDate: isoDate(2024, 2, 20), amounts: { comedor: 120 }, total: 120 },
      { title: "Comedor Lucas Marzo 2024", emissionDate: isoDate(2024, 3, 20), amounts: { comedor: 120, "Beca comedor": 20 }, total: 140 },
      { title: "Material Lucas Marzo 2024", emissionDate: isoDate(2024, 3, 5), amounts: { material: 50 }, total: 50 },
      { title: "Transporte Lucas Marzo 2024", emissionDate: isoDate(2024, 3, 12), amounts: { transporte: 80 }, total: 80 },
    ];

    const invoicesMarta = [
      { title: "Matrícula Marta 2024", emissionDate: isoDate(2024, 1, 12), amounts: { matricula: 250 }, total: 250 },
      { title: "Comedor Marta Enero 2024", emissionDate: isoDate(2024, 1, 22), amounts: { comedor: 120 }, total: 120 },
      { title: "Comedor Marta Febrero 2024", emissionDate: isoDate(2024, 2, 18), amounts: { comedor: 120, "Ayuda concilia": 15 }, total: 135 },
      { title: "Comedor Marta Marzo 2024", emissionDate: isoDate(2024, 3, 25), amounts: { comedor: 120 }, total: 120 },
      { title: "Material Marta Marzo 2024", emissionDate: isoDate(2024, 3, 6), amounts: { material: 50 }, total: 50 },
    ];

    async function ensureInvoices(enrollmentId, list) {
      for (const inv of list) {
        let exists = null;
        try {
          const res = await strapi.entityService.findMany("api::invoice.invoice", {
            filters: { title: { $eq: inv.title }, enrollment: { id: { $eq: enrollmentId } } },
            limit: 1,
          });
          exists = Array.isArray(res) ? res[0] : res;
        } catch (_) {}
        if (!exists) {
          await docs("api::invoice.invoice").create({
            data: {
              title: inv.title,
              invoiceStatus: "paid",
              invoiceType: "income",
              registeredBy: "system",
              invoiceCategory: "invoice_enrollment",
              total: inv.total,
              IVA: 0,
              emissionDate: inv.emissionDate,
              enrollment: enrollmentId,
              amounts: inv.amounts,
              publishedAt: Date.now(),
            },
          });
        }
      }
    }

    await ensureInvoices(enrollmentLucas.id, invoicesLucas);
    await ensureInvoices(enrollmentMarta.id, invoicesMarta);

    // Invoices empleados
    const employeeInvoices = [
      { title: "Nómina Laura Enero 2024", emissionDate: isoDate(2024, 1, 31), amounts: { salario: 1200 }, total: 1200, employee: employee1.id, invoiceType: "expense" },
      { title: "Nómina Miguel Enero 2024", emissionDate: isoDate(2024, 1, 31), amounts: { salario: 1000 }, total: 1000, employee: employee2.id, invoiceType: "expense" },
    ];

    for (const inv of employeeInvoices) {
      let exists = null;
      try {
        const res = await strapi.entityService.findMany("api::invoice.invoice", {
          filters: { title: { $eq: inv.title }, employee: { id: { $eq: inv.employee } } },
          limit: 1,
        });
        exists = Array.isArray(res) ? res[0] : res;
      } catch (_) {}
      if (!exists) {
        await docs("api::invoice.invoice").create({
          data: {
            title: inv.title,
            invoiceStatus: "paid",
            invoiceType: inv.invoiceType,
            registeredBy: "system",
            invoiceCategory: "invoice_employ",
            total: inv.total,
            IVA: 0,
            emissionDate: inv.emissionDate,
            employee: inv.employee,
            amounts: inv.amounts,
            publishedAt: Date.now(),
          },
        });
      }
    }

    // Invoice general sin relación (gasto limpieza)
    const genTitle = "Gasto limpieza Enero 2024";
    let genExists = await findOne("api::invoice.invoice", { title: { $eq: genTitle } });
    if (!genExists) {
      await docs("api::invoice.invoice").create({
        data: {
          title: genTitle,
          invoiceStatus: "paid",
          invoiceType: "expense",
          registeredBy: "system",
          invoiceCategory: "invoice_general",
          total: 90,
          IVA: 0,
          emissionDate: isoDate(2024, 1, 5),
          amounts: { limpieza: 90 },
          publishedAt: Date.now(),
        },
      });
    }

    console.log(
      "Seed 233 completado: company, school-period, 2 students, 3 guardians, employees, classroom, múltiples services, 2 enrollments, invoices de alumnos y empleados, y factura general."
    );
  } catch (err) {
    console.error("Error en seed-233:", err);
  }

  await app.destroy();
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});