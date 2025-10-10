# Changelog

## Unreleased – 2025-10-10

Highlights:
- Stabilized Cloudinary uploads by using the official SDK and enforcing folder organization.
- Disabled bulk deletion endpoint for safety; only per-id deletion remains.

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

Technical notes:
- Replaced upload provider calls with direct `cloudinary.uploader.upload` to avoid "Missing file stream or buffer" errors.
- Added detailed logging and error handling around stream creation and uploads.
- Verified `config/plugins.ts` doesn’t force root; SDK folder option is respected.

Breaking change:
- Bulk delete route `/api/upload/files` is disabled. Use `DELETE /api/upload/files/:id` instead.