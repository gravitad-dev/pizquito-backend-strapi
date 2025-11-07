// Script de seed para Strapi Pizquito
// Uso: node seed-data.js

const axios = require("axios");

// CONFIGURACIÓN - Puedes modificar estos valores según necesites
const CONFIG = {
  // Cantidad de registros a crear
  students: 500,
  guardians: 1000,
  employees: 20,
  classrooms: 10,
  schoolPeriods: 10,
  services: 6,
  observations: 200,
  enrollments: 200,
  // Activa/desactiva la verificación y ajuste de relaciones tras crear registros
  verifyRelations: true,
  suppliers: 10,
  items: 30,
  movements: 400,
  promotions: 10,
  backups: 0,
  histories: 0,
  invoices: 0,

  // Configuración de la API (STRAPI_URL || localhost)
  apiUrl: process.env.STRAPI_URL || "http://localhost:1337/api",
  authToken: "", // Se obtendrá mediante login

  // Datos de la empresa
  company: {
    name: "Pizquito School",
    code: "PZQ",
    address: "Calle Principal 123, Madrid",
    NIF: "B12345678",
    IBAN: "ES9121000418450200051332",
    BIC: "CAIXESBBXXX",
  },
};

// Credenciales de administrador (modifica según tu configuración)
const ADMIN_CREDENTIALS = {
  identifier: process.env.ADMIN_EMAIL || "benser22@hotmail.com",
  password: process.env.ADMIN_PASSWORD || "Password1",
};

// Datos de ejemplo
const SAMPLE_DATA = {
  // Nombres y apellidos españoles
  firstNames: [
    "Carlos",
    "María",
    "José",
    "Ana",
    "Miguel",
    "Isabel",
    "Francisco",
    "Laura",
    "Antonio",
    "Elena",
    "David",
    "Sara",
    "Javier",
    "Carmen",
    "Daniel",
    "Paula",
  ],
  lastNames: [
    "García",
    "Rodríguez",
    "González",
    "Fernández",
    "López",
    "Martínez",
    "Sánchez",
    "Pérez",
    "Gómez",
    "Martín",
    "Jiménez",
    "Ruiz",
    "Hernández",
    "Díaz",
    "Moreno",
    "Álvarez",
  ],

  // DNIs únicos
  usedDNIs: new Set(),

  // NIFs únicos
  usedNIFs: new Set(),

  // Emails únicos
  usedEmails: new Set(),

  // Ciudades españolas de ejemplo
  cities: [
    "Madrid",
    "Barcelona",
    "Valencia",
    "Sevilla",
    "Zaragoza",
    "Málaga",
    "Bilbao",
    "Valladolid",
    "Murcia",
  ],

  // Tipos de servicios
  serviceTypes: [
    "student_service",
    "employee_service",
    "school_service",
    "other",
  ],
  serviceStatuses: ["active", "inactive", "canceled"],

  // Roles de empleados
  employeeRoles: [
    "director",
    "administrator",
    "teacher",
    "carer",
    "interim",
    "security",
    "janitor",
    "chef",
  ],

  // Nacionalidades
  nationalities: [
    "Española",
    "Colombiana",
    "Mexicana",
    "Argentina",
    "Peruana",
    "Venezolana",
    "Chilena",
    "Ecuatoriana",
  ],

  // Tipos de guardian (deben coincidir con guardianType enum)
  guardianTypes: [
    "biological_parent",
    "adoptive_parent",
    "legal_guardian",
    "other",
  ],

  // Estados de observaciones
  observationStatuses: ["pending", "in_progress", "resolved", "cancelled"],

  // Estados de matrícula
  enrollmentStatuses: ["pending", "confirmed", "cancelled", "completed"],
};

// Función para generar datos únicos
function generateUniqueDNI() {
  let dni;
  do {
    const numbers = Math.floor(10000000 + Math.random() * 90000000);
    const letter = "TRWAGMYFPDXBNJZSQVHLCKE"[numbers % 23];
    dni = `${numbers}${letter}`;
  } while (SAMPLE_DATA.usedDNIs.has(dni));
  SAMPLE_DATA.usedDNIs.add(dni);
  return dni;
}

// Genera un NIF único simple (formato genérico: letra + 8 dígitos)
function generateUniqueNIF() {
  let nif;
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // sin I/O para evitar confusiones
  do {
    const letter = letters[Math.floor(Math.random() * letters.length)];
    const numbers = Math.floor(10000000 + Math.random() * 90000000);
    nif = `${letter}${numbers}`;
  } while (SAMPLE_DATA.usedNIFs.has(nif));
  SAMPLE_DATA.usedNIFs.add(nif);
  return nif;
}

function generateUniqueEmail(base) {
  let email;
  let counter = 1;
  do {
    email =
      counter === 1 ? `${base}@pizquito.com` : `${base}${counter}@pizquito.com`;
    counter++;
  } while (SAMPLE_DATA.usedEmails.has(email));
  SAMPLE_DATA.usedEmails.add(email);
  return email;
}

function getRandomItem(array) {
  return array[Math.floor(Math.random() * array.length)];
}

function getRandomDate(start, end) {
  return new Date(
    start.getTime() + Math.random() * (end.getTime() - start.getTime()),
  )
    .toISOString()
    .split("T")[0];
}

function getRandomCity() {
  return getRandomItem(SAMPLE_DATA.cities);
}

function generatePostcode() {
  // Genera un CP español simple (ej: 28001)
  const province = Math.floor(1 + Math.random() * 52)
    .toString()
    .padStart(2, "0");
  const suffix = Math.floor(1 + Math.random() * 999)
    .toString()
    .padStart(3, "0");
  return `${province}${suffix}`;
}

// Cliente HTTP para Strapi
const strapi = axios.create({
  baseURL: CONFIG.apiUrl,
  headers: {
    "Content-Type": "application/json",
  },
});

