# API Endpoints (Strapi) – Guía para probar con Postman

Base URL: http://localhost:1337

Notas:
- La mayoría de endpoints requieren autenticación (Authorization: Bearer <JWT>) y permisos configurados en Roles & Permissions.
- Para ambientes distintos, ajusta la variable URL en .env.
- Query params soportados: pagination[page], pagination[pageSize], sort, filters, populate, fields.

## Autenticación (plugin users-permissions)

### Login
- Método: POST
- URL: /api/auth/local
- Headers: Content-Type: application/json
- Body (JSON):
  {
    "identifier": "usuario@correo.com",
    "password": "tu_password"
  }
- Respuesta: { jwt: string, user: { ... } }

### Registro
- Método: POST
- URL: /api/auth/local/register
- Headers: Content-Type: application/json
- Body (JSON):
  {
    "username": "usuario",
    "email": "usuario@correo.com",
    "password": "tu_password"
  }
- Respuesta: { jwt: string, user: { ... } }

### Perfil del usuario autenticado
- Método: GET
- URL: /api/users/me
- Headers: Authorization: Bearer <JWT>
- Respuesta: datos del usuario autenticado

### Usuarios (requiere permisos)
- Listar: GET /api/users
- Detalle: GET /api/users/:id
- Crear: POST /api/users
- Actualizar: PUT /api/users/:id
- Borrar: DELETE /api/users/:id
- Headers: Authorization: Bearer <JWT>

## Upload (archivos)
- Listar archivos: GET /api/upload/files
- Buscar archivos: GET /api/upload/search?query=<texto>
- Subir archivo: POST /api/upload
  - Tipo: form-data
  - Campo files: (archivo)
  - Campos opcionales: ref, refId, field (para asociar a un entry)
- Eliminar archivo: DELETE /api/upload/files/:id
- Headers: Authorization: Bearer <JWT>

## Content Types (Colecciones)
Los siguientes content types son de tipo collectionType y exponen los endpoints REST estándar:

Operaciones estándar:
- Listar: GET /api/<plural>
- Detalle: GET /api/<plural>/:id
- Crear: POST /api/<plural>
- Actualizar: PUT /api/<plural>/:id
- Borrar: DELETE /api/<plural>/:id

Soportan query params: populate, filters, sort, pagination.

### Students
- Plural: students
- Ejemplos:
  - Listar: GET /api/students?populate=*
  - Crear:
    Body JSON:
    {
      "data": {
        "name": "Juan",
        "lastname": "Pérez",
        "DNI": "12345678X"
      }
    }
  - Filtrar: GET /api/students?filters[name][$contains]=Juan

### Employees
- Plural: employees
- Ejemplos:
  - GET /api/employees
  - POST /api/employees
  - Exportar historial de facturas (REMOVIDO): GET /api/employees/:documentId/export-invoice-history
    - Endpoint removido. Usar los endpoints del módulo Reports (XLSX).
    - Endpoints:
      - GET /api/reports/xlsx/invoices/employees/:id (todas las facturas de un empleado específico por ID)
      - GET /api/reports/xlsx/invoices/enrollments/:id (todas las facturas de una matrícula específica por ID)
      - GET /api/reports/xlsx/invoices/general (todas las facturas generales)
        - Parámetros opcionales: ?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&status=unpaid|inprocess|paid|canceled&sortBy=campo&sortOrder=asc|desc&invoiceType=charge|payment|income|expense&registeredBy=administration|bank|system
      - GET /api/reports/xlsx/invoices/services (todas las facturas de servicios)
        - Parámetros opcionales: ?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&status=unpaid|inprocess|paid|canceled&sortBy=campo&sortOrder=asc|desc&invoiceType=charge|payment|income|expense&registeredBy=administration|bank|system
    - Nota: El Excel incluye una sola columna de Origen (en lugar de Emitido por y Registrado por).
    - Headers: Accept: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet

## Reportes Fiscales - Modelo 233

### Preview del Reporte 233
- Método: GET
- URL: /api/reports/233/preview
- Headers: Authorization: Bearer <JWT>
- Query Parameters:
  - `year` (requerido): Año fiscal (ej: 2025)
  - `quarter` (opcional): Trimestre fiscal (Q1, Q2, Q3, Q4)
  - `concept` (opcional): Concepto de facturación (all, matricula, comedor) - default: all
  - `studentId` (opcional): ID específico del estudiante
  - `studentName` (opcional): Filtro por nombre/apellido del estudiante (case-insensitive)
  - `centerCode` (opcional): Código del centro educativo
  - `includeMonths` (opcional): Incluir desglose mensual (true/false)
  - `page` (opcional): Número de página para paginación - default: 1
  - `pageSize` (opcional): Registros por página - default: 25

