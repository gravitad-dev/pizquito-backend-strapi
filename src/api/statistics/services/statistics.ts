/**
 * Statistics service
 */

import { normalizeInvoiceAmounts } from "../../../utils/cron/invoice-amounts";

const statisticsService = {
  /**
   * Get comprehensive dashboard statistics
   */
  async getDashboardStats() {
    const [
      dashboardSummary,
      ageDistribution,
      classroomCapacity,
      enrollmentPaymentStats,
      employeePaymentStats,
      generalPaymentStats,
      upcomingInvoices,
      recentEnrollments,
      recentStudents,
      monthlyStats,
      enrollmentConceptDistribution,
      enrollmentConceptsQuarterly,
      enrollmentMatriculaMonthly,
    ] = await Promise.all([
      statisticsService.getDashboardSummary(),
      statisticsService.getStudentAgeDistribution(),
      statisticsService.getClassroomCapacityStats(),
      statisticsService.getEnrollmentPaymentStats(),
      statisticsService.getEmployeePaymentStats(),
      statisticsService.getGeneralPaymentStats(),
      statisticsService.getUpcomingInvoices(),
      statisticsService.getRecentEnrollments(),
      statisticsService.getRecentStudents(),
      statisticsService.getMonthlyStats(),
      statisticsService.getEnrollmentConceptDistribution(),
      statisticsService.getEnrollmentConceptsQuarterly(),
      statisticsService.getEnrollmentMatriculaMonthly(),
    ]);

    return {
      summary: dashboardSummary,
      ageDistribution,
      classroomCapacity,
      paymentStats: {
        enrollments: enrollmentPaymentStats,
        employees: employeePaymentStats,
        general: generalPaymentStats,
      },
      recent: {
        upcomingInvoices,
        enrollments: recentEnrollments,
        students: recentStudents,
      },
      monthlyStats,
      enrollmentConceptsDistribution: enrollmentConceptDistribution,
      enrollmentConceptsQuarterly,
      enrollmentMatriculaMonthly,
    };
  },

  /**
   * Get statistics for a specific enrollment
   */
  async getEnrollmentStats(documentId: string) {
    // Primero, intenta obtener la matrícula usando el Document Service por documentId
    // Esto es más fiable en Strapi v5 para contenidos con Draft & Publish y i18n
    let enrollment: any = null;
    try {
      enrollment = await strapi
        .documents("api::enrollment.enrollment")
        .findOne({
          documentId,
          status: "published",
          populate: {
            invoices: true,
          },
        });
      // Si la versión publicada no existe, intenta con borrador
      if (!enrollment) {
        enrollment = await strapi
          .documents("api::enrollment.enrollment")
          .findOne({
            documentId,
            status: "draft",
            populate: {
              invoices: true,
            },
          });
      }
    } catch (err) {
      // Ignora y prueba el fallback por uid abajo
    }

    // Fallback: buscar por uid si el documentId no encuentra resultados
    if (!enrollment) {
      const enrollmentsByUid = (await strapi.entityService.findMany(
        "api::enrollment.enrollment",
        {
          filters: { uid: { $eq: documentId } },
          populate: ["invoices"],
          limit: 1,
        } as any,
      )) as any[];
      enrollment = enrollmentsByUid?.[0];
    }

    if (!enrollment) {
      return null;
    }

    const invoices = enrollment.invoices || [];

    const totalInvoices = invoices.length;
    const totalAmount = invoices.reduce(
      (sum, invoice) => sum + (parseFloat(String(invoice.total)) || 0),
      0,
    );
    const paidInvoices = invoices.filter(
      (invoice) => invoice.invoiceStatus === "paid",
    ).length;
    const pendingInvoices = invoices.filter(
      (invoice) => invoice.invoiceStatus === "unpaid",
    ).length;

    return {
      enrollmentId: documentId,
      enrollmentTitle: enrollment.title,
      invoiceStats: {
        totalInvoices,
        totalAmount: parseFloat(totalAmount.toFixed(2)),
        paidInvoices,
        pendingInvoices,
      },
    };
  },

  /**
   * Get payroll statistics for a specific employee
   */
  async getEmployeePayrollStats(documentId: string) {
    // Primero, intenta obtener el empleado usando el Document Service por documentId
    let employee: any = null;
    try {
      employee = await strapi.documents("api::employee.employee").findOne({
        documentId,
        status: "published",
        populate: {
          invoices: true,
        },
      });
      // Si la versión publicada no existe, intenta con borrador
      if (!employee) {
        employee = await strapi.documents("api::employee.employee").findOne({
          documentId,
          status: "draft",
          populate: {
            invoices: true,
          },
        });
      }
    } catch (err) {
      // Ignora y prueba el fallback por uid abajo
    }

    // Fallback: buscar por uid si el documentId no encuentra resultados
    if (!employee) {
      const employeesByUid = (await strapi.entityService.findMany(
        "api::employee.employee",
        {
          filters: { uid: { $eq: documentId } },
          populate: ["invoices"],
          limit: 1,
        } as any,
      )) as any[];
      employee = employeesByUid?.[0];
    }

    if (!employee) {
      return null;
    }

    const payrollInvoices =
      employee.invoices?.filter(
        (invoice: any) => invoice.invoiceCategory === "invoice_employ",
      ) || [];

    const totalPayrolls = payrollInvoices.length;
    const totalAmount = payrollInvoices.reduce(
      (sum, invoice) => sum + (parseFloat(String(invoice.total)) || 0),
      0,
    );
    const paidPayrolls = payrollInvoices.filter(
      (invoice) => invoice.invoiceStatus === "paid",
    ).length;
    const pendingPayrolls = payrollInvoices.filter(
      (invoice) => invoice.invoiceStatus === "unpaid",
    ).length;

    return {
      employeeId: documentId,
      employeeName: `${employee.name} ${employee.lastname}`,
      payrollStats: {
        totalPayrolls,
        totalAmount: parseFloat(totalAmount.toFixed(2)),
        paidPayrolls,
        pendingPayrolls,
      },
    };
  },

  /**
   * Get dashboard summary statistics
   */
  async getDashboardSummary() {
    const [
      totalStudents,
      activeEnrollments,
      activeEmployees,
      pendingInvoicesData,
    ] = await Promise.all([
      // Total de estudiantes (sin filtrar por estado de publicación)
      strapi.entityService.count("api::student.student", {
        filters: {},
      }),
      // Matrículas activas (sin filtrar por estado de publicación)
      strapi.entityService.count("api::enrollment.enrollment", {
        filters: {
          isActive: true,
        },
      }),
      // Personal activo (sin filtrar por estado de publicación)
      strapi.entityService.count("api::employee.employee", {
        filters: {
          isActive: true,
        },
      }),
      // Recibos pendientes con monto total (sin filtrar por estado de publicación)
      strapi.entityService.findMany("api::invoice.invoice", {
        filters: {
          invoiceStatus: "unpaid",
        },
        fields: ["total"],
      }),
    ]);

    const pendingInvoicesCount = pendingInvoicesData.length;
    const pendingInvoicesTotal = pendingInvoicesData.reduce(
      (sum, invoice) => sum + (parseFloat(String(invoice.total)) || 0),
      0,
    );

    return {
      totalStudents,
      activeEnrollments,
      activeEmployees,
      pendingInvoices: {
        count: pendingInvoicesCount,
        total: parseFloat(pendingInvoicesTotal.toFixed(2)),
      },
    };
  },

  /**
   * Get student age distribution
   */
  async getStudentAgeDistribution() {
    const students = await strapi.entityService.findMany(
      "api::student.student",
      {
        fields: ["birthdate"],
      },
    );

    const ageRanges = {
      "0-2": 0,
      "3-5": 0,
      "6-8": 0,
      "9-11": 0,
      "12-14": 0,
      "15+": 0,
    };

    const currentDate = new Date();
    let totalAge = 0;
    let validAges = 0;

    students.forEach((student) => {
      if (student.birthdate) {
        const birthDate = new Date(student.birthdate);
        // Saltar fechas inválidas
        if (isNaN(birthDate.getTime())) {
          return;
        }
        const age = Math.floor(
          (currentDate.getTime() - birthDate.getTime()) /
            (365.25 * 24 * 60 * 60 * 1000),
        );

        totalAge += age;
        validAges++;

        if (age <= 2) ageRanges["0-2"]++;
        else if (age <= 5) ageRanges["3-5"]++;
        else if (age <= 8) ageRanges["6-8"]++;
        else if (age <= 11) ageRanges["9-11"]++;
        else if (age <= 14) ageRanges["12-14"]++;
        else ageRanges["15+"]++;
      }
    });

    const averageAge =
      validAges > 0 ? parseFloat((totalAge / validAges).toFixed(1)) : 0;
    const largestGroup = Object.entries(ageRanges).reduce((a, b) =>
      ageRanges[a[0]] > ageRanges[b[0]] ? a : b,
    );

    return {
      distribution: ageRanges,
      averageAge,
      largestGroup: {
        range: largestGroup[0],
        count: largestGroup[1],
      },
      // Total de estudiantes con fecha válida de nacimiento
      totalStudents: validAges,
    };
  },

  /**
   * Get classroom capacity statistics
   */
  async getClassroomCapacityStats() {
    const classrooms = (await strapi.entityService.findMany(
      "api::classroom.classroom",
      {
        populate: ["enrollments"],
      },
    )) as any[];

    let totalCapacity = 0;
    let totalOccupied = 0;
    let availableClassrooms = 0;
    let fullClassrooms = 0;

    classrooms.forEach((classroom: any) => {
      const capacity = classroom.studentLimit || 0;
      const occupied =
        classroom.enrollments?.filter((enrollment: any) => enrollment.isActive)
          .length || 0;

      totalCapacity += capacity;
      totalOccupied += occupied;

      if (occupied >= capacity && capacity > 0) {
        fullClassrooms++;
      } else {
        availableClassrooms++;
      }
    });

    const occupancyPercentage =
      totalCapacity > 0
        ? parseFloat(((totalOccupied / totalCapacity) * 100).toFixed(1))
        : 0;

    return {
      totalClassrooms: classrooms.length,
      totalCapacity,
      totalOccupied,
      occupancyPercentage,
      availableClassrooms,
      fullClassrooms,
    };
  },

  /**
   * Get enrollment payment statistics
   */
  async getEnrollmentPaymentStats() {
    const enrollmentInvoices = await strapi.entityService.findMany(
      "api::invoice.invoice",
      {
        filters: {
          invoiceCategory: "invoice_enrollment",
        },
      },
    );

    return statisticsService.calculatePaymentStats(enrollmentInvoices);
  },

  /**
   * Get employee payment statistics
   */
  async getEmployeePaymentStats() {
    const employeeInvoices = await strapi.entityService.findMany(
      "api::invoice.invoice",
      {
        filters: {
          invoiceCategory: "invoice_employ",
        },
      },
    );

    return statisticsService.calculatePaymentStats(employeeInvoices);
  },

  /**
   * Get general and services payment statistics
   */
  async getGeneralPaymentStats() {
    const generalInvoices = await strapi.entityService.findMany(
      "api::invoice.invoice",
      {
        filters: {
          invoiceCategory: {
            $in: ["invoice_general", "invoice_service", "invoice_supplier"],
          },
        },
      },
    );

    return statisticsService.calculatePaymentStats(generalInvoices);
  },

  /**
   * Enrollments - Distribution by Concepts
   * Returns the top 3 concepts totals and the remaining grouped as "Others"
   */
  async getEnrollmentConceptDistribution() {
    const invoices = (await strapi.entityService.findMany(
      "api::invoice.invoice",
      {
        filters: {
          invoiceCategory: "invoice_enrollment",
          invoiceType: "charge",
        },
        fields: ["amounts"],
      },
    )) as any[];

    // Sum amounts by concept across all enrollment invoices
    const conceptSums = new Map<string, number>();

    for (const inv of invoices) {
      const items = normalizeInvoiceAmounts(inv?.amounts);
      if (!items || !Array.isArray(items)) continue;
      for (const it of items) {
        const key = String(it.concept || "").trim();
        const amount = Number(it.amount) || 0;
        if (!key || !(amount > 0)) continue;
        conceptSums.set(key, (conceptSums.get(key) || 0) + amount);
      }
    }

    const pairs = Array.from(conceptSums.entries())
      .map(([concept, total]) => ({ concept, total }))
      .sort((a, b) => b.total - a.total);

    const topConcepts = pairs.slice(0, 3).map((p) => ({
      concept: p.concept,
      total: parseFloat(p.total.toFixed(2)),
    }));
    const othersTotal = pairs
      .slice(3)
      .reduce((sum, p) => sum + (p.total || 0), 0);

    return {
      topConcepts,
      others: {
        concept: "Others",
        total: parseFloat(othersTotal.toFixed(2)),
      },
    };
  },

  /**
   * Enrollments - Quarterly evolution by concepts for a given year (default: current year)
   * Series: totalGeneral, matricula, comedor, others
   */
  async getEnrollmentConceptsQuarterly(year?: number) {
    const targetYear = Number.isFinite(year as number)
      ? (year as number)
      : new Date().getFullYear();

    const start = new Date(targetYear, 0, 1, 0, 0, 0, 0);
    const end = new Date(targetYear, 11, 31, 23, 59, 59, 999);

    const invoices = (await strapi.entityService.findMany(
      "api::invoice.invoice",
      {
        filters: {
          invoiceCategory: "invoice_enrollment",
          invoiceType: "charge",
          $and: [
            {
              $or: [
                { emissionDate: { $gte: start, $lte: end } },
                { createdAt: { $gte: start, $lte: end } },
              ],
            },
          ],
        },
        fields: ["amounts", "emissionDate", "createdAt"],
      },
    )) as any[];

    const quarters = {
      Q1: { totalGeneral: 0, matricula: 0, others: 0 },
      Q2: { totalGeneral: 0, matricula: 0, others: 0 },
      Q3: { totalGeneral: 0, matricula: 0, others: 0 },
      Q4: { totalGeneral: 0, matricula: 0, others: 0 },
    } as Record<
      string,
      { totalGeneral: number; matricula: number; others: number }
    >;

    const isMatricula = (key: string) => {
      const k = key.toLowerCase();
      return k.includes("matricula") || k.includes("tuition");
    };

    for (const inv of invoices) {
      const dateRaw = inv?.emissionDate || inv?.createdAt;
      const d = new Date(dateRaw);
      if (!d || isNaN(d.getTime())) continue;
      const month = d.getMonth(); // 0..11
      const qIndex = Math.floor(month / 3) + 1; // 1..4
      const qKey = `Q${qIndex}`;

      const items = normalizeInvoiceAmounts(inv?.amounts);
      if (!items || !Array.isArray(items)) continue;

      let totalThisInvoice = 0;
      let sumMatricula = 0;
      let sumOthers = 0;

      for (const it of items) {
        const label = String(it.concept || "").trim();
        const amount = Number(it.amount) || 0;
        if (!label || !(amount > 0)) continue;
        totalThisInvoice += amount;
        if (isMatricula(label)) sumMatricula += amount;
        else sumOthers += amount;
      }

      quarters[qKey].totalGeneral += totalThisInvoice;
      quarters[qKey].matricula += sumMatricula;
      quarters[qKey].others += sumOthers;
    }

    // Round to 2 decimals
    for (const q of Object.keys(quarters)) {
      const v = quarters[q];
      v.totalGeneral = parseFloat(v.totalGeneral.toFixed(2));
      v.matricula = parseFloat(v.matricula.toFixed(2));
      v.others = parseFloat(v.others.toFixed(2));
    }

    return {
      year: targetYear,
      quarters,
    };
  },

  /**
   * Enrollments - Monthly totals for 'Matrícula' concept for a given year (default: current year)
   */
  async getEnrollmentMatriculaMonthly(year?: number) {
    const targetYear = Number.isFinite(year as number)
      ? (year as number)
      : new Date().getFullYear();

    const start = new Date(targetYear, 0, 1, 0, 0, 0, 0);
    const end = new Date(targetYear, 11, 31, 23, 59, 59, 999);

    const invoices = (await strapi.entityService.findMany(
      "api::invoice.invoice",
      {
        filters: {
          invoiceCategory: "invoice_enrollment",
          invoiceType: "charge",
          $and: [
            {
              $or: [
                { emissionDate: { $gte: start, $lte: end } },
                { createdAt: { $gte: start, $lte: end } },
              ],
            },
          ],
        },
        fields: ["amounts", "emissionDate", "createdAt", "total"],
      },
    )) as any[];

    const months: Record<string, number> = {
      "01": 0,
      "02": 0,
      "03": 0,
      "04": 0,
      "05": 0,
      "06": 0,
      "07": 0,
      "08": 0,
      "09": 0,
      "10": 0,
      "11": 0,
      "12": 0,
    };

    for (const inv of invoices) {
      const dateRaw = inv?.emissionDate || inv?.createdAt;
      const d = new Date(dateRaw);
      if (!d || isNaN(d.getTime())) continue;
      const mm = String(d.getMonth() + 1).padStart(2, "0");

      const items = normalizeInvoiceAmounts(inv?.amounts);
      let sum = 0;
      if (items && Array.isArray(items) && items.length > 0) {
        for (const it of items) {
          const amount = Number(it.amount) || 0;
          if (amount > 0) sum += amount;
        }
      } else {
        // Fallback: use invoice.total if amounts are not available
        sum = Number(inv?.total) || 0;
      }

      months[mm] += sum;
    }

    // Round to 2 decimals
    for (const k of Object.keys(months)) {
      months[k] = parseFloat(months[k].toFixed(2));
    }

    return {
      year: targetYear,
      months,
    };
  },

  /**
   * Calculate payment statistics for a set of invoices
   */
  calculatePaymentStats(invoices) {
    const totalInvoices = invoices.length;
    const totalAmount = invoices.reduce(
      (sum, invoice) => sum + (parseFloat(String(invoice.total)) || 0),
      0,
    );
    const paidInvoices = invoices.filter(
      (invoice) => invoice.invoiceStatus === "paid",
    ).length;
    const pendingInvoices = invoices.filter(
      (invoice) => invoice.invoiceStatus === "unpaid",
    ).length;

    return {
      totalInvoices,
      totalAmount: parseFloat(totalAmount.toFixed(2)),
      paidInvoices,
      pendingInvoices,
    };
  },

  /**
   * Get upcoming invoices (next 5 to expire)
   */
  async getUpcomingInvoices() {
    const currentDate = new Date();
    const invoices = (await strapi.entityService.findMany(
      "api::invoice.invoice",
      {
        filters: {
          invoiceStatus: "unpaid",
          expirationDate: { $gte: currentDate },
        },
        sort: { expirationDate: "asc" },
        limit: 5,
        fields: ["title", "expirationDate", "total", "invoiceStatus"],
      },
    )) as any[];

    return invoices.map((invoice: any) => ({
      title: invoice.title,
      expirationDate: invoice.expirationDate,
      amount: parseFloat(invoice.total || 0),
      status: invoice.invoiceStatus,
    }));
  },

  /**
   * Get recent enrollments (last 5)
   */
  async getRecentEnrollments() {
    const enrollments = await strapi.entityService.findMany(
      "api::enrollment.enrollment",
      {
        populate: ["student"],
        sort: { createdAt: "desc" },
        limit: 5,
        fields: ["title", "createdAt", "isActive"],
      },
    );

    return enrollments.map((enrollment: any) => ({
      studentName: enrollment.student
        ? `${enrollment.student.name} ${enrollment.student.lastname}`
        : "N/A",
      enrollmentDate: enrollment.createdAt,
      status: enrollment.isActive ? "active" : "inactive",
    }));
  },

  /**
   * Get recent students (last 5)
   */
  async getRecentStudents() {
    const students = await strapi.entityService.findMany(
      "api::student.student",
      {
        sort: { createdAt: "desc" },
        limit: 5,
        fields: ["name", "lastname", "createdAt"],
      },
    );

    return students.map((student) => ({
      studentName: `${student.name} ${student.lastname}`,
      registrationDate: student.createdAt,
      status: "active", // Assuming all recent students are active
    }));
  },

  /**
   * Get monthly statistics for last 6 months
   */
  async getMonthlyStats() {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const [students, enrollments] = await Promise.all([
      strapi.entityService.findMany("api::student.student", {
        filters: {
          createdAt: { $gte: sixMonthsAgo },
        },
        fields: ["createdAt"],
      }),
      strapi.entityService.findMany("api::enrollment.enrollment", {
        filters: {
          createdAt: { $gte: sixMonthsAgo },
        },
        fields: ["createdAt"],
      }),
    ]);

    const monthlyData = {};
    const currentDate = new Date();

    // Initialize last 6 months
    for (let i = 5; i >= 0; i--) {
      const date = new Date(
        currentDate.getFullYear(),
        currentDate.getMonth() - i,
        1,
      );
      const monthKey = date.toISOString().slice(0, 7); // YYYY-MM format
      monthlyData[monthKey] = {
        students: 0,
        enrollments: 0,
      };
    }

    // Count students by month
    students.forEach((student: any) => {
      const monthKey = new Date(student.createdAt).toISOString().slice(0, 7);
      if (monthlyData[monthKey]) {
        monthlyData[monthKey].students++;
      }
    });

    // Count enrollments by month
    enrollments.forEach((enrollment: any) => {
      const monthKey = new Date(enrollment.createdAt).toISOString().slice(0, 7);
      if (monthlyData[monthKey]) {
        monthlyData[monthKey].enrollments++;
      }
    });

    const totalStudents = Object.values(monthlyData).reduce(
      (sum: number, month: any) => sum + (month.students || 0),
      0,
    ) as number;
    const totalEnrollments = Object.values(monthlyData).reduce(
      (sum: number, month: any) => sum + (month.enrollments || 0),
      0,
    ) as number;

    return {
      monthlyData,
      averages: {
        studentsPerMonth: parseFloat((totalStudents / 6).toFixed(1)),
        enrollmentsPerMonth: parseFloat((totalEnrollments / 6).toFixed(1)),
      },
      totals: {
        students: totalStudents,
        enrollments: totalEnrollments,
      },
    };
  },
};

export default statisticsService;