// Función para autenticarse
async function authenticate() {
  try {
    console.log("🔐 Autenticando con Strapi...");
    const response = await axios.post("http://localhost:1337/api/auth/local", {
      identifier: ADMIN_CREDENTIALS.identifier,
      password: ADMIN_CREDENTIALS.password,
    });

    const token = response.data.jwt;
    strapi.defaults.headers.common["Authorization"] = `Bearer ${token}`;
    CONFIG.authToken = token;
    console.log("✅ Autenticación exitosa");
    return true;
  } catch (error) {
    console.error(
      "❌ Error de autenticación:",
      error.response?.data || error.message,
    );
    return false;
  }
}

// Función para crear registros
async function createRecord(contentType, data) {
  try {
    const response = await strapi.post(`/${contentType}`, { data });
    // Strapi v5: respuesta con { data: { id, documentId, attributes } }
    return response.data?.data;
  } catch (error) {
    console.error(
      `❌ Error creando ${contentType}:`,
      error.response?.data || error.message,
    );
    return null;
  }
}

// Helpers REST para leer/actualizar y verificar relaciones
async function getRecord(contentTypePlural, id, populate = "*") {
  try {
    const response = await strapi.get(
      `/${contentTypePlural}/${id}?populate=${encodeURIComponent(populate)}`,
    );
    return response.data?.data || null;
  } catch (error) {
    console.warn(
      `⚠️  No se pudo obtener ${contentTypePlural}/${id}:`,
      error.response?.data || error.message,
    );
    return null;
  }
}

async function updateRecord(contentTypePlural, id, data) {
  try {
    const response = await strapi.put(`/${contentTypePlural}/${id}`, { data });
    return response.data?.data || null;
  } catch (error) {
    console.warn(
      `⚠️  No se pudo actualizar ${contentTypePlural}/${id}:`,
      error.response?.data || error.message,
    );
    return null;
  }
}

// Buscar un tutor existente por NIF o DNI para evitar errores de unicidad
async function findGuardianByUnique(NIF, DNI) {
  try {
    const url = `/guardians?filters[$or][0][NIF][$eq]=${encodeURIComponent(
      NIF,
    )}&filters[$or][1][DNI][$eq]=${encodeURIComponent(
      DNI,
    )}&pagination[pageSize]=1`;
    const response = await strapi.get(url);
    const arr = response.data?.data || [];
    return arr[0] || null;
  } catch (error) {
    console.warn(
      `⚠️  No se pudo buscar tutor por NIF/DNI:`,
      error.response?.data || error.message,
    );
    return null;
  }
}

// Versión Document API: usa documentId en la ruta
async function getRecordByDoc(contentTypePlural, documentId, populate = "*") {
  try {
    const response = await strapi.get(
      `/${contentTypePlural}/${documentId}?populate=${encodeURIComponent(populate)}`,
    );
    return response.data?.data || null;
  } catch (error) {
    console.warn(
      `⚠️  No se pudo obtener (doc) ${contentTypePlural}/${documentId}:`,
      error.response?.data || error.message,
    );
    return null;
  }
}

async function updateRecordByDoc(contentTypePlural, documentId, data) {
  try {
    const response = await strapi.put(`/${contentTypePlural}/${documentId}`, {
      data,
    });
    return response.data?.data || null;
  } catch (error) {
    console.warn(
      `⚠️  No se pudo actualizar (doc) ${contentTypePlural}/${documentId}:`,
      error.response?.data || error.message,
    );
    return null;
  }
}

function extractRelationDocIds(populatedRelation) {
  try {
    const arr = populatedRelation?.data;
    if (Array.isArray(arr)) {
      return arr
        .map((r) => r?.documentId || r?.id)
        .filter((v) => typeof v === "string");
    }
  } catch {}
  return [];
}

function extractRelationIds(populatedRelation) {
  // Intenta extraer IDs desde distintas formas comunes de populate
  try {
    const arr = populatedRelation?.data;
    if (Array.isArray(arr)) {
      return arr.map((r) => r?.id).filter((v) => typeof v === "number");
    }
  } catch {}
  return [];
}

// Funciones específicas para cada tipo de contenido
async function createSchoolPeriods() {
  console.log("\n📅 Creando periodos escolares...");
  const periods = [];
  const currentYear = new Date().getFullYear();
  // Creamos periodos dentro del año actual
  const templates = [
    {
      title: `Periodo Escolar ${currentYear} - Primer Semestre`,
      start: `${currentYear}-01-15`,
      end: `${currentYear}-06-30`,
    },
    {
      title: `Periodo Escolar ${currentYear} - Segundo Semestre`,
      start: `${currentYear}-09-01`,
      end: `${currentYear}-12-20`,
    },
  ];
  for (let i = 0; i < CONFIG.schoolPeriods; i++) {
    const t = templates[i % templates.length];
    periods.push({
      title: t.title,
      period: [
        {
          start: t.start,
          end: t.end,
          year: `${currentYear}`,
        },
      ],
    });
  }

  const createdPeriods = [];
  for (const periodData of periods) {
    const period = await createRecord("school-periods", periodData);
    if (period) createdPeriods.push(period);
  }

  console.log(`✅ ${createdPeriods.length} periodos escolares creados`);
  return createdPeriods;
}

