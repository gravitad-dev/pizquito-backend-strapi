/**
 * Service for SEPA Batch generation.
 * - Collects invoices by month/year and type.
 * - Builds per-invoice TXT (Cuaderno 19.14 for enrollments, 34.14 for employees) or XLSX.
 * - Packages all files into a ZIP and returns as buffer.
 */

import ExcelJS from "exceljs";
import JSZip from "jszip";

type GenerateZipParams = {
  year: number;
  month: number; // 1-12
  format: "txt" | "xlsx" | "xml";
  type: "enrollment" | "employee";
  statuses?: string[];
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function formatDatePlain(date: string | Date): string {
  const d = new Date(date);
  const year = d.getFullYear().toString();
  const month = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  return year + month + day;
}

function formatFixedLength(
  text: string,
  length: number,
  padChar: string = " ",
) {
  const t = (text || "").substring(0, length);
  return t.padEnd(length, padChar);
}

function formatAmountCents(amount: number): string {
  return Math.round(amount * 100)
    .toString()
    .padStart(10, "0");
}

function formatAmountEuros(amount: number): string {
  return Number(amount || 0).toFixed(2);
}

function formatISODate(date: string | Date): string {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  return `${y}-${m}-${day}`;
}

function xmlEscape(text: string): string {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildFileName(prefix: string, invoice: any) {
  const ref = invoice.documentId || invoice.id?.toString() || "ref";
  return `${prefix}-${ref}`;
}

async function createXlsxForEnrollment(invoice: any, guardian: any) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("SEPA");
  ws.columns = [
    { header: "Debtor Name", key: "debtorName", width: 30 },
    { header: "IBAN", key: "iban", width: 24 },
    { header: "BIC", key: "bic", width: 14 },
    { header: "MandateId", key: "mandateId", width: 24 },
    { header: "Amount", key: "amount", width: 12 },
    { header: "Charge Date", key: "date", width: 12 },
    { header: "Invoice Number", key: "invoiceNumber", width: 18 },
    { header: "Student", key: "student", width: 28 },
    { header: "Notes", key: "notes", width: 50 },
  ];
  const debtorName =
    `${guardian?.name || ""} ${guardian?.lastname || ""}`.trim();
  const mandateId =
    guardian?.mandateId || `${guardian?.DNI || "NO-DNI"}-${Date.now()}`;
  const studentName = invoice?.enrollment?.student
    ? `${invoice.enrollment.student.name} ${invoice.enrollment.student.lastname}`
    : "";
  ws.addRow({
    debtorName,
    iban: guardian?.IBAN || "ES0000000000000000000000",
    bic: guardian?.BIC || "ESDCESMMXXX",
    mandateId,
    amount: Number(invoice.total || 0),
    date: (invoice.expirationDate || invoice.emissionDate || new Date())
      .toString()
      .slice(0, 10),
    invoiceNumber: invoice.documentId || invoice.id,
    student: studentName,
    notes: invoice.title || "",
  });
  return wb.xlsx.writeBuffer();
}

async function createXlsxForEmployee(invoice: any, employee: any) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("SEPA");
  // Empleados: no incluir IBAN; incluir lo disponible: BIC, SWIFT y NIF.
  ws.columns = [
    { header: "Beneficiary Name", key: "name", width: 30 },
    { header: "BIC", key: "bic", width: 14 },
    { header: "SWIFT", key: "swift", width: 14 },
    { header: "NIF", key: "nif", width: 18 },
    { header: "Amount", key: "amount", width: 12 },
    { header: "Execution Date", key: "date", width: 12 },
    { header: "Invoice Number", key: "invoiceNumber", width: 18 },
    { header: "Notes", key: "notes", width: 50 },
  ];
  const name = `${employee?.name || ""} ${employee?.lastname || ""}`.trim();
  ws.addRow({
    name,
    bic: employee?.BIC || "",
    swift: employee?.SWIFT || "",
    nif: employee?.NIF || employee?.DNI || "",
    amount: Number(invoice.total || 0),
    date: (invoice.expirationDate || invoice.emissionDate || new Date())
      .toString()
      .slice(0, 10),
    invoiceNumber: invoice.documentId || invoice.id,
    notes: invoice.title || "",
  });
  return wb.xlsx.writeBuffer();
}