### Generar Reporte 233
- Método: POST
- URL: /api/reports/233/generate
- Headers: Authorization: Bearer <JWT>, Content-Type: application/json
- Body (JSON):
  ```json
  {
    "year": 2025,
    "quarter": "Q1",
    "concept": "all",
    "format": "csv",
    "centerCode": "12345"
  }
  ```
- Formatos disponibles:
  - **CSV**: Genera archivo CSV y lo sube a Cloudinary, retorna URL
  - **XLSX**: Genera archivo Excel y lo sube a Cloudinary, retorna URL
  - **PDF**: (Pendiente de implementación)

#### Respuesta para formato CSV:
```json
{
  "stored": true,
  "cloudinary": {
    "public_id": "Strapi/pizquito/reports/233/2025/10/modelo233_2025_ALL_abc123.csv",
    "resource_type": "raw"
  },
  "url": "https://res.cloudinary.com/denkemd6s/raw/upload/v1761238573/Strapi/pizquito/reports/233/2025/10/modelo233_2025_ALL_abc123.csv",
  "meta": {
    "year": 2025,
    "quarter": "Q1",
    "concept": "all",
    "format": "csv",
    "folder": "Strapi/pizquito/reports/233/2025/10"
  }
}
```

#### Respuesta para formato XLSX:
```json
{
  "stored": true,
  "cloudinary": {
    "public_id": "Strapi/pizquito/reports/233/2025/10/modelo233_2025_ALL_f13rek.xlsx",
    "resource_type": "raw"
  },
  "url": "https://res.cloudinary.com/denkemd6s/raw/upload/v1761238573/Strapi/pizquito/reports/233/2025/10/modelo233_2025_ALL_f13rek.xlsx",
  "meta": {
    "year": 2025,
    "quarter": "Q1",
    "concept": "all",
    "format": "xlsx",
    "folder": "Strapi/pizquito/reports/233/2025/10"
  }
}
```

**Nota**: Ambos formatos ahora retornan URLs de Cloudinary para descargar los archivos generados. Los archivos se organizan automáticamente en carpetas por año y mes.

### Historial de Reportes 233
- Método: GET
- URL: /api/reports/233/history
- Headers: Authorization: Bearer <JWT>
- Query Parameters:
  - `year` (opcional): Filtrar por año fiscal (ej: 2025)
  - `quarter` (opcional): Filtrar por trimestre fiscal (Q1, Q2, Q3, Q4)
  - `concept` (opcional): Filtrar por concepto (all, matricula, comedor)
  - `format` (opcional): Filtrar por formato (csv, xlsx, pdf)
  - `centerCode` (opcional): Filtrar por código del centro educativo
  - `startDate` (opcional): Fecha de inicio para filtrar (formato: YYYY-MM-DD)
  - `endDate` (opcional): Fecha de fin para filtrar (formato: YYYY-MM-DD)
  - `page` (opcional): Número de página para paginación - default: 1
  - `pageSize` (opcional): Registros por página - default: 25

#### Respuesta del Historial:
```json
{
  "data": [
    {
      "id": 123,
      "name": "modelo233_2025_ALL_abc123.csv",
      "url": "https://res.cloudinary.com/denkemd6s/raw/upload/v1761238573/Strapi/pizquito/reports/233/2025/10/modelo233_2025_ALL_abc123.csv",
      "format": "csv",
      "size": 2048,
      "createdAt": "2025-01-23T10:30:00.000Z",
      "updatedAt": "2025-01-23T10:30:00.000Z",
      "metadata": {
        "year": 2025,
        "month": 10,
        "quarter": "Q1",
        "concept": "all",
        "centerCode": "12345"
      },
      "cloudinary": {
        "public_id": "Strapi/pizquito/reports/233/2025/10/modelo233_2025_ALL_abc123.csv",
        "resource_type": "raw"
      }
    }
  ],
  "meta": {
    "pagination": {
      "page": 1,
      "pageSize": 25,
      "pageCount": 1,
      "total": 1
    },
    "filters": {
      "year": 2025,
      "quarter": null,
      "concept": null,
      "format": null,
      "centerCode": null,
      "startDate": null,
      "endDate": null
    }
  }
}
```