async function createServices() {
  console.log("\n🛍️ Creando servicios...");
  const services = [];

  const serviceTemplates = [
    {
      title: "Matrícula Anual",
      description: "Servicio de matrícula anual",
      amount: "50.00",
      serviceType: "student_service",
      serviceStatus: "active",
    },
    {
      title: "Comedor Escolar",
      description: "Servicio de comedor escolar",
      amount: "60.00",
      serviceType: "employee_service",
      serviceStatus: "inactive",
    },
    {
      title: "Transporte",
      description: "Servicio de transporte",
      amount: "70.00",
      serviceType: "school_service",
      serviceStatus: "canceled",
    },
    {
      title: "Actividades Extraescolares",
      description: "Servicio de actividades extraescolares",
      amount: "80.00",
      serviceType: "other",
      serviceStatus: "active",
    },
    {
      title: "Material Escolar",
      description: "Servicio de material escolar",
      amount: "90.00",
      serviceType: "student_service",
      serviceStatus: "inactive",
    },
    {
      title: "Uniforme",
      description: "Servicio de uniforme",
      amount: "100.00",
      serviceType: "employee_service",
      serviceStatus: "canceled",
    },
  ];

  // Crear servicios basados en la configuración, repitiendo templates si es necesario
  for (let i = 0; i < CONFIG.services; i++) {
    const template = serviceTemplates[i % serviceTemplates.length];
    services.push({
      ...template,
      title: `${template.title} ${Math.floor(i / serviceTemplates.length) + 1}`,
    });
  }

  const createdServices = [];
  for (const serviceData of services) {
    const service = await createRecord("services", serviceData);
    if (service) createdServices.push(service);
  }

  console.log(`✅ ${createdServices.length} servicios creados`);
  return createdServices;
}

async function createEmployees() {
  console.log("\n👨‍💼 Creando empleados...");
  const employees = [];

  for (let i = 1; i <= CONFIG.employees; i++) {
    const firstName = getRandomItem(SAMPLE_DATA.firstNames);
    const lastName = getRandomItem(SAMPLE_DATA.lastNames);
    const email = generateUniqueEmail(`employee${i}`);

    employees.push({
      name: firstName,
      lastname: lastName,
      email: email,
      birthdate: getRandomDate(new Date(1960, 0, 1), new Date(1990, 0, 1)),
      DNI: generateUniqueDNI(),
      NIF: `NIF${i.toString().padStart(8, "0")}`,
      BIC: `BIC${i.toString().padStart(4, "0")}`,
      SWIFT: `SWIFT${i.toString().padStart(4, "0")}`,
      profession: getRandomItem([
        "Profesor",
        "Administrativo",
        "Director",
        "Cocinero",
        "Conserje",
      ]),
      role: getRandomItem(SAMPLE_DATA.employeeRoles),
      phone: `+34 6${Math.floor(10000000 + Math.random() * 90000000)}`,
      nationality: getRandomItem(SAMPLE_DATA.nationalities),
      address: `Calle Empleado ${i}, Madrid`,
      country: "España",
      city: getRandomCity(),
      postcode: generatePostcode(),
      terms: [
        {
          title: `Contrato ${i}`,
          description: "Condiciones laborales",
          // Rango que incluye la fecha actual
          // start en los últimos 3 años, end en los próximos 2 años
          start: getRandomDate(
            new Date(new Date().getFullYear() - 3, 0, 1),
            new Date(),
          ),
          end: getRandomDate(
            new Date(),
            new Date(new Date().getFullYear() + 2, 11, 31),
          ),
          workedHours: Number((20 + Math.random() * 20).toFixed(2)),
          hourlyRate: Number((10 + Math.random() * 15).toFixed(2)),
          paymentPeriod: getRandomItem([
            "daily",
            "weekly",
            "biweekly",
            "monthly",
            "annual",
          ]),
          contractDuration: getRandomItem([
            "permanent",
            "temporary",
            "fixedterm",
            "parttime",
            "fulltime",
            "seasonal",
            "internship",
          ]),
        },
      ],
      // additionalAmount como mapa concepto->importe
      additionalAmount: {
        "Plus transporte": Number((10 + Math.random() * 20).toFixed(2)),
        "Bonus rendimiento": Number((Math.random() * 50).toFixed(2)),
      },
    });
  }

  const createdEmployees = [];
  for (const employeeData of employees) {
    const employee = await createRecord("employees", employeeData);
    if (employee) createdEmployees.push(employee);
  }

  console.log(`✅ ${createdEmployees.length} empleados creados`);
  return createdEmployees;
}

async function createClassrooms(employees) {
  console.log("\n🏫 Creando aulas...");
  const classrooms = [];

  const classroomTypes = [
    {
      type: "Infantil",
      limit: 20,
      description: "Aula para educación infantil",
    },
    {
      type: "Primaria",
      limit: 25,
      description: "Aula para educación primaria",
    },
    {
      type: "Secundaria",
      limit: 30,
      description: "Aula para educación secundaria",
    },
    { type: "Música", limit: 15, description: "Aula de música" },
    { type: "Arte", limit: 15, description: "Aula de arte" },
    { type: "Ciencias", limit: 25, description: "Aula de ciencias" },
  ];

  for (let i = 1; i <= CONFIG.classrooms; i++) {
    const classroomType = classroomTypes[(i - 1) % classroomTypes.length];
    classrooms.push({
      title: `Aula ${i} - ${classroomType.type}`,
      studentLimit: classroomType.limit,
      description: classroomType.description,
      // Estado inicial: disponible. Se recalculará tras crear las matrículas según ocupación
      classroomStatus: "available",
      employee: employees?.length
        ? employees[Math.floor(Math.random() * employees.length)].documentId
        : null,
    });
  }

  const createdClassrooms = [];
  for (const classroomData of classrooms) {
    const classroom = await createRecord("classrooms", classroomData);
    if (classroom) createdClassrooms.push(classroom);
  }

  console.log(`✅ ${createdClassrooms.length} aulas creadas`);
  return createdClassrooms;
}