function createTxt1914(invoice: any, company: any, guardian: any) {
  const today = formatDatePlain(new Date());
  const collectionDate = formatDatePlain(invoice.expirationDate || new Date());
  const amount = formatAmountCents(Number(invoice.total || 0));
  const mandateId =
    guardian?.mandateId || `${guardian?.DNI || "NO-DNI"}-${Date.now()}`;
  const invoiceRef = invoice.documentId || String(invoice.id || "");
  const debtorCountry = guardian?.IBAN
    ? (guardian.IBAN as string).substring(0, 2)
    : "ES";
  const debtorAccount = guardian?.IBAN
    ? (guardian.IBAN as string).substring(4)
    : "00000000000000000000";

  const reg01 =
    "01" +
    "19143001" +
    formatFixedLength(company?.NIF || "", 25) +
    formatFixedLength(company?.name || "", 40) +
    today +
    "PRE" +
    today.substring(2) +
    "000000000" +
    "000000000000000" +
    formatFixedLength((company?.BIC || "0000").substring(4, 8), 4) +
    formatFixedLength("", 4);

  const reg02 =
    "02" +
    "19143002" +
    formatFixedLength(company?.NIF || "", 25) +
    today +
    formatFixedLength(company?.name || "", 40) +
    formatFixedLength(company?.address || "", 40) +
    formatFixedLength((company?.IBAN || "ES").substring(0, 2), 2) +
    formatFixedLength((company?.IBAN || "").substring(4), 20);

  const reg03 =
    "03" +
    "19143003" +
    formatFixedLength(invoiceRef, 35) +
    formatFixedLength(mandateId, 35) +
    formatFixedLength("CORE", 8) +
    amount +
    collectionDate +
    formatFixedLength(guardian?.BIC || "", 11) +
    formatFixedLength(
      `${guardian?.name || ""} ${guardian?.lastname || ""}`.trim(),
      40,
    ) +
    formatFixedLength(guardian?.address || "", 40) +
    formatFixedLength(
      `${guardian?.postcode || ""} ${guardian?.city || ""}`.trim(),
      40,
    ) +
    formatFixedLength(debtorCountry, 2) +
    "1" +
    formatFixedLength(guardian?.DNI || "", 35) +
    "A" +
    formatFixedLength(debtorCountry, 2) +
    formatFixedLength(debtorAccount, 20) +
    formatFixedLength("SUPP", 4) +
    formatFixedLength(
      `Recibo: ${invoice.title || ""} - ${formatDatePlain(invoice.emissionDate || new Date())}`,
      140,
    );

  const reg04 =
    "04" +
    formatFixedLength(company?.NIF || "", 25) +
    today +
    amount +
    "000001" +
    "000001";

  const reg05 =
    "05" +
    formatFixedLength(company?.NIF || "", 25) +
    amount +
    "000001" +
    "000001";

  const reg99 = "99" + "00000" + amount + "000006" + "000001";

  return [reg01, reg02, reg03, reg04, reg05, reg99].join("\n");
}