### Guardians
- Plural: guardians
- Ejemplos:
  - GET /api/guardians
  - POST /api/guardians

### Classrooms
- Plural: classrooms
- Ejemplos:
  - GET /api/classrooms
  - POST /api/classrooms

## Backups (Simplificado)

Endpoints:
- Listar backups: GET /api/backups
- Crear backup simple: POST /api/backups
- Descargar backup: GET /api/backups/:documentId/download
- Eliminar backup: DELETE /api/backups/:documentId
- Restaurar backup: POST /api/backups/:documentId/restore
- Restaurar desde archivo subido: POST /api/backups/restore/upload (multipart/form-data)
- Sincronizar backups (limpiar archivos huérfanos): POST /api/backups/sync
  - Revisa archivos físicos en `/backups/` y los compara con registros de BD
  - Por defecto: elimina archivos huérfanos
  - Query parameter opcional: `removeOrphans=false` para NO eliminar archivos
- Exportar resumen XLSX (BD actual): GET /api/backups/export/xlsx

Notas importantes:
- Autenticación: requiere JWT del plugin users-permissions y permisos en Roles (Authenticated o Public según se desee). Por defecto, estos endpoints están protegidos.
- Ubicación de archivos: todos los backups se almacenan en la carpeta local /backups del proyecto.
- Base de datos:
  - Si el cliente es sqlite: se copia el archivo .tmp/data.db a /backups/backup_YYYYMMDD_hhmmss.sqlite.
  - Si el cliente es mysql/postgres: se exporta todo el contenido como JSON a /backups/backup_YYYYMMDD_hhmmss.json.
- Restauración:
  - Sqlite: se copia el archivo del backup sobre .tmp/data.db y se crea una copia de seguridad previa (restore_safety_...). Puede reiniciarse el servidor automáticamente si BACKUP_AUTO_RESTART=true o si envías { autoRestart: true } en el body.
  - PostgreSQL/MySQL: restaura desde archivos JSON con transacciones seguras. Crea backup de seguridad automático antes de restaurar. Limpia y reinserta todos los datos (excepto tabla backups).
- Exportación XLSX:
  - Endpoints:
    - Actual: GET /api/backups/export/xlsx — genera el Excel desde la base de datos actualmente en uso.
  - Características del XLSX:
    - Hoja "Resumen" (conteo por tipo) y hojas por cada tipo (hasta 200 registros) con campos básicos: id, createdAt, updatedAt y hasta 6 campos de texto.
  - Limitaciones actuales:
    - Solo exporta desde la base de datos actualmente en uso. No se admite exportar desde archivos de backup.
  - Parámetros opcionales:
    - limit: número de filas por hoja (por defecto 200).
  - Pensado para ofrecer al director una noción clara del contenido sin exponer datos sensibles.

Ejemplos rápidos:
- Crear backup simple:
  - POST /api/backups
  - Body opcional: { "description": "Backup manual de prueba" }
  - Respuesta: { data: { filename, filePath, originalSize, checksum, statusBackup: "completed", backupType: "manual", metadata: { ... } } }
- Listar backups:
  - GET /api/backups?sort[0]=createdAt:desc&pagination[page]=1&pagination[pageSize]=10
- Descargar backup:
  - GET /api/backups/:documentId/download
- Eliminar backup:
  - DELETE /api/backups/:documentId
- Restaurar backup (sqlite):
  - POST /api/backups/:documentId/restore
  - Body opcional: { "autoRestart": true }
- Restaurar desde archivo subido (sqlite):
  - POST /api/backups/restore/upload
  - Content-Type: multipart/form-data (campo "file" con el .sqlite)
  - Body opcional: { "autoRestart": true }
- Exportar resumen XLSX (BD actual):
  - GET /api/backups/export/xlsx
  - Respuesta: archivo application/vnd.openxmlformats-officedocument.spreadsheetml.sheet con Content-Disposition: attachment

### Enrollments
- Plural: enrollments
- Ejemplos:
  - GET /api/enrollments?populate=student,classroom,employees,guardians,services
  - POST /api/enrollments

### Invoices
- Plural: invoices
- Ejemplos:
  - GET /api/invoices
  - POST /api/invoices