async function createGuardians() {
  console.log("\n👨‍👩‍👧‍👦 Creando tutores...");
  const guardians = [];

  for (let i = 1; i <= CONFIG.guardians; i++) {
    const firstName = getRandomItem(SAMPLE_DATA.firstNames);
    const lastName = getRandomItem(SAMPLE_DATA.lastNames);
    const email = generateUniqueEmail(`guardian${i}`);

    guardians.push({
      name: firstName,
      lastname: lastName,
      mail: email,
      birthdate: getRandomDate(new Date(1970, 0, 1), new Date(1990, 0, 1)),
      DNI: generateUniqueDNI(),
      NIF: generateUniqueNIF(),
      phone: `+34 6${Math.floor(10000000 + Math.random() * 90000000)}`,
      nationality: getRandomItem(SAMPLE_DATA.nationalities),
      address: `Calle Tutor ${i}, Madrid`,
      guardianType: getRandomItem(SAMPLE_DATA.guardianTypes),
      country: "España",
      city: getRandomCity(),
      postcode: generatePostcode(),
    });
  }

  const createdGuardians = [];
  for (const guardianData of guardians) {
    // Evitar errores de unicidad reutilizando si ya existe
    const existing = await findGuardianByUnique(
      guardianData.NIF,
      guardianData.DNI,
    );
    if (existing) {
      console.log(
        `♻️  Tutor existente reutilizado (NIF=${guardianData.NIF}, DNI=${guardianData.DNI})`,
      );
      createdGuardians.push(existing);
      continue;
    }

    const guardian = await createRecord("guardians", guardianData);
    if (guardian) createdGuardians.push(guardian);
  }

  console.log(`✅ ${createdGuardians.length} tutores creados`);
  return createdGuardians;
}

async function createStudents(guardians) {
  console.log("\n🎓 Creando estudiantes...");
  const students = [];

  for (let i = 1; i <= CONFIG.students; i++) {
    const firstName = getRandomItem(SAMPLE_DATA.firstNames);
    const lastName = getRandomItem(SAMPLE_DATA.lastNames);

    // Seleccionar tutores aleatorios para este estudiante (1-2 tutores)
    const studentGuardians = [];
    const numGuardians = Math.floor(Math.random() * 2) + 1;
    for (let j = 0; j < numGuardians && j < guardians.length; j++) {
      const randomGuardian =
        guardians[Math.floor(Math.random() * guardians.length)];
      const gDocId = randomGuardian?.documentId;
      if (gDocId && !studentGuardians.includes(gDocId)) {
        studentGuardians.push(gDocId);
      }
    }

    students.push({
      name: firstName,
      lastname: lastName,
      birthdate: getRandomDate(new Date(2010, 0, 1), new Date(2018, 0, 1)),
      DNI: generateUniqueDNI(),
      nationality: getRandomItem(SAMPLE_DATA.nationalities),
      address: `Calle Estudiante ${i}, Madrid`,
      guardians: studentGuardians?.length
        ? { connect: studentGuardians.map((g) => ({ documentId: g })) }
        : undefined,
      country: "España",
      city: getRandomCity(),
      postcode: generatePostcode(),
      notes: [
        {
          type: "paragraph",
          children: [
            {
              type: "text",
              text: `Notas iniciales del estudiante ${firstName} ${lastName}`,
            },
          ],
        },
      ],
    });
  }

  const createdStudents = [];
  for (const studentData of students) {
    const student = await createRecord("students", studentData);
    if (student) createdStudents.push(student);
  }

  console.log(`✅ ${createdStudents.length} estudiantes creados`);
  return createdStudents;
}

async function createObservations(employees, students, guardians, classrooms) {
  console.log("\n📝 Creando observaciones...");
  const observations = [];

  for (let i = 1; i <= CONFIG.observations; i++) {
    const randomEmployee =
      employees[Math.floor(Math.random() * employees.length)];
    const randomStudent = students[Math.floor(Math.random() * students.length)];
    const randomGuardian =
      guardians[Math.floor(Math.random() * guardians.length)];
    const randomClassroom = classrooms?.length
      ? classrooms[Math.floor(Math.random() * classrooms.length)]
      : null;

    const empDocId = randomEmployee?.documentId;
    const stuDocId = randomStudent?.documentId;
    const guaDocId = randomGuardian?.documentId;
    const claDocId = randomClassroom?.documentId;

    observations.push({
      title: `Observación ${i}`,
      description: `Descripción detallada de la observación número ${i}`,
      employees: empDocId ? { connect: [{ documentId: empDocId }] } : undefined,
      students: stuDocId ? { connect: [{ documentId: stuDocId }] } : undefined,
      guardians: guaDocId ? { connect: [{ documentId: guaDocId }] } : undefined,
      classrooms: claDocId
        ? { connect: [{ documentId: claDocId }] }
        : undefined,
      content: [
        {
          type: "paragraph",
          children: [
            {
              type: "text",
              text: `Contenido de observación ${i} para seguimiento académico`,
            },
          ],
        },
      ],
      date: getRandomDate(new Date(2023, 0, 1), new Date()),
    });
  }

  const createdObservations = [];
  for (const observationData of observations) {
    const observation = await createRecord("observations", observationData);
    if (observation) createdObservations.push(observation);
  }

  console.log(`✅ ${createdObservations.length} observaciones creadas`);
  return createdObservations;
}

