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