### Observations
- Plural: observations
- Ejemplos:
  - GET /api/observations
  - POST /api/observations

### Promotions
- Plural: promotions
- Ejemplos:
  - GET /api/promotions
  - POST /api/promotions

### Services
- Plural: services
- Ejemplos:
  - GET /api/services
  - POST /api/services

### School Periods
- Plural: school-periods
- Nota: el plural incluye guion.
- Ejemplos:
  - GET /api/school-periods
  - POST /api/school-periods

## Content Types (Single Types)
Estos content types usan endpoints de singleType:
- Obtener: GET /api/<singular>
- Actualizar: PUT /api/<singular>

### Global
- Singular: global
- Ejemplos:
  - GET /api/global
  - PUT /api/global
    Body JSON:
    {
      "data": {
        "siteName": "Mi Sitio",
        "siteDescription": "Descripción",
        "defaultSeo": { /* componente shared.seo */ }
      }
    }

### Company
- Singular: company
- Ejemplos:
  - GET /api/company
  - PUT /api/company

## Cabeceras comunes para Postman
- Content-Type: application/json (para JSON)
- Authorization: Bearer <JWT> (para endpoints protegidos)

## Billing Configuration (CRON Day) - Single Type

### Obtener configuración del CRON
- Método: GET
- URL: /api/cron-day
- Headers: Authorization: Bearer <JWT>
- Respuesta: configuración actual del CRON de facturación

### Actualizar configuración del CRON
- Método: PUT
- URL: /api/cron-day
- Headers: Authorization: Bearer <JWT>, Content-Type: application/json
- Body (JSON):
  {
    "data": {
      "cron_day": 25,                    // Día del mes (1-31)
      "cron_hour": 5,                    // Hora (0-23)
      "cron_minute": 0,                  // Minuto (0-59)
      "test_mode": false,                // Modo test (true/false)
      "test_interval_minutes": 5,        // Intervalo en modo test
      "timezone": "Europe/Madrid",       // Zona horaria
      "is_active": true,                 // CRON activo (true/false)
      "execution_notes": "Configuración actualizada",  // Notas
      "last_execution": "2025-10-20T10:30:00.000Z",   // Última ejecución
      "next_execution": "2025-11-25T10:30:00.000Z"    // Próxima ejecución
    }
  }

### System Logs (Logs del sistema)
- Listar todos los logs: GET /api/histories
- Logs de ejecución del CRON: GET /api/histories?filters[event_type][$eq]=cron_execution
- Logs de facturación del CRON: GET /api/histories?filters[event_type][$contains]=cron_billing
- Headers: Authorization: Bearer <JWT>

## Backups (Gestión de respaldos de base de datos)

### Listar backups
- Método: GET
- URL: /api/backups
- Headers: Authorization: Bearer <JWT>
- Query params opcionales: filters, sort, pagination
- Respuesta: 
  ```json
  {
    "data": [
      {
        "id": 1,
        "filename": "backup_2024-01-15T10-30-00-000Z.db",
        "originalSize": 2048576,
        "compressedSize": 1024288,
        "checksum": "sha256_hash",
        "status": "completed",
        "backupType": "manual",
        "description": "Manual backup before update",
        "filePath": "/path/to/backup.db",
        "fileExists": true,
        "sizeFormatted": "2.0 MB",
        "createdAt": "2024-01-15T10:30:00.000Z",
        "metadata": { ... }
      }
    ],
    "meta": { "total": 5 }
  }
  ```

### Obtener detalles de backup
- Método: GET
- URL: /api/backups/:id
- Headers: Authorization: Bearer <JWT>
- Respuesta: objeto backup con detalles completos

### Crear backup manual
- Método: POST
- URL: /api/backups
- Headers: Authorization: Bearer <JWT>, Content-Type: application/json
- Body (JSON):
  ```json
  {
    "description": "Backup antes de migración importante"
  }
  ```
- Respuesta:
  ```json
  {
    "data": { ... },
    "message": "Backup created successfully"
  }
  ```

### Restaurar backup
- Método: POST
- URL: /api/backups/:id/restore
- Headers: Authorization: Bearer <JWT>
- ⚠️ **OPERACIÓN CRÍTICA**: Requiere permisos de administrador
- Respuesta:
  ```json
  {
    "data": {
      "success": true,
      "message": "Database restored successfully",
      "restoredFrom": "backup_2024-01-15T10-30-00-000Z.db",
      "safetyBackup": "backup_2024-01-15T11-00-00-000Z.db"
    },
    "message": "Database restored successfully. Please restart the application to ensure all connections are refreshed."
  }
  ```

