"use strict";

async function main() {
  const { createStrapi, compileStrapi } = require("@strapi/strapi");
  const appContext = await compileStrapi();
  const app = await createStrapi(appContext).load();

  try {
    const list = async (uid) => {
      try {
        const res = await strapi.entityService.findMany(uid, { limit: 50 });
        return Array.isArray(res) ? res : [];
      } catch (e) {
        console.error(`Error list ${uid}:`, e.message);
        return [];
      }
    };

    const show = (label, items) => {
      console.log(`${label}: ${items.length}`);
    };

    const guardians = await list("api::guardian.guardian");
    const students = await list("api::student.student");
    const enrollments = await list("api::enrollment.enrollment");
    const invoices = await list("api::invoice.invoice");

    show("Guardians", guardians);
    show("Students", students);
    show("Enrollments", enrollments);
    show("Invoices", invoices);
  } catch (err) {
    console.error("Error en check-233:", err);
  }

  await app.destroy();
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