async function createEnrollments(
  students,
  schoolPeriods,
  services,
  employees,
  guardians,
  classrooms,
) {
  console.log("\n📋 Creando matrículas...");
  const enrollments = [];

  for (let i = 1; i <= CONFIG.enrollments; i++) {
    const randomStudent = students[Math.floor(Math.random() * students.length)];
    const randomPeriod =
      schoolPeriods[Math.floor(Math.random() * schoolPeriods.length)];

    // Seleccionar servicios aleatorios para esta matrícula (1-3 servicios)
    const enrollmentServices = [];
    const numServices = Math.floor(Math.random() * 3) + 1;
    for (let j = 0; j < numServices && j < services.length; j++) {
      const randomService =
        services[Math.floor(Math.random() * services.length)];
      if (
        randomService &&
        !enrollmentServices.includes(randomService.documentId)
      ) {
        enrollmentServices.push(randomService.documentId);
      }
    }

    const randomClassroom = classrooms?.length
      ? classrooms[Math.floor(Math.random() * classrooms.length)]
      : null;
    const enrollmentEmployees = employees?.length
      ? [employees[Math.floor(Math.random() * employees.length)].documentId]
      : [];
    const enrollmentGuardians = guardians?.length
      ? [guardians[Math.floor(Math.random() * guardians.length)].documentId]
      : [];

    enrollments.push({
      title: `Matrícula ${i}`,
      description: `Matrícula del alumno ${randomStudent?.attributes?.name || ""}`,
      student: randomStudent?.documentId || null,
      school_period: randomPeriod?.documentId || null,
      classroom: randomClassroom?.documentId || null,
      employees: enrollmentEmployees,
      // Conectar tutores legales desde el lado propietario en la creación
      guardians: enrollmentGuardians?.length
        ? { connect: enrollmentGuardians.map((g) => ({ documentId: g })) }
        : undefined,
      services: enrollmentServices,
      // Siempre activa según requerimiento
      isActive: true,
      // additionalAmount como key->value (concepto -> importe)
      additionalAmount: {
        "Materiales extra": Number((10 + Math.random() * 40).toFixed(2)),
      },
    });
  }

  const createdEnrollments = [];
  for (const enrollmentData of enrollments) {
    const enrollment = await createRecord("enrollments", enrollmentData);
    if (enrollment) {
      createdEnrollments.push(enrollment);
      if (CONFIG.verifyRelations) {
        // Verificar y crear relaciones dinámicamente desde el lado propietario
        await fixEnrollmentRelations(enrollment?.documentId, enrollmentData);
      }
    }
  }

  console.log(`✅ ${createdEnrollments.length} matrículas creadas`);
  return createdEnrollments;
}

