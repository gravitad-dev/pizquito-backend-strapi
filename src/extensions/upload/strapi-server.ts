import type { Core } from '@strapi/strapi';

/**
 * Extend Upload plugin to add routes:
 * - DELETE /api/upload/files            (borra todos)
 * - DELETE /api/upload/files/:id        (borra uno)
 * - POST   /api/upload/files/scoped     (sube archivos a carpeta segun scope/docId)
 */
export default (plugin: any) => {
  // Add controllers
  plugin.controllers = plugin.controllers || {};

  // Bulk delete controller
  plugin.controllers['files-bulk-delete'] = {
    async deleteAll(ctx: any) {
      const uploadService = strapi.plugin('upload').service('upload');
      const files = await strapi.query('plugin::upload.file').findMany({});
      const ids = files.map((f: any) => Number(f.id));
      // En Strapi v5, la eliminación correcta debe pasar el objeto de archivo al servicio de upload
      await Promise.all(files.map((file: any) => uploadService.remove(file)));
      ctx.body = { deleted: ids.length, ids };
    },
    async deleteOne(ctx: any) {
      const { id } = ctx.params || {};
      const uploadService = strapi.plugin('upload').service('upload');
      const file = await strapi.query('plugin::upload.file').findOne({ where: { id: Number(id) } });
      if (!file) {
        ctx.status = 404;
        ctx.body = { error: `File with id ${id} not found` };
        return;
      }
      await uploadService.remove(file);
      ctx.body = { deleted: 1, ids: [Number(id)] };
    },
  };

  // Scoped upload controller
  plugin.controllers['files-scoped-upload'] = {
    async upload(ctx: any) {
      try {
        const { scope, docId, ref, refId, field } = ctx.request.body || {};

        if (!scope) {
          ctx.status = 400;
          ctx.body = { error: 'scope is required' };
          return;
        }

        const rawScope = String(scope).trim().toLowerCase();
        const allowedScopes = [
          'user',
          'student',
          'guardian',
          'employee',
          'company',
          'classroom',
          'enrollment',
          'history',
          'observation',
          'promotion',
          'school-period',
          'service',
          'invoice',
          'report',
          'reports',
        ];
        if (!allowedScopes.includes(rawScope)) {
          ctx.status = 400;
          ctx.body = { error: `invalid scope: ${rawScope}` };
          return;
        }

        const base = process.env.CLOUDINARY_BASE_FOLDER || 'Strapi/pizquito';
        const now = new Date();
        const YYYY = String(now.getFullYear());
        const MM = String(now.getMonth() + 1).padStart(2, '0');
        const DD = String(now.getDate()).padStart(2, '0');

        const effectiveDocId = docId || refId;

        let folder = base;
        if (rawScope === 'invoice') {
          folder = `${base}/invoices/${YYYY}/${MM}`;
        } else if (rawScope === 'report' || rawScope === 'reports') {
          folder = `${base}/reports/${YYYY}/${MM}/${DD}`;
        } else if (effectiveDocId) {
          folder = `${base}/${rawScope}/${String(effectiveDocId)}`;
        } else {
          folder = `${base}/${rawScope}/misc/${YYYY}/${MM}/${DD}`;
        }

        // Debug: ver qué llega en el request
        strapi.log.info('=== REQUEST DEBUG ===');
        strapi.log.info('ctx.request.files exists:', !!ctx.request.files);
        strapi.log.info('ctx.request.files keys:', Object.keys(ctx.request.files || {}));
        strapi.log.info('ctx.request.body:', ctx.request.body);
        
        // Log completo de ctx.request.files para debug
        if (ctx.request.files) {
          Object.keys(ctx.request.files).forEach(key => {
            const file = ctx.request.files[key];
            strapi.log.info(`File key "${key}":`, {
              name: file?.name,
              originalFilename: file?.originalFilename,
              size: file?.size,
              type: file?.type,
              hasStream: !!file?.stream,
              hasBuffer: !!file?.buffer,
              hasPath: !!file?.path
            });
          });
        }
        
        // Extraer archivos de diferentes ubicaciones posibles
        let filesInput;
        if (ctx.request.files) {
          // Buscar archivos en diferentes propiedades
          if (ctx.request.files.files) {
            filesInput = ctx.request.files.files;
            strapi.log.info('Found files in ctx.request.files.files');
          } else {
            // Tomar el primer valor que sea un archivo
            const fileKeys = Object.keys(ctx.request.files);
            for (const key of fileKeys) {
              const value = ctx.request.files[key];
              if (value && (value.name || value.originalFilename)) {
                filesInput = value;
                strapi.log.info(`Found file in ctx.request.files.${key}`);
                break;
              }
            }
          }
        }
        
        strapi.log.info('Extracted filesInput:', filesInput ? 'Found files' : 'No files');
        
        if (!filesInput) {
          ctx.status = 400;
          ctx.body = { error: 'files are required (multipart/form-data)' };
          return;
        }

        // Usar el servicio de upload estándar de Strapi
        const uploadService = strapi.plugin('upload').service('upload');
        
        // Normalizar a array
        const files = Array.isArray(filesInput) ? filesInput : [filesInput];
        
        // Obtener el provider directamente
        const provider = strapi.plugin('upload').provider;
        
        // Crear resultados manualmente usando el provider
        const uploadResults = [];
        
        for (const file of files) {
           // Debug: log completo de las propiedades del archivo
           strapi.log.info('=== FILE DEBUG ===');
           strapi.log.info('File object keys:', Object.keys(file));
           strapi.log.info('File properties:', {
             name: file.name,
             originalFilename: file.originalFilename,
             size: file.size,
             type: file.type,
             mimetype: file.mimetype,
             filepath: file.filepath,
             newFilename: file.newFilename,
             hasStream: !!file.stream,
             hasBuffer: !!file.buffer,
             hasPath: !!file.path,
             constructor: file.constructor?.name
           });
           
           // Configurar opciones para este archivo específico
           const uploadOptions = {
             folder: folder,
             resource_type: 'auto',
             use_filename: true,
             unique_filename: true,
           };
           
           // Crear stream del archivo - revisar diferentes propiedades
           let fileStream;
           if (file.stream) {
             fileStream = file.stream;
             strapi.log.info('Using file.stream');
           } else if (file.buffer) {
             const { Readable } = require('stream');
             fileStream = Readable.from(file.buffer);
             strapi.log.info('Using file.buffer');
           } else if (file.path) {
             const fs = require('fs');
             fileStream = fs.createReadStream(file.path);
             strapi.log.info('Using file.path');
           } else if (file.filepath) {
             // Formidable usa filepath en lugar de path
             const fs = require('fs');
             
             // Verificar que el archivo existe
             if (!fs.existsSync(file.filepath)) {
               throw new Error(`File not found at path: ${file.filepath}`);
             }
             
             fileStream = fs.createReadStream(file.filepath);
             strapi.log.info('Using file.filepath:', file.filepath);
             
             // Verificar que el stream es válido
             if (!fileStream || typeof fileStream.pipe !== 'function') {
               throw new Error(`Invalid stream created from filepath: ${file.filepath}`);
             }
           } else {
             strapi.log.error('No stream source found. Available properties:', Object.keys(file));
             throw new Error(`No stream available for file: ${file.name || file.originalFilename}`);
           }
          
          strapi.log.info('Stream created successfully, uploading via Cloudinary SDK...');

          try {
            // Usar directamente el SDK de Cloudinary para evitar incompatibilidades del provider
            const cloudinary = require('cloudinary').v2;
            cloudinary.config({
              cloud_name: process.env.CLOUDINARY_NAME,
              api_key: process.env.CLOUDINARY_KEY,
              api_secret: process.env.CLOUDINARY_SECRET,
            });

            // Subida directa desde el filepath, con carpeta por scope
            const uploadResult = await cloudinary.uploader.upload(file.filepath, {
              folder,
              resource_type: 'auto',
              use_filename: true,
              unique_filename: true,
            });

            strapi.log.info('Upload successful:', uploadResult?.public_id || uploadResult?.asset_id || 'no id');

            // Crear entrada en la base de datos
            const ext = file.ext || `.${(file.name || file.originalFilename || '').split('.').pop()}`;
            const mime = file.mime || file.mimetype || file.type;
            const sizeKB = parseFloat(((file.size || 0) / 1024).toFixed(2));

            const fileData = {
              name: file.name || file.originalFilename,
              alternativeText: null,
              caption: null,
              width: uploadResult.width || null,
              height: uploadResult.height || null,
              formats: null,
              hash: (uploadResult.public_id || '').split('/').pop() || undefined,
              ext,
              mime,
              size: sizeKB,
              url: uploadResult.secure_url || uploadResult.url,
              previewUrl: null,
              provider: 'cloudinary',
              provider_metadata: {
                public_id: uploadResult.public_id,
                resource_type: uploadResult.resource_type,
              },
              folderPath: folder,
            };

            const savedFile = await strapi.entityService.create('plugin::upload.file', {
              data: fileData,
            });

            uploadResults.push(savedFile);
          } catch (uploadError) {
            strapi.log.error('Upload to Cloudinary failed:', uploadError?.message || uploadError);
            strapi.log.error('Full error:', uploadError);
            throw new Error(`Upload failed: ${uploadError?.message || uploadError}`);
          }
        }

        ctx.body = { folder, result: uploadResults };
      } catch (err: any) {
        strapi.log.error('Scoped upload failed', err);
        ctx.status = 500;
        ctx.body = { error: err?.message || 'Upload failed' };
      }
    },
  };

  // Register routes in content-api
  plugin.routes = plugin.routes || {};
  plugin.routes['content-api'] = plugin.routes['content-api'] || { routes: [] };

  // DELETE all files (deshabilitado por solicitud)
  // plugin.routes['content-api'].routes.push({
  //   method: 'DELETE',
  //   path: '/files',
  //   handler: 'files-bulk-delete.deleteAll',
  //   config: { policies: [] },
  // });
  // DELETE one file by id
  plugin.routes['content-api'].routes.push({
    method: 'DELETE',
    path: '/files/:id',
    handler: 'files-bulk-delete.deleteOne',
    config: { policies: [] },
  });

  // POST scoped upload
  plugin.routes['content-api'].routes.push({
    method: 'POST',
    path: '/files/scoped',
    handler: 'files-scoped-upload.upload',
    config: { policies: [] },
  });

  return plugin;
};