### Descargar backup
- Método: GET
- URL: /api/backups/:id/download
- Headers: Authorization: Bearer <JWT>
- Respuesta: Archivo binario (.db) para descarga

### Eliminar backup
- Método: DELETE
- URL: /api/backups/:id
- Headers: Authorization: Bearer <JWT>
- Respuesta:
  ```json
  {
    "data": {
      "success": true,
      "message": "Backup deleted successfully"
    }
  }
  ```

### Limpiar backups antiguos
- Método: POST
- URL: /api/backups/cleanup
- Headers: Authorization: Bearer <JWT>, Content-Type: application/json
- Body (JSON):
  ```json
  {
    "retentionDays": 30
  }
  ```
- Respuesta:
  ```json
  {
    "data": {
      "deletedCount": 3,
      "message": "Cleaned up 3 old backups"
    }
  }
  ```

### Códigos de error específicos de Backups
- 400: ID de backup inválido
- 401: Autenticación requerida
- 403: Permisos insuficientes (especialmente para restore)
- 404: Backup no encontrado o archivo no existe
- 500: Error en operación de backup/restore

### Notas importantes sobre Backups
- **Seguridad**: Todos los endpoints requieren autenticación
- **Restauración**: Crea automáticamente un backup de seguridad antes de restaurar
- **Integridad**: Verifica la integridad de los backups antes de operaciones críticas
- **Almacenamiento**: Los archivos se guardan en `/backups/` (no incluidos en git)
- **Reinicio**: Después de restaurar, se recomienda reiniciar la aplicación

## Statistics (Estadísticas)

### Dashboard Principal
- Método: GET
- URL: /api/statistics/dashboard
- Headers: Authorization: Bearer <JWT>
- Descripción: Obtiene estadísticas completas del dashboard
- Respuesta:
  ```json
  {
    "data": {
       "pendingInvoices": {
         "enrollmentActive": 2,
         "employeeActive": 1,
         "total": 3
       },
      "ageDistribution": {
        "distribution": {
          "0-2": 5,
          "3-5": 12,
          "6-8": 8,
          "9-11": 15,
          "12-14": 10,
          "15+": 3
        },
        "averageAge": 8.5,
        "largestGroup": {
          "range": "9-11",
          "count": 15
        },
        "totalStudents": 53
      },
      "classroomCapacity": {
        "totalClassrooms": 8,
        "totalCapacity": 200,
        "totalOccupied": 150,
        "occupancyPercentage": 75.0,
        "availableClassrooms": 3,
        "fullClassrooms": 5
      },
      "paymentStats": {
        "enrollments": {
          "totalInvoices": 45,
          "totalAmount": 12500.00,
          "paidInvoices": 30,
          "pendingInvoices": 15
        },
        "employees": {
          "totalInvoices": 12,
          "totalAmount": 25000.00,
          "paidInvoices": 10,
          "pendingInvoices": 2
        },
        "general": {
          "totalInvoices": 8,
          "totalAmount": 3500.00,
          "paidInvoices": 6,
          "pendingInvoices": 2
        }
      },
      "recent": {
        "upcomingInvoices": [
          {
            "title": "Matrícula Octubre - Juan Pérez",
            "expirationDate": "2025-11-15T00:00:00.000Z",
            "amount": 250.00,
            "status": "unpaid"
          }
        ],
        "enrollments": [
          {
            "studentName": "María García",
            "enrollmentDate": "2025-10-30T10:30:00.000Z",
            "status": "active"
          }
        ],
        "students": [
          {
            "studentName": "Carlos López",
            "registrationDate": "2025-10-29T15:45:00.000Z",
            "status": "active"
          }
        ]
      },
      "monthlyStats": {
        "monthlyData": {
          "2025-05": { "students": 5, "enrollments": 8 },
          "2025-06": { "students": 3, "enrollments": 5 },
          "2025-07": { "students": 7, "enrollments": 10 },
          "2025-08": { "students": 4, "enrollments": 6 },
          "2025-09": { "students": 6, "enrollments": 9 },
          "2025-10": { "students": 8, "enrollments": 12 }
        },
        "averages": {
          "studentsPerMonth": 5.5,
          "enrollmentsPerMonth": 8.3
        },
        "totals": {
          "students": 33,
          "enrollments": 50
        }
      }
    },
    "meta": {
      "timestamp": "2025-10-31T14:45:23.717Z",
      "endpoint": "dashboard"
    }
  }
  ```