// Crea vínculos en el lado propietario para garantizar que las relaciones many-to-many se materialicen
async function fixEnrollmentRelations(enrollmentDocId, enrollmentData) {
  try {
    // Student: asegúrate de que la matrícula esté vinculada al estudiante correcto
    if (enrollmentData?.student) {
      const current = await getRecordByDoc("enrollments", enrollmentDocId, "*");
      const currentStudentDocId =
        current?.attributes?.student?.data?.documentId;
      if (currentStudentDocId !== enrollmentData.student) {
        // Intento 1: asignar directamente el documentId del estudiante
        await updateRecordByDoc("enrollments", enrollmentDocId, {
          student: enrollmentData.student,
        });
        // Verificar y si sigue sin estar vinculado, intentar desde el lado Student
        const verify1 = await getRecordByDoc(
          "enrollments",
          enrollmentDocId,
          "*",
        );
        const linked1 = !!verify1?.attributes?.student?.data?.documentId;
        if (!linked1) {
          await updateRecordByDoc("students", enrollmentData.student, {
            enrollments: { connect: [{ documentId: enrollmentDocId }] },
          });
        }
      }
    }
    // Services: owner side suele ser Service.enrollments (manyToMany inversedBy)
    if (Array.isArray(enrollmentData?.services)) {
      for (const serviceDocId of enrollmentData.services) {
        const service = await getRecordByDoc("services", serviceDocId, "*");
        const existingDocIds = extractRelationDocIds(
          service?.attributes?.enrollments,
        );
        const alreadyLinked = existingDocIds?.includes?.(enrollmentDocId);
        if (!alreadyLinked) {
          await updateRecordByDoc("services", serviceDocId, {
            enrollments: { connect: [{ documentId: enrollmentDocId }] },
          });
        }
      }
    }

    // Employees: owner side suele ser Employee.enrollments (manyToMany inversedBy)
    if (Array.isArray(enrollmentData?.employees)) {
      for (const employeeDocId of enrollmentData.employees) {
        const employee = await getRecordByDoc("employees", employeeDocId, "*");
        const existingDocIds = extractRelationDocIds(
          employee?.attributes?.enrollments,
        );
        const alreadyLinked = existingDocIds?.includes?.(enrollmentDocId);
        if (!alreadyLinked) {
          await updateRecordByDoc("employees", employeeDocId, {
            enrollments: { connect: [{ documentId: enrollmentDocId }] },
          });
        }
      }
    }

    // Guardians: owning side es Enrollment.guardians (inversedBy). Aceptar array o estructura { connect: [...] }
    {
      const guardiansArray = Array.isArray(enrollmentData?.guardians)
        ? enrollmentData.guardians
        : Array.isArray(enrollmentData?.guardians?.connect)
          ? enrollmentData.guardians.connect
              .map((g) => g?.documentId)
              .filter((v) => typeof v === "string")
          : [];

      if (guardiansArray.length > 0) {
        // Obtener la matrícula con sus tutores actuales
        const enrollment = await getRecordByDoc(
          "enrollments",
          enrollmentDocId,
          "*",
        );
        const existingGuardians = extractRelationDocIds(
          enrollment?.attributes?.guardians,
        );
        for (const guardianDocId of guardiansArray) {
          const alreadyLinked = existingGuardians?.includes?.(guardianDocId);
          if (!alreadyLinked) {
            await updateRecordByDoc("enrollments", enrollmentDocId, {
              guardians: { connect: [{ documentId: guardianDocId }] },
            });
          }
        }
      }
    }

    // Verificación final
    const enrollment = await getRecordByDoc(
      "enrollments",
      enrollmentDocId,
      "*",
    );
    let sCount =
      extractRelationDocIds(enrollment?.attributes?.services)?.length || 0;
    let eCount =
      extractRelationDocIds(enrollment?.attributes?.employees)?.length || 0;
    let gCount =
      extractRelationDocIds(enrollment?.attributes?.guardians)?.length || 0;
    let studentLinked = !!enrollment?.attributes?.student?.data?.documentId;

    // Fallback: si el estudiante no está vinculado, conecta desde el lado Student
    if (!studentLinked) {
      try {
        const candidateDocId =
          (typeof enrollmentData?.student === "string" &&
            enrollmentData?.student) ||
          enrollmentData?.student?.documentId ||
          enrollment?.attributes?.student?.data?.documentId;
        if (candidateDocId) {
          await updateRecordByDoc("students", candidateDocId, {
            enrollments: { connect: [{ documentId: enrollmentDocId }] },
          });
          const verifyStudent = await getRecordByDoc(
            "enrollments",
            enrollmentDocId,
            "*",
          );
          studentLinked =
            !!verifyStudent?.attributes?.student?.data?.documentId;
        }
      } catch (err) {
        console.warn(
          `⚠️  No se pudo vincular el estudiante para matrícula ${enrollmentDocId}:`,
          err.response?.data || err.message,
        );
      }
    }
    // Si no hay tutores y el estudiante está vinculado, intenta vincular los tutores del estudiante
    if (studentLinked && gCount === 0) {
      try {
        const stuDocId = enrollment?.attributes?.student?.data?.documentId;
        const student = await getRecordByDoc("students", stuDocId, "*");
        const studentGuardianDocIds = extractRelationDocIds(
          student?.attributes?.guardians,
        );
        const toLink = (studentGuardianDocIds || []).slice(0, 2);
        for (const gd of toLink) {
          await updateRecordByDoc("enrollments", enrollmentDocId, {
            guardians: { connect: [{ documentId: gd }] },
          });
        }
        // Recontar
        const verify = await getRecordByDoc(
          "enrollments",
          enrollmentDocId,
          "*",
        );
        const newGCount =
          extractRelationDocIds(verify?.attributes?.guardians)?.length || 0;
        console.log(
          `ℹ️  Matrícula ${enrollmentDocId}: vinculación de tutores desde el estudiante => ${newGCount}`,
        );
      } catch (err) {
        console.warn(
          `⚠️  No se pudo vincular tutores desde el estudiante para matrícula ${enrollmentDocId}:`,
          err.response?.data || err.message,
        );
      }
    }

    // Si no hay empleados vinculados, conecta uno al azar desde el lado Employee
    if (
      eCount === 0 &&
      Array.isArray(enrollmentData?.employees) &&
      enrollmentData.employees.length > 0
    ) {
      try {
        for (const empDocId of enrollmentData.employees.slice(0, 1)) {
          await updateRecordByDoc("employees", empDocId, {
            enrollments: { connect: [{ documentId: enrollmentDocId }] },
          });
        }
      } catch (err) {
        console.warn(
          `⚠️  No se pudo vincular empleado para matrícula ${enrollmentDocId}:`,
          err.response?.data || err.message,
        );
      }
    }

    // Si no hay servicios vinculados, conecta uno al azar desde el lado Service
    if (
      sCount === 0 &&
      Array.isArray(enrollmentData?.services) &&
      enrollmentData.services.length > 0
    ) {
      try {
        for (const svcDocId of enrollmentData.services.slice(0, 1)) {
          await updateRecordByDoc("services", svcDocId, {
            enrollments: { connect: [{ documentId: enrollmentDocId }] },
          });
        }
      } catch (err) {
        console.warn(
          `⚠️  No se pudo vincular servicio para matrícula ${enrollmentDocId}:`,
          err.response?.data || err.message,
        );
      }
    }
    // Recalcular y mostrar estado final
    {
      const final = await getRecordByDoc("enrollments", enrollmentDocId, "*");
      sCount = extractRelationDocIds(final?.attributes?.services)?.length || 0;
      eCount = extractRelationDocIds(final?.attributes?.employees)?.length || 0;
      gCount = extractRelationDocIds(final?.attributes?.guardians)?.length || 0;
      studentLinked = !!final?.attributes?.student?.data?.documentId;
      console.log(
        `🔗 Matrícula ${enrollmentDocId} relaciones tras ajuste => student:${studentLinked ? "yes" : "no"}, services:${sCount}, employees:${eCount}, guardians:${gCount}`,
      );
    }
  } catch (error) {
    console.warn(
      `⚠️  No se pudo verificar/ajustar relaciones de matrícula ${enrollmentDocId}:`,
      error.response?.data || error.message,
    );
  }
}

// Recalcula el estado de cada aula en función de su ocupación (nº de matrículas asignadas vs studentLimit)
async function updateClassroomStatuses(classrooms) {
  try {
    console.log("\n🔄 Actualizando estado de aulas según ocupación...");
    for (const classroom of classrooms || []) {
      const classroomDocId = classroom?.documentId;
      if (!classroomDocId) continue;

      // Obtener el aula completo para conocer el límite de alumnos
      const cls = await getRecordByDoc("classrooms", classroomDocId, "*");
      const limit =
        cls?.attributes?.studentLimit ??
        classroom?.attributes?.studentLimit ??
        0;

      // Contar matrículas asociadas a este aula
      let count = 0;
      try {
        const res = await strapi.get(
          `/enrollments?filters[classroom][documentId][$eq]=${encodeURIComponent(classroomDocId)}&pagination[page]=1&pagination[pageSize]=1`,
        );
        count =
          res?.data?.meta?.pagination?.total ||
          (Array.isArray(res?.data?.data) ? res.data.data.length : 0);
      } catch (error) {
        console.warn(
          `⚠️  No se pudo contar matrículas del aula ${classroomDocId}:`,
          error.response?.data || error.message,
        );
      }

      // Lógica de estado basada en ocupación
      const newStatus = limit > 0 && count >= limit ? "full" : "available";
      const currentStatus = cls?.attributes?.classroomStatus;
      if (currentStatus !== newStatus) {
        await updateRecordByDoc("classrooms", classroomDocId, {
          classroomStatus: newStatus,
        });
      }
    }
    console.log("✅ Estados de aulas actualizados según ocupación");
  } catch (error) {
    console.warn(
      "⚠️  Error actualizando estados de aulas:",
      error.response?.data || error.message,
    );
  }
}