function createTxt3414(invoice: any, company: any, employee: any) {
  const today = formatDatePlain(new Date());
  const executionDate = formatDatePlain(invoice.expirationDate || new Date());
  const amount = formatAmountCents(Number(invoice.total || 0));
  const invoiceRef = invoice.documentId || String(invoice.id || "");

  const reg01 =
    "01" +
    "34140001" +
    formatFixedLength(company?.NIF || "", 25) +
    formatFixedLength(company?.name || "", 40) +
    today +
    "ORD" +
    today.substring(2) +
    "000000000" +
    "000000000000000" +
    formatFixedLength((company?.BIC || "0000").substring(4, 8), 4) +
    formatFixedLength("", 4);

  const reg02 =
    "02" +
    "34140002" +
    formatFixedLength(company?.NIF || "", 25) +
    today +
    formatFixedLength(company?.name || "", 40) +
    formatFixedLength(company?.address || "", 40) +
    formatFixedLength((company?.IBAN || "ES").substring(0, 2), 2) +
    formatFixedLength((company?.IBAN || "").substring(4), 20);

  const reg03 =
    "03" +
    "34140003" +
    formatFixedLength(invoiceRef, 35) +
    formatFixedLength(`EMP-${employee?.documentId || employee?.id}`, 35) +
    formatFixedLength("SALA", 8) +
    amount +
    executionDate +
    formatFixedLength(employee?.BIC || employee?.SWIFT || "", 11) +
    formatFixedLength(
      `${employee?.name || ""} ${employee?.lastname || ""}`.trim(),
      40,
    ) +
    formatFixedLength(employee?.address || "", 40) +
    formatFixedLength(
      `${employee?.postcode || ""} ${employee?.city || ""}`.trim(),
      40,
        ) +
      formatFixedLength(employee?.IBAN ? (employee.IBAN as string).substring(0, 2) : "", 2) +
      "1" +
      formatFixedLength(employee?.DNI || employee?.NIF || "", 35) +
      "A" +
      formatFixedLength(employee?.IBAN ? (employee.IBAN as string).substring(0, 2) : "", 2) +
      formatFixedLength(employee?.IBAN ? (employee.IBAN as string).substring(4) : "", 20) +
      formatFixedLength("SALA", 4) +
    formatFixedLength(
      `Nomina ${employee?.name || ""} ${employee?.lastname || ""} - ${formatDatePlain(invoice.emissionDate || new Date())}`,
      140,
    );

  const reg04 =
    "04" +
    formatFixedLength(company?.NIF || "", 25) +
    today +
    amount +
    "000001" +
    "000001";

  const reg05 =
    "05" +
    formatFixedLength(company?.NIF || "", 25) +
    amount +
    "000001" +
    "000001";

  const reg99 = "99" + "00000" + amount + "000006" + "000001";

  return [reg01, reg02, reg03, reg04, reg05, reg99].join("\n");
}

