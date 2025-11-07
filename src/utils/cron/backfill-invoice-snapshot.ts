// Backfill de partySnapshot para facturas existentes
// Uso: ejecutar desde Strapi Console
//   $ npm run console
//   strapi.backfillInvoices?.runBackfill({ batch: 200 })

import type { Core } from "@strapi/types";
import { buildPartySnapshot } from "./invoice-snapshot";

type PartySnapshotMinimal = {
  partyType?: "enrollment" | "employee" | "guardian" | "supplier" | "general" | "service";
  partyDocumentId?: string;
  enrollmentDocumentId?: string;
  employeeDocumentId?: string;
  guardianDocumentId?: string;
  student?: { documentId?: string } | null;
  guardian?: { documentId?: string } | null;
  billing?: { IVA?: number | string | null; total?: number | string | null } | null;
  snapshotVersion?: string;
};

export async function runBackfill(
  strapi: Core.Strapi,
  { batch = 200, debug = true }: { batch?: number; debug?: boolean } = {},
) {
  const svc = strapi.documents("api::invoice.invoice");
  let start = 0;
  let processed = 0;
  let updated = 0;

  while (true) {
    const invoices = await svc.findMany({
      start,
      limit: batch,
      status: "published",
      // Populate relaciones necesarias para poder derivar los documentId en el snapshot
      // (employee, enrollment, guardian)
      populate: ["employee", "enrollment", "guardian"],
    } as any);
    if (!invoices || invoices.length === 0) break;

    for (const inv of invoices) {
      try {
        const hasSnapshot = !!(inv as any)?.partySnapshot;
        const snapshot: PartySnapshotMinimal = await buildPartySnapshot(
          strapi as any,
          inv,
        );

        // Fallback: si al construir el snapshot no se pudo resolver algún documentId,
        // intentar derivarlo desde las relaciones ya pobladas del invoice.
        const category = (inv as any)?.invoiceCategory;
        if (
          category === "invoice_employ" &&
          !snapshot.employeeDocumentId &&
          (inv as any)?.employee?.documentId
        ) {
          snapshot.employeeDocumentId = (inv as any).employee.documentId;
          snapshot.partyDocumentId = snapshot.employeeDocumentId;
        }
        if (
          category === "invoice_enrollment" &&
          !snapshot.enrollmentDocumentId &&
          (inv as any)?.enrollment?.documentId
        ) {
          snapshot.enrollmentDocumentId = (inv as any).enrollment.documentId;
          snapshot.partyDocumentId = snapshot.enrollmentDocumentId;
        }

        // Actualizar los campos del snapshot
        const dataToUpdate: any = {
          partySnapshot: snapshot as any,
          partyType: snapshot.partyType,
          partyDocumentId: snapshot.partyDocumentId,
          enrollmentDocumentId: snapshot.enrollmentDocumentId,
          employeeDocumentId: snapshot.employeeDocumentId,
          guardianDocumentId: snapshot.guardianDocumentId,
          snapshotVersion: snapshot.snapshotVersion || "v1",
        };
        // Actualizar versión publicada
        await svc.update({
          documentId: (inv as any).documentId,
          data: dataToUpdate,
          status: "published",
        } as any);

        // También intentar actualizar la versión de borrador para que el admin muestre los mismos datos
        // (si no existe borrador, esta operación puede fallar silenciosamente y la ignoramos)
        try {
          await svc.update({
            documentId: (inv as any).documentId,
            data: dataToUpdate,
            status: "draft",
          } as any);
        } catch (_) {
          // No hay borrador o no se puede actualizar: ignorar
        }
        updated++;
        if (debug) {
          strapi.log.info(
            `✅ [Backfill] ${hasSnapshot ? "Actualizado" : "Creado"} snapshot para invoice ${
              (inv as any).documentId
            }`,
          );
        }
      } catch (e) {
        strapi.log.warn(
          `⚠️ [Backfill] Error actualizando snapshot para invoice ${
            (inv as any).documentId
          }: ${(e as any)?.message || e}`,
        );
      } finally {
        processed++;
      }
    }

    start += invoices.length;
    if (debug) {
      strapi.log.info(
        `🔁 [Backfill] Progreso: processed=${processed}, updated=${updated}, nextStart=${start}`,
      );
    }
  }

  // Segunda pasada: actualizar entradas que solo existan en borrador (no publicadas)
  start = 0;
  while (true) {
    const invoicesDraft = await svc.findMany({
      start,
      limit: batch,
      status: "draft",
      populate: ["employee", "enrollment", "guardian"],
    } as any);
    if (!invoicesDraft || invoicesDraft.length === 0) break;

    for (const inv of invoicesDraft) {
      try {
        const snapshot: PartySnapshotMinimal = await buildPartySnapshot(
          strapi as any,
          inv,
        );
        const category = (inv as any)?.invoiceCategory;
        if (
          category === "invoice_employ" &&
          !snapshot.employeeDocumentId &&
          (inv as any)?.employee?.documentId
        ) {
          snapshot.employeeDocumentId = (inv as any).employee.documentId;
          snapshot.partyDocumentId = snapshot.employeeDocumentId;
        }
        if (
          category === "invoice_enrollment" &&
          !snapshot.enrollmentDocumentId &&
          (inv as any)?.enrollment?.documentId
        ) {
          snapshot.enrollmentDocumentId = (inv as any).enrollment.documentId;
          snapshot.partyDocumentId = snapshot.enrollmentDocumentId;
        }
        const dataToUpdate: any = {
          partySnapshot: snapshot as any,
          partyType: snapshot.partyType,
          partyDocumentId: snapshot.partyDocumentId,
          enrollmentDocumentId: snapshot.enrollmentDocumentId,
          employeeDocumentId: snapshot.employeeDocumentId,
          guardianDocumentId: snapshot.guardianDocumentId,
          snapshotVersion: snapshot.snapshotVersion || "v1",
        };
        await svc.update({
          documentId: (inv as any).documentId,
          data: dataToUpdate,
          status: "draft",
        } as any);
        updated++;
      } catch (e) {
        strapi.log.warn(
          `⚠️ [Backfill] Error actualizando snapshot (draft) para invoice ${
            (inv as any).documentId
          }: ${(e as any)?.message || e}`,
        );
      } finally {
        processed++;
      }
    }

    start += invoicesDraft.length;
    if (debug) {
      strapi.log.info(
        `🔁 [Backfill] Draft pass progreso: processed=${processed}, updated=${updated}, nextStart=${start}`,
      );
    }
  }

  strapi.log.info(`🏁 [Backfill] Finalizado. processed=${processed}, updated=${updated}`);
  return { processed, updated };
}

// Registrar en el objeto global para uso desde console
export default (strapi: Core.Strapi) => {
  (strapi as any).backfillInvoices = {
    runBackfill: (opts?: { batch?: number; debug?: boolean }) => runBackfill(strapi, opts),
  };
};