async function createCompany() {
  console.log("\n🏢 Creando empresa...");
  // En Strapi v4, Company es singleType -> endpoint /company y se crea/actualiza con PUT
  try {
    const existing = await strapi.get(`/company`).catch((err) => {
      if (err.response?.status === 404) return null;
      throw err;
    });
    if (existing && existing.data?.data?.id) {
      console.log("ℹ️  La empresa ya existe, actualizando datos");
    } else {
      console.log("ℹ️  La empresa no existe, creando con PUT");
    }
    const res = await strapi.put(`/company`, { data: CONFIG.company });
    console.log(
      "✅ Empresa configurada:",
      res.data?.data?.attributes?.name || CONFIG.company.name,
    );
    return res.data;
  } catch (error) {
    console.log(
      "⚠️  Error al crear/actualizar la empresa:",
      error.response?.data || error.message,
    );
    return null;
  }
}

// Función principal
async function seedData() {
  console.log("🌱 Iniciando proceso de seed...");
  console.log("📊 Configuración actual:", JSON.stringify(CONFIG, null, 2));

  // Autenticarse primero
  const authenticated = await authenticate();
  if (!authenticated) {
    console.log(
      "❌ No se pudo autenticar. Verifica las credenciales y que Strapi esté ejecutándose.",
    );
    return;
  }

  try {
    // Crear datos en el orden correcto (dependencias primero)
    const schoolPeriods = await createSchoolPeriods();
    const services = await createServices();
    const employees = await createEmployees();
    const classrooms = await createClassrooms(employees);
    const guardians = await createGuardians();
    const students = await createStudents(guardians);
    const observations = await createObservations(
      employees,
      students,
      guardians,
      classrooms,
    );
    const enrollments = await createEnrollments(
      students,
      schoolPeriods,
      services,
      employees,
      guardians,
      classrooms,
    );
    // Ajustar el estado de las aulas tras crear las matrículas, para reflejar ocupación real
    await updateClassroomStatuses(classrooms);
    // Inventario & proveedores
    const suppliers = await createSuppliers();
    const items = await createItems(suppliers);
    const movements = await createMovements(items);
    // Promociones, backups e historiales
    const promotions = await createPromotions();
    const backups = await createBackups();
    const histories = await createHistories();
    // Facturas
    const invoices = await createInvoices(
      employees,
      enrollments,
      guardians,
      movements,
      items,
    );
    await createCompany();

    console.log("\n🎉 ¡Proceso de seed completado!");
    console.log("📈 Resumen:");
    console.log(`   • Periodos escolares: ${schoolPeriods?.length || 0}`);
    console.log(`   • Servicios: ${services?.length || 0}`);
    console.log(`   • Empleados: ${employees?.length || 0}`);
    console.log(`   • Aulas: ${classrooms?.length || 0}`);
    console.log(`   • Tutores: ${guardians?.length || 0}`);
    console.log(`   • Estudiantes: ${students?.length || 0}`);
    console.log(`   • Observaciones: ${observations?.length || 0}`);
    console.log(`   • Matrículas: ${enrollments?.length || 0}`);
    console.log(`   • Proveedores: ${suppliers?.length || 0}`);
    console.log(`   • Items: ${items?.length || 0}`);
    console.log(`   • Movimientos: ${movements?.length || 0}`);
    console.log(`   • Promociones: ${promotions?.length || 0}`);
    console.log(`   • Backups: ${backups?.length || 0}`);
    console.log(`   • Historiales: ${histories?.length || 0}`);
    console.log(`   • Facturas: ${invoices?.length || 0}`);
  } catch (error) {
    console.error("❌ Error durante el proceso de seed:", error);
  }
}

// Ejecutar el script
seedData();
async function createSuppliers() {
  console.log("\n🏭 Creando proveedores...");
  const suppliers = [];
  for (let i = 1; i <= CONFIG.suppliers; i++) {
    suppliers.push({
      name: `Proveedor ${i}`,
      contact_name: `Contacto ${i}`,
      phone: `+34 9${Math.floor(10000000 + Math.random() * 90000000)}`,
      email: generateUniqueEmail(`supplier${i}`),
      address: `Calle Proveedor ${i}, ${getRandomCity()}`,
      tax_id: `ES${Math.floor(10000000 + Math.random() * 90000000)}`,
      category: getRandomItem([
        "food",
        "cleaning",
        "stationery",
        "technology",
        "services",
        "furniture",
        "textiles",
        "logistics",
        "other",
      ]),
      notes: "Proveedor de ejemplo",
      isActive: Math.random() < 0.9,
    });
  }
  const created = [];
  for (const data of suppliers) {
    const s = await createRecord("suppliers", data);
    if (s) created.push(s);
  }
  console.log(`✅ ${created.length} proveedores creados`);
  return created;
}

async function createItems(suppliers) {
  console.log("\n📦 Creando items...");
  const items = [];
  for (let i = 1; i <= CONFIG.items; i++) {
    const supplier = suppliers?.length
      ? suppliers[Math.floor(Math.random() * suppliers.length)]
      : null;
    items.push({
      name: `Item ${i}`,
      description: `Descripción del item ${i}`,
      unit: getRandomItem(["unidad", "kg", "litro", "paquete"]),
      price: Number((5 + Math.random() * 95).toFixed(2)),
      stock: Math.floor(10 + Math.random() * 50),
      min_stock: Math.floor(5 + Math.random() * 10),
      supplier: supplier?.documentId || null,
    });
  }
  const created = [];
  for (const data of items) {
    const it = await createRecord("items", data);
    if (it) created.push(it);
  }
  console.log(`✅ ${created.length} items creados`);
  return created;
}