function createXmlForEmployee(invoice: any, company: any, employee: any) {
  const nowIso = new Date().toISOString();
  const execDate = formatISODate(invoice.expirationDate || invoice.emissionDate || new Date());
  const amountStr = formatAmountEuros(Number(invoice.total || 0));
  const invoiceRef = invoice.documentId || String(invoice.id || "");
  const msgId = `TRF-${invoiceRef}-${Date.now()}`;

  const companyName = xmlEscape(company?.name || "");
  const companyNif = xmlEscape(company?.NIF || "");
  const companyAddr = xmlEscape(company?.address || "");
  const companyIban = xmlEscape(company?.IBAN || "");
  const companyBic = xmlEscape(company?.BIC || "");

  const empName = xmlEscape(`${employee?.name || ""} ${employee?.lastname || ""}`.trim());
  const empAddr = xmlEscape(employee?.address || "");
  const empCity = xmlEscape(employee?.city || "");
  const empPostcode = xmlEscape(employee?.postcode || "");
  const empCountry = xmlEscape("ES");
  const empBic = xmlEscape(employee?.BIC || employee?.SWIFT || "");
  const empIbanOrSwift = xmlEscape(employee?.IBAN || employee?.SWIFT || "");
  const empRefId = xmlEscape(employee?.NIF || employee?.DNI || "");

  const notes = xmlEscape(
    `Nómina Mensual - ${employee?.name || ""} - ${formatISODate(invoice.emissionDate || new Date())}`,
  );

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03">\n` +
    `  <CstmrCdtTrfInitn>\n` +
    `    <GrpHdr>\n` +
    `      <MsgId>${msgId}</MsgId>\n` +
    `      <CreDtTm>${nowIso}</CreDtTm>\n` +
    `      <NbOfTxs>1</NbOfTxs>\n` +
    `      <CtrlSum>${amountStr}</CtrlSum>\n` +
    `      <InitgPty>\n` +
    `        <Nm>${companyName}</Nm>\n` +
    `        <Id><OrgId><Othr><Id>${companyNif}</Id></Othr></OrgId></Id>\n` +
    `      </InitgPty>\n` +
    `    </GrpHdr>\n` +
    `    <PmtInf>\n` +
    `      <PmtInfId>PZQ</PmtInfId>\n` +
    `      <PmtMtd>TRF</PmtMtd>\n` +
    `      <BtchBookg>true</BtchBookg>\n` +
    `      <ReqdExctnDt>${execDate}</ReqdExctnDt>\n` +
    `      <Dbtr>\n` +
    `        <Nm>${companyName}</Nm>\n` +
    `        <PstlAdr><CtrySubDvsn>${companyAddr}</CtrySubDvsn><AdrLine>${companyAddr}</AdrLine></PstlAdr>\n` +
    `      </Dbtr>\n` +
    `      <DbtrAcct><Id><IBAN>${companyIban}</IBAN></Id></DbtrAcct>\n` +
    `      <DbtrAgt><FinInstnId><BIC>${companyBic}</BIC></FinInstnId></DbtrAgt>\n` +
    `      <CdtTrfTxInf>\n` +
    `        <PmtId><EndToEndId>REF-${xmlEscape(invoiceRef)}</EndToEndId></PmtId>\n` +
    `        <PmtTpInf><SeqTp>OTHR</SeqTp><CtgyPurp><Cd>SALA</Cd></CtgyPurp></PmtTpInf>\n` +
    `        <Amt><InstdAmt Ccy="EUR">${amountStr}</InstdAmt></Amt>\n` +
    `        <CdtrAgt><FinInstnId><BIC>${empBic}</BIC></FinInstnId></CdtrAgt>\n` +
    `        <Cdtr>\n` +
    `          <Nm>${empName}</Nm>\n` +
    `          <PstlAdr>\n` +
    `            <PstCd>${empPostcode}</PstCd>\n` +
    `            <TwnNm>${empCity}</TwnNm>\n` +
    `            <CtrySubDvsn>${empCity}</CtrySubDvsn>\n` +
    `            <Ctry>${empCountry}</Ctry>\n` +
    `            <AdrLine>${empAddr}</AdrLine>\n` +
    `          </PstlAdr>\n` +
    `        </Cdtr>\n` +
    `        <CdtrAcct><Id><IBAN>${empIbanOrSwift}</IBAN></Id></CdtrAcct>\n` +
    `        <RmtInf>\n` +
    `          <Ustrd>${notes}</Ustrd>\n` +
    `          <Strd><CdtrRefInf><Ref>${empRefId}</Ref></CdtrRefInf></Strd>\n` +
    `        </RmtInf>\n` +
    `      </CdtTrfTxInf>\n` +
    `    </PmtInf>\n` +
    `  </CstmrCdtTrfInitn>\n` +
    `</Document>`
  );
}

