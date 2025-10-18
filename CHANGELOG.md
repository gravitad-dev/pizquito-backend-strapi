# Changelog

## 2025-10-18

Highlights:
- Reports XLSX actualizado: empleados y matrículas usan :id; globales (general y servicios) no requieren ID.
- Filtros y ordenación en endpoints globales vía query: startDate, endDate, status, sortBy, sortOrder, invoiceType, registeredBy.
- Postman actualizado: descripciones en español para parámetros de consulta de "General" y "Servicios"; se elimina documentId en globales.
- Documentación actualizada (API-ENDPOINTS.md) con rutas y parámetros correctos y ejemplos.
- Excel consolidado: columna única "Origen" con traducciones; orden por defecto emissionDate desc.

Changes:
- Reports XLSX
  - GET /api/reports/xlsx/invoices/employees/:id
  - GET /api/reports/xlsx/invoices/enrollments/:id
  - GET /api/reports/xlsx/invoices/general
  - GET /api/reports/xlsx/invoices/services
  - Query params opcionales en globales: startDate, endDate, status, sortBy, sortOrder, invoiceType, registeredBy.
- Employee Excel Export (DEPRECADO)
  - GET /api/employees/:documentId/export-invoice-history → usar Reports XLSX.
- Excel export
  - Encabezados: se consolida "Origen" y se eliminan "Emitido por"/"Registrado por".
  - Matrículas: cabecera enriquecida con alumno y tutores; se eliminan "Aula" y "Período escolar".
- Documentación
  - API-ENDPOINTS.md actualizado con :id y parámetros opcionales en globales.
  - Colección Postman actualizada: parámetros documentados en español para globales.

## Unreleased – 2025-10-10

Highlights:
- Stabilized Cloudinary uploads by using the official SDK and enforcing folder organization.
- Disabled bulk deletion endpoint for safety; only per-id deletion remains.
- Added Excel export functionality for employee invoice history.

Changes:
- Scoped upload (POST /api/upload/files/scoped)
  - Uses Cloudinary SDK (uploader.upload) instead of provider upload/stream.
  - Creates Strapi file records with provider_metadata (public_id) and folderPath.
  - Folder rules: invoice → `Strapi/pizquito/invoices/YYYY/MM`; report(s) → `Strapi/pizquito/reports/YYYY/MM/DD`.
  - Base path configurable via `CLOUDINARY_BASE_FOLDER`.

- Reports PDFs (GET /api/reports/pdf/{invoice|payroll|service|general}/:id?store=true)
  - Store=true uploads PDF to Cloudinary under `Strapi/pizquito/invoices/YYYY/MM` (from emissionDate, fallback to now).
  - Strapi file record saved with URL and Cloudinary metadata.

- Modelo 233 (POST /api/reports/233/generate)
  - XLSX uploads to `Strapi/pizquito/reports/233/YYYY/MM` using Cloudinary SDK.
  - Strapi file record saved with URL and Cloudinary metadata.

- Upload plugin routes
  - Disabled: `DELETE /api/upload/files` (bulk delete).
  - Kept: `DELETE /api/upload/files/:id` (per-id delete).

- Employee Excel Export (GET /api/employees/:id/export-invoice-history)
  - Exports employee invoice history to Excel format (.xlsx).
  - Optional filters: category, startDate, endDate, status.
  - Professional formatting with headers, totals, currency format, and auto-filters.
  - Includes 13 columns: ID, Date, Category, Description, Total, IVA, etc.
  - Comprehensive error handling and validation.
  - Added dependency: exceljs@^4.4.0.

Technical notes:
- Replaced upload provider calls with direct `cloudinary.uploader.upload` to avoid "Missing file stream or buffer" errors.
- Added detailed logging and error handling around stream creation and uploads.
- Verified `config/plugins.ts` doesn’t force root; SDK folder option is respected.

Breaking change:
- Bulk delete route `/api/upload/files` is disabled. Use `DELETE /api/upload/files/:id` instead.