async function createMovements(items) {
  console.log("\n➡️  Creando movimientos de inventario...");
  const movements = [];
  for (let i = 1; i <= CONFIG.movements; i++) {
    const item = items?.length
      ? items[Math.floor(Math.random() * items.length)]
      : null;
    movements.push({
      movementType: getRandomItem(["inbound", "outbound", "adjustment"]),
      quantity: Number((1 + Math.random() * 10).toFixed(2)),
      unit: getRandomItem(["unidad", "kg", "litro", "paquete"]),
      price: Number((1 + Math.random() * 50).toFixed(2)),
      date: new Date().toISOString(),
      notes: `Movimiento ${i} para item ${item?.documentId || "N/A"}`,
      item: item?.documentId || null,
    });
  }
  const created = [];
  for (const data of movements) {
    const mv = await createRecord("movements", data);
    if (mv) created.push(mv);
  }
  console.log(`✅ ${created.length} movimientos creados`);
  return created;
}

async function createPromotions() {
  console.log("\n🏷️  Creando promociones...");
  const promotions = [];
  for (let i = 1; i <= CONFIG.promotions; i++) {
    const start = getRandomDate(
      new Date(new Date().getFullYear(), 0, 1),
      new Date(),
    );
    const end = getRandomDate(
      new Date(),
      new Date(new Date().getFullYear(), 11, 31),
    );
    promotions.push({
      title: `Promoción ${i}`,
      description: `Descripción de la promoción ${i}`,
      discount: Number((5 + Math.random() * 25).toFixed(2)),
      promotionType: getRandomItem(["one_time", "monthly"]),
      isActive: Math.random() < 0.5,
      start,
      end,
    });
  }
  const created = [];
  for (const data of promotions) {
    const p = await createRecord("promotions", data);
    if (p) created.push(p);
  }
  console.log(`✅ ${created.length} promociones creadas`);
  return created;
}

async function createBackups() {
  console.log("\n💾 Creando backups... (omitido en seed)");
  console.log(
    "ℹ️  Se omite la creación de backups desde el seed porque el endpoint /api/backups está personalizado para ejecutar pg_dump/tar.gz y requiere Postgres y binarios del sistema.",
  );
  console.log(
    "   Si quieres probar backups, usa los endpoints del módulo desde Postman: POST /api/backups (crea pg_dump) o GET /api/backups/export/xlsx.",
  );
  return [];
}

async function createHistories() {
  console.log("\n🧾 Creando historiales...");
  const histories = [];
  for (let i = 1; i <= CONFIG.histories; i++) {
    histories.push({
      title: `Evento ${i}`,
      message: `Mensaje del evento ${i}`,
      trace_id: Math.random().toString(36).slice(2),
      timestamp: new Date().toISOString(),
      module: getRandomItem([
        "enrollments",
        "services",
        "inventory",
        "billing",
      ]),
      event_type: getRandomItem(["create", "update", "delete"]),
      level: getRandomItem(["INFO", "WARN", "ERROR", "DEBUG"]),
      status_code: "200",
      duration_ms: `${Math.floor(50 + Math.random() * 300)}`,
      user_id: "admin",
      payload: { example: true },
    });
  }
  const created = [];
  for (const data of histories) {
    const h = await createRecord("histories", data);
    if (h) created.push(h);
  }
  console.log(`✅ ${created.length} historiales creados`);
  return created;
}

async function createInvoices(
  employees,
  enrollments,
  guardians,
  movements,
  items,
) {
  console.log("\n🧾 Creando facturas...");
  const invoices = [];
  for (let i = 1; i <= CONFIG.invoices; i++) {
    const employee = employees?.length
      ? employees[Math.floor(Math.random() * employees.length)]
      : null;
    const enrollment = enrollments?.length
      ? enrollments[Math.floor(Math.random() * enrollments.length)]
      : null;
    const guardian = guardians?.length
      ? guardians[Math.floor(Math.random() * guardians.length)]
      : null;
    const movement = movements?.length
      ? movements[Math.floor(Math.random() * movements.length)]
      : null;
    const item = items?.length
      ? items[Math.floor(Math.random() * items.length)]
      : null;

    const base = Number((50 + Math.random() * 250).toFixed(2));
    const ivaRate = 0.21;
    const iva = Number((base * ivaRate).toFixed(2));
    const total = Number((base + iva).toFixed(2));

    invoices.push({
      title: `Factura ${i}`,
      notes: `Factura de ejemplo ${i}`,
      issuedby: "Administración",
      invoiceStatus: getRandomItem(["unpaid", "inprocess", "paid", "canceled"]),
      invoiceType: getRandomItem(["charge", "payment", "income", "expense"]),
      registeredBy: getRandomItem(["administration", "bank", "system"]),
      invoiceCategory: getRandomItem([
        "invoice_employ",
        "invoice_enrollment",
        "invoice_general",
        "invoice_service",
        "invoice_supplier",
      ]),
      // amounts como mapa concepto->importe para que normalizeInvoiceAmounts lo procese correctamente
      amounts: {
        Base: base,
        IVA: iva,
      },
      total,
      IVA: iva,
      emissionDate: new Date().toISOString(),
      expirationDate: new Date(
        Date.now() + 7 * 24 * 60 * 60 * 1000,
      ).toISOString(),
      employee: employee?.documentId || null,
      enrollment: enrollment?.documentId || null,
      guardian: guardian?.documentId || null,
      movement: movement?.documentId || null,
      item: item?.documentId || null,
    });
  }
  const created = [];
  for (const data of invoices) {
    const inv = await createRecord("invoices", data);
    if (inv) created.push(inv);
  }
  console.log(`✅ ${created.length} facturas creadas`);
  return created;
}