function createXmlForEnrollment(invoice: any, company: any, guardian: any) {
  const nowIso = new Date().toISOString();
  const collDate = formatISODate(invoice.expirationDate || invoice.emissionDate || new Date());
  const amountStr = formatAmountEuros(Number(invoice.total || 0));
  const invoiceRef = invoice.documentId || String(invoice.id || "");
  const msgId = `DD-${invoiceRef}-${Date.now()}`;

  const companyName = xmlEscape(company?.name || "");
  const companyNif = xmlEscape(company?.NIF || "");
  const companyAddr = xmlEscape(company?.address || "");
  const companyIban = xmlEscape(company?.IBAN || "");
  const companyBic = xmlEscape(company?.BIC || "");

  const debtorName = xmlEscape(`${guardian?.name || ""} ${guardian?.lastname || ""}`.trim());
  const debtorAddr = xmlEscape(guardian?.address || "");
  const debtorCountry = xmlEscape("ES");
  const debtorDni = xmlEscape(guardian?.DNI || "");
  const debtorBic = xmlEscape(guardian?.BIC || "ESDCESMMXXX");
  const debtorIban = xmlEscape(
    guardian?.IBAN ? (guardian.IBAN as string) : "ES0000000000000000000000",
  );
  const mandateId = xmlEscape(
    guardian?.mandateId || `${guardian?.DNI || "NO-DNI"}-${Date.now()}`,
  );
  const signDate = formatISODate(invoice.emissionDate || new Date());
  const notes = xmlEscape(
    `Recibo mensual - ${new Date(invoice.expirationDate || new Date()).toLocaleString("es-ES", { month: "long" })} de ${new Date(invoice.expirationDate || new Date()).getFullYear()} - ${invoice?.enrollment?.student?.name || ""} - ${formatISODate(invoice.emissionDate || new Date())}`,
  );

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.008.001.02">\n` +
    `  <CstmrDrctDbtInitn>\n` +
    `    <GrpHdr>\n` +
    `      <MsgId>${msgId}</MsgId>\n` +
    `      <CreDtTm>${nowIso}</CreDtTm>\n` +
    `      <NbOfTxs>1</NbOfTxs>\n` +
    `      <CtrlSum>${amountStr}</CtrlSum>\n` +
    `      <InitgPty>\n` +
    `        <Nm>${companyName}</Nm>\n` +
    `        <Id><OrgId><Othr><Id>${companyNif}</Id></Othr></OrgId></Id>\n` +
    `      </InitgPty>\n` +
    `    </GrpHdr>\n` +
    `    <PmtInf>\n` +
    `      <PmtInfId>PZQ</PmtInfId>\n` +
    `      <PmtMtd>DD</PmtMtd>\n` +
    `      <NbOfTxs>1</NbOfTxs>\n` +
    `      <CtrlSum>${amountStr}</CtrlSum>\n` +
    `      <PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl><LclInstrm><Cd>CORE</Cd></LclInstrm></PmtTpInf>\n` +
    `      <ReqdColltnDt>${collDate}</ReqdColltnDt>\n` +
    `      <Cdtr>\n` +
    `        <Nm>${companyName}</Nm>\n` +
    `        <PstlAdr><Ctry>ES</Ctry><AdrLine>${companyAddr}</AdrLine></PstlAdr>\n` +
    `        <Id><OrgId><Othr><Id>${companyNif}</Id></Othr></OrgId></Id>\n` +
    `      </Cdtr>\n` +
    `      <CdtrAcct><Id><IBAN>${companyIban}</IBAN></Id><Ccy>EUR</Ccy></CdtrAcct>\n` +
    `      <CdtrAgt><FinInstnId><BIC>${companyBic}</BIC></FinInstnId></CdtrAgt>\n` +
    `      <ChrgBr>SLEV</ChrgBr>\n` +
    `      <DrctDbtTxInf>\n` +
    `        <PmtId><InstrId>${msgId}</InstrId><EndToEndId>REF-${xmlEscape(invoiceRef)}</EndToEndId></PmtId>\n` +
    `        <PmtTpInf><SeqTp>FRST</SeqTp><CtgyPurp><Cd>SUPP</Cd></CtgyPurp></PmtTpInf>\n` +
    `        <InstdAmt Ccy="EUR">${amountStr}</InstdAmt>\n` +
    `        <DrctDbtTx>\n` +
    `          <MndtRltdInf><MndtId>${mandateId}</MndtId><DtOfSgntr>${signDate}</DtOfSgntr><AmdmntInd>false</AmdmntInd></MndtRltdInf>\n` +
    `          <CdtrSchmeId><Id><PrvtId><Othr><Id>${companyNif}</Id><SchmeNm><Prtry>SEPA</Prtry></SchmeNm></Othr></PrvtId></Id></CdtrSchmeId>\n` +
    `        </DrctDbtTx>\n` +
    `        <DbtrAgt><FinInstnId><BIC>${debtorBic}</BIC></FinInstnId></DbtrAgt>\n` +
    `        <Dbtr>\n` +
    `          <Nm>${debtorName}</Nm>\n` +
    `          <PstlAdr><Ctry>${debtorCountry}</Ctry><AdrLine>${debtorAddr}</AdrLine></PstlAdr>\n` +
    `          <Id><OrgId><Othr><Id>${debtorDni}</Id></Othr></OrgId></Id>\n` +
    `          <CtryOfRes>${debtorCountry}</CtryOfRes>\n` +
    `        </Dbtr>\n` +
    `        <DbtrAcct><Id><IBAN>${debtorIban}</IBAN></Id><Ccy>EUR</Ccy></DbtrAcct>\n` +
    `        <Purp><Cd>SUPP</Cd></Purp>\n` +
    `        <RmtInf><Ustrd>${notes}</Ustrd></RmtInf>\n` +
    `      </DrctDbtTxInf>\n` +
    `    </PmtInf>\n` +
    `  </CstmrDrctDbtInitn>\n` +
    `</Document>`
  );
}

