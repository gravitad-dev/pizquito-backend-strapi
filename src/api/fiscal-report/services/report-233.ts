/**
 * Service for Modelo 233
 */

import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';

type Quarter = 'Q1' | 'Q2' | 'Q3' | 'Q4';

type PreviewParams = {
  year?: number;
  quarter?: Quarter;
  concept?: 'matricula' | 'comedor' | 'all';
  centerCode?: string;
  studentId?: number;
  includeMonths?: boolean;
  page?: number;
  pageSize?: number;
};

type GenerateParams = {
  year?: number;
  quarter?: Quarter;
  concept?: 'matricula' | 'comedor' | 'all';
  centerCode?: string;
  format: 'csv' | 'xlsx' | 'pdf';
};

type MockInvoice = { date: string; concept: 'matricula' | 'comedor'; amount: number };
type MockRow = {
  studentId: number;
  student: { dni?: string; name: string; lastname: string; birthdate?: string };
  guardians: { nif: string; name?: string; lastname?: string }[];
  servicePeriod: { start: string; end: string };
  invoices: MockInvoice[];
};

const quarterRanges: Record<Quarter, { start: string; end: string }> = {
  Q1: { start: '-01-01', end: '-03-31' },
  Q2: { start: '-04-01', end: '-06-30' },
  Q3: { start: '-07-01', end: '-09-30' },
  Q4: { start: '-10-01', end: '-12-31' },
};

function inRange(dateStr: string, year?: number, quarter?: Quarter) {
  if (!year) return true;
  const d = new Date(dateStr);
  const yStart = new Date(`${year}-01-01`);
  const yEnd = new Date(`${year}-12-31`);
  if (quarter) {
    const q = quarterRanges[quarter];
    return d >= new Date(`${year}${q.start}`) && d <= new Date(`${year}${q.end}`);
  }
  return d >= yStart && d <= yEnd;
}