### Estadísticas de Inscripción
- Método: GET
- URL: /api/statistics/enrollment/:documentId
- Headers: Authorization: Bearer <JWT>
- Parámetros: documentId (string) - ID del documento de la inscripción
- Descripción: Obtiene estadísticas de recibos para una inscripción específica
- Ejemplo: GET /api/statistics/enrollment/jx2dxictp08eq7tnpjgrikfz
- Respuesta:
  ```json
  {
    "data": {
      "enrollmentId": "jx2dxictp08eq7tnpjgrikfz",
      "enrollmentTitle": "Enrollment Juan - Con Periodo",
      "invoiceStats": {
        "totalInvoices": 12,
        "totalAmount": 3000.00,
        "paidInvoices": 8,
        "pendingInvoices": 4
      }
    },
    "meta": {
      "timestamp": "2025-10-31T14:45:23.717Z",
      "endpoint": "enrollmentStats",
      "documentId": "jx2dxictp08eq7tnpjgrikfz"
    }
  }
  ```

### Estadísticas de Nóminas de Empleado
- Método: GET
- URL: /api/statistics/employee/:documentId/payroll
- Headers: Authorization: Bearer <JWT>
- Parámetros: documentId (string) - ID del documento del empleado
- Descripción: Obtiene estadísticas de nóminas para un empleado específico
- Ejemplo: GET /api/statistics/employee/abc123def456/payroll
- Respuesta:
  ```json
  {
    "data": {
      "employeeId": "abc123def456",
      "employeeName": "Ana Martínez",
      "payrollStats": {
        "totalPayrolls": 6,
        "totalAmount": 12000.00,
        "paidPayrolls": 5,
        "pendingPayrolls": 1
      }
    },
    "meta": {
      "timestamp": "2025-10-31T14:45:23.717Z",
      "endpoint": "employeePayrollStats",
      "documentId": "abc123def456"
    }
  }
  ```

### Códigos de error específicos de Statistics
- 400: DocumentId requerido o inválido
- 401: Autenticación requerida
- 403: Permisos insuficientes
- 404: Inscripción o empleado no encontrado
- 500: Error interno del servidor

### Notas importantes sobre Statistics
- **Autenticación**: Todos los endpoints requieren autenticación
- **Permisos**: Verificar que el rol tenga permisos para acceder a statistics
- **Performance**: Los cálculos se realizan en tiempo real
- **Datos**: Las estadísticas reflejan el estado actual de la base de datos
- **Filtros**: El dashboard incluye solo registros publicados (publishedAt no nulo)

## Parámetros de consulta (Query params)
- pagination[page]=1&pagination[pageSize]=25
- sort=createdAt:desc
- filters[<campo>][$eq|$ne|$contains|$in|$gte|$lte]=valor
- populate=*
- fields=campo1,campo2

Ejemplo avanzado:
GET /api/students?filters[lastname][$contains]=Pérez&populate=observations,files&sort=createdAt:desc&pagination[page]=1&pagination[pageSize]=25

## Flujo de prueba típico en Postman
1. Login (POST /api/auth/local) y guarda el jwt en una variable de entorno Postman (e.g., token).
2. Usa la cabecera Authorization: Bearer {{token}} en las colecciones protegidas.
3. Crea un Student (POST /api/students) con los campos mínimos requeridos.
4. Lista Students (GET /api/students) y verifica el nuevo entry.
5. Actualiza el Student (PUT /api/students/:id).
6. Prueba filtros y populate.
7. Sube un archivo (POST /api/upload) y luego relaciónalo con un entry si es necesario.
8. Prueba single types: GET/PUT /api/global y /api/company.

## Respuestas y errores comunes
- 200/201: operación exitosa (GET/POST).
- 400: body inválido o campos requeridos faltantes.
- 401: falta Authorization o JWT inválido.
- 403: el rol no tiene permisos para el recurso.
- 404: recurso no encontrado.

## Notas de permisos
Asegúrate de habilitar los permisos de cada endpoint para el rol correspondiente (e.g., Authenticated) en Strapi > Settings > Roles & Permissions. Si recibes 403, revisa esos permisos.