export default () => ({
  async generateZip({
    year,
    month,
    format,
    type,
    statuses,
  }: GenerateZipParams) {
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0, 23, 59, 59, 999);

    // Obtener empresa para datos de acreedor/ordenante
    const companyList = await (strapi as any).entityService.findMany(
      "api::company.company",
    );
    const company = Array.isArray(companyList) ? companyList[0] : companyList;

    // Filtros base
    const statusList =
      Array.isArray(statuses) && statuses.length
        ? statuses
        : ["paid", "inprocess", "unpaid"];
    const filters: any = {
      invoiceStatus: { $in: statusList },
      expirationDate: { $between: [start.toISOString(), end.toISOString()] },
    };

    const populate: any = {};
    let invoiceCategory = "";
    if (type === "enrollment") {
      invoiceCategory = "invoice_enrollment";
      populate.enrollment = { populate: { student: true } };
      populate.guardian = true;
    } else {
      invoiceCategory = "invoice_employ";
      populate.employee = true;
    }

    const invoices = await (strapi as any).entityService.findMany(
      "api::invoice.invoice",
      {
        filters: { ...filters, invoiceCategory: { $eq: invoiceCategory } },
        populate,
        limit: 10000,
        sort: { emissionDate: "asc" },
      },
    );

    const zip = new JSZip();
    const errors: string[] = [];

    for (const inv of invoices) {
      const baseName =
        type === "enrollment"
          ? buildFileName("adeudo-1914", inv)
          : buildFileName("transferencia-3414", inv);

      try {
        if (format === "txt") {
          if (type === "enrollment") {
            const guardian = (inv as any).guardian || {};
            if (!guardian?.IBAN) {
              errors.push(
                `Factura ${inv.documentId || inv.id}: Guardian sin IBAN, se generó TXT 19.14 con IBAN cero y NIF como identificador`,
              );
            }
            const txt = createTxt1914(inv, company, guardian);
            zip.file(`${baseName}.txt`, txt);
          } else {
            const employee = (inv as any).employee || {};
              // A partir de ahora NO se omiten empleados sin IBAN en TXT 34.14.
              // Si falta IBAN, NO se rellena; solo se incluyen BIC/SWIFT y NIF/DNI según disponibilidad.
              const txt = createTxt3414(inv, company, employee);
              zip.file(`${baseName}.txt`, txt);
          }
        } else if (format === "xlsx") {
          if (type === "enrollment") {
            const guardian = (inv as any).guardian || {};
            const buffer = await createXlsxForEnrollment(inv, guardian);
            zip.file(`${baseName}.xlsx`, buffer);
          } else {
            const employee = (inv as any).employee || {};
            const buffer = await createXlsxForEmployee(inv, employee);
            zip.file(`${baseName}.xlsx`, buffer);
          }
        } else if (format === "xml") {
          if (type === "enrollment") {
            const guardian = (inv as any).guardian || {};
            const xml = createXmlForEnrollment(inv, company, guardian);
            zip.file(`${baseName}.xml`, xml);
          } else {
            const employee = (inv as any).employee || {};
            const xml = createXmlForEmployee(inv, company, employee);
            zip.file(`${baseName}.xml`, xml);
          }
        }
      } catch (e: any) {
        errors.push(`Factura ${inv.documentId || inv.id}: ${e?.message || e}`);
      }
    }

    if (errors.length) {
      zip.file("notas.txt", errors.join("\n"));
    }

    zip.file(
      "README.txt",
      [
        `SEPA Batch`,
        `Tipo: ${type}`,
        `Periodo: ${year}-${pad2(month)}`,
        `Formato: ${format}`,
        `Estados incluidos: ${statusList.join(",")}`,
        `Facturas procesadas: ${invoices.length}`,
        `Generado: ${new Date().toISOString()}`,
      ].join("\n"),
    );

    const zipBuffer = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
    });
    const fileName = `sepa_batch_${type}_${year}_${pad2(month)}.zip`;
    return { zipBuffer, fileName };
  },
});
