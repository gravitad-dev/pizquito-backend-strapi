import { getEntryByDocumentId } from "../document-id";
import { normalizeInvoiceAmounts } from "./invoice-amounts";

type AnyStrapi = any;

export interface PartySnapshotBilling {
  amounts: ReturnType<typeof normalizeInvoiceAmounts> | null;
  IVA?: number | string | null;
  total?: number | string | null;
  additionalAmount?: any;
}

export interface PartySnapshotCompany {
  name?: string;
  code?: string;
  NIF?: string;
  IBAN?: string;
  BIC?: string;
  address?: string;
}

export interface PartySnapshot {
  partyType:
    | "enrollment"
    | "employee"
    | "guardian"
    | "service"
    | "general"
    | "supplier";
  partyDocumentId?: string;
  enrollmentDocumentId?: string;
  employeeDocumentId?: string;
  guardianDocumentId?: string;
  student?: {
    documentId?: string;
    name?: string;
    lastname?: string;
    DNI?: string;
  };
  guardian?: {
    documentId?: string;
    name?: string;
    lastname?: string;
    DNI?: string;
    NIF?: string;
    phone?: string;
    email?: string;
    address?: string;
  };
  employee?: {
    documentId?: string;
    name?: string;
    lastname?: string;
    DNI?: string;
    NIF?: string;
    role?: string;
    profession?: string;
    phone?: string;
    email?: string;
    address?: string;
  };
  classroom?: { documentId?: string; name?: string };
  schoolPeriod?: {
    documentId?: string;
    title?: string;
    start?: string;
    end?: string;
  };
  company?: PartySnapshotCompany;
  billing?: PartySnapshotBilling;
  snapshotVersion?: string;
}

async function getCompany(
  strapi: AnyStrapi,
): Promise<PartySnapshotCompany | undefined> {
  try {
    const company = await (strapi.db as any)
      .query("api::company.company")
      .findOne({});
    if (!company) return undefined;
    const { name, code, NIF, IBAN, BIC, address } = company;
    return { name, code, NIF, IBAN, BIC, address };
  } catch {
    return undefined;
  }
}

async function getEnrollmentWithRels(
  strapi: AnyStrapi,
  data: any,
): Promise<any | undefined> {
  try {
    let enrollment: any | undefined;
    const populate = {
      populate: ["student", "guardians", "classroom", "school_period"],
    };
    const raw = data?.enrollment;
    const enrollmentId =
      typeof raw === "object" ? (raw?.set?.[0]?.id ?? raw?.id) : raw;

    if (enrollmentId) {
      enrollment = await strapi.entityService.findOne(
        "api::enrollment.enrollment",
        enrollmentId,
        populate,
      );
    }

    if (!enrollment && data?.enrollmentDocumentId) {
      const found = await getEntryByDocumentId(
        strapi,
        "api::enrollment.enrollment",
        data.enrollmentDocumentId,
      );
      if (found?.id) {
        enrollment = await strapi.entityService.findOne(
          "api::enrollment.enrollment",
          found.id,
          populate,
        );
      }
    }
    return enrollment;
  } catch {
    return undefined;
  }
}

async function getEmployee(
  strapi: AnyStrapi,
  data: any,
): Promise<any | undefined> {
  try {
    let employee: any | undefined;
    const raw = data?.employee;

    const employeeId =
      typeof raw === "object" ? (raw?.set?.[0]?.id ?? raw?.id) : raw;

    if (employeeId) {
      employee = await strapi.entityService.findOne(
        "api::employee.employee",
        employeeId,
      );
    }

    if (!employee && data?.employeeDocumentId) {
      const found = await getEntryByDocumentId(
        strapi,
        "api::employee.employee",
        data.employeeDocumentId,
      );
      if (found?.id) {
        employee = await strapi.entityService.findOne(
          "api::employee.employee",
          found.id,
        );
      }
    }

    return employee;
  } catch {
    return undefined;
  }
}

export async function buildPartySnapshot(
  strapi: AnyStrapi,
  data: any,
): Promise<PartySnapshot> {
  const company = await getCompany(strapi);
  const amounts = normalizeInvoiceAmounts(data?.amounts);
  const billing: PartySnapshotBilling = {
    amounts,
    IVA: data?.IVA ?? null,
    total: data?.total ?? null,
  };

  const base: PartySnapshot = {
    partyType: "general",
    partyDocumentId: undefined,
    company,
    billing,
    snapshotVersion: "v1",
  };

  const category = data?.invoiceCategory;

  if (category === "invoice_enrollment") {
    const enrollment = await getEnrollmentWithRels(strapi, data);
    const student = enrollment?.student;
    const guardians = Array.isArray(enrollment?.guardians)
      ? enrollment?.guardians
      : [];
    const primaryGuardian = guardians?.[0];
    const classroom = enrollment?.classroom;
    const school = enrollment?.school_period;

    base.partyType = "enrollment";
    base.enrollmentDocumentId = enrollment?.documentId;
    base.partyDocumentId = base.enrollmentDocumentId;
    base.student = student
      ? {
          documentId: student.documentId,
          name: student.name,
          lastname: student.lastname,
          DNI: student.DNI,
        }
      : undefined;
    base.guardian = primaryGuardian
      ? {
          documentId: primaryGuardian.documentId,
          name: primaryGuardian.name,
          lastname: primaryGuardian.lastname,
          DNI: primaryGuardian.DNI,
          NIF: primaryGuardian.NIF,
          phone: primaryGuardian.phone,
          email: primaryGuardian.email,
          address: primaryGuardian.address,
        }
      : undefined;
    base.guardianDocumentId = primaryGuardian?.documentId;
    base.classroom = classroom
      ? { documentId: classroom.documentId, name: classroom.name }
      : undefined;
    base.schoolPeriod = school
      ? {
          documentId: school.documentId,
          title: school.title,
          start: school.start,
          end: school.end,
        }
      : undefined;
    base.billing = {
      ...base.billing,
      additionalAmount: enrollment?.additionalAmount,
    };
  } else if (category === "invoice_employ") {
    const employee = await getEmployee(strapi, data);
    base.partyType = "employee";
    base.employeeDocumentId = employee?.documentId;
    base.partyDocumentId = base.employeeDocumentId;
    base.employee = employee
      ? {
          documentId: employee.documentId,
          name: employee.name,
          lastname: employee.lastname,
          DNI: employee.DNI,
          NIF: employee.NIF,
          role: employee.role,
          profession: employee.profession,
          phone: employee.phone,
          email: employee.email,
          address: employee.address,
        }
      : undefined;
  } else if (
    category === "invoice_service" ||
    category === "invoice_general" ||
    category === "invoice_supplier"
  ) {
    base.partyType =
      category === "invoice_service"
        ? "service"
        : category === "invoice_general"
          ? "general"
          : "supplier";
  }

  return base;
}