function monthIndex(dateStr: string) {
  return new Date(dateStr).getMonth(); // 0..11
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function buildFileName(format: 'csv' | 'xlsx' | 'pdf', year?: number, quarter?: Quarter) {
  const y = year ?? new Date().getFullYear();
  const q = quarter ?? 'ALL';
  return `modelo233_${y}_${q}.${format}`;
}

function csvEscape(val: string | number | undefined) {
  if (val === undefined || val === null) return '';
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export default {
  async preview(params: PreviewParams) {
    const mockPath = path.join(__dirname, 'mock233.json');
    const raw = fs.readFileSync(mockPath, 'utf-8');
    const mock = JSON.parse(raw) as { company: { nif: string; authorizationCode: string; name: string }; data: MockRow[] };

    const data = mock.data
      .filter((row) => (params.studentId ? row.studentId === params.studentId : true))
      .map((row) => {
        // Filter invoices by year/quarter and concept
        const filtered = row.invoices.filter((inv) => inRange(inv.date, params.year, params.quarter))
          .filter((inv) => (params.concept && params.concept !== 'all' ? inv.concept === params.concept : true));

        // Amounts by concept
        const sums = filtered.reduce((acc, inv) => {
          acc[inv.concept] = (acc[inv.concept] ?? 0) + inv.amount;
          return acc;
        }, {} as Record<'matricula' | 'comedor', number>);
        const total = (sums.matricula ?? 0) + (sums.comedor ?? 0);

        // Months S/N
        const months = Array(12).fill('') as ('' | 'S' | 'N')[];
        filtered.forEach((inv) => {
          months[monthIndex(inv.date)] = 'S';
        });

        return {
          studentId: row.studentId,
          student: row.student,
          guardians: {
            primaryNIF: row.guardians[0]?.nif,
            secondaryNIF: row.guardians[1]?.nif,
          },
          servicePeriod: row.servicePeriod,
          months: params.includeMonths ? {
            jan: months[0], feb: months[1], mar: months[2], apr: months[3], may: months[4], jun: months[5],
            jul: months[6], aug: months[7], sep: months[8], oct: months[9], nov: months[10], dec: months[11],
          } : undefined,
          amounts: {
            matricula: Number((sums.matricula ?? 0).toFixed(2)),
            comedor: Number((sums.comedor ?? 0).toFixed(2)),
            total: Number(total.toFixed(2)),
          },
        };
      });

    // Pagination
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 25;
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    const paged = data.slice(start, end);

    const totals = data.reduce((acc, r) => {
      acc.matricula += r.amounts.matricula;
      acc.comedor += r.amounts.comedor;
      acc.total += r.amounts.total;
      return acc;
    }, { matricula: 0, comedor: 0, total: 0 });

    return {
      meta: {
        year: params.year,
        quarter: params.quarter,
        centerCode: params.centerCode ?? mock.company.authorizationCode,
        totals,
        pagination: { page, pageSize, totalItems: data.length },
      },
      data: paged,
    };
  },

  async generate(params: GenerateParams) {
    const preview = await this.preview({ year: params.year, quarter: params.quarter, concept: params.concept });

    // Prepare output dir under public/uploads/reports/233
    const outDir = path.join(process.cwd(), 'public', 'uploads', 'reports', '233');
    ensureDir(outDir);
    const fileName = buildFileName(params.format, params.year, params.quarter);
    const outPath = path.join(outDir, fileName);

    if (params.format === 'csv') {
      const headers = [
        'StudentId', 'NIF_Primary', 'NIF_Secondary', 'DNI_Menor', 'Nombre', 'Apellidos', 'FechaNacimiento',
        'Matricula', 'Comedor', 'Total'
      ];
      const rows = (preview.data as any[]).map((r) => [
        r.studentId,
        r.guardians.primaryNIF ?? '',
        r.guardians.secondaryNIF ?? '',
        r.student.dni ?? '',
        r.student.name,
        r.student.lastname,
        r.student.birthdate ?? '',
        r.amounts.matricula,
        r.amounts.comedor,
        r.amounts.total,
      ]);
      const csv = [headers.map(csvEscape).join(','), ...rows.map((row) => row.map(csvEscape).join(','))].join('\n');
      fs.writeFileSync(outPath, csv, 'utf-8');
    }

    if (params.format === 'xlsx') {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Modelo 233');
      ws.columns = [
        { header: 'StudentId', key: 'studentId', width: 12 },
        { header: 'NIF_Primary', key: 'nif1', width: 16 },
        { header: 'NIF_Secondary', key: 'nif2', width: 16 },
        { header: 'DNI_Menor', key: 'dni', width: 14 },
        { header: 'Nombre', key: 'nombre', width: 18 },
        { header: 'Apellidos', key: 'apellidos', width: 18 },
        { header: 'FechaNacimiento', key: 'fnac', width: 14 },
        { header: 'Matricula', key: 'matricula', width: 12 },
        { header: 'Comedor', key: 'comedor', width: 12 },
        { header: 'Total', key: 'total', width: 12 },
      ];
      (preview.data as any[]).forEach((r) => {
        ws.addRow({
          studentId: r.studentId,
          nif1: r.guardians.primaryNIF ?? '',
          nif2: r.guardians.secondaryNIF ?? '',
          dni: r.student.dni ?? '',
          nombre: r.student.name,
          apellidos: r.student.lastname,
          fnac: r.student.birthdate ?? '',
          matricula: r.amounts.matricula,
          comedor: r.amounts.comedor,
          total: r.amounts.total,
        });
      });
      await wb.xlsx.writeFile(outPath);
    }

    if (params.format === 'pdf') {
      const doc = new PDFDocument({ margin: 40 });
      const stream = fs.createWriteStream(outPath);
      doc.pipe(stream);
      doc.fontSize(16).text('Modelo 233 - Resumen', { align: 'center' });
      doc.moveDown();
      doc.fontSize(10);
      (preview.data as any[]).forEach((r, idx) => {
        doc.text(`${idx + 1}. ${r.student.name} ${r.student.lastname} (${r.student.dni ?? '-'}) - Matricula: ${r.amounts.matricula} | Comedor: ${r.amounts.comedor} | Total: ${r.amounts.total}`);
      });
      doc.end();
      await new Promise<void>((resolve) => stream.on('finish', () => resolve()));
    }

    const relUrl = `/uploads/reports/233/${fileName}`;
    return {
      stored: true,
      path: outPath,
      url: relUrl,
      meta: { year: params.year, quarter: params.quarter, format: params.format },
    };
  },
};