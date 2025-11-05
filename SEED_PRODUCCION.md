# 🚀 Ejecutar Seed en Producción

## 🔧 Configuración Previa

### Variables de Entorno

En el archivo `.env` de producción, agregar:

#### Reemplaza con tu dominio y credenciales de administrador

```env
STRAPI_URL=http://tu-dominio:1337/api
ADMIN_EMAIL=tu-email@admin.com
ADMIN_PASSWORD=tu-password-segura
```

## 🐳 Método 1: Dentro del Contenedor Docker (Recomendado)

### Acceder al Contenedor

```bash
# Listar contenedores en ejecución
docker ps

# Acceder al contenedor de Strapi
docker exec -it nombre_contenedor_strapi sh
```

### Ejecutar el Seed

```bash
# Desde dentro del contenedor
cd /app
node seed-data.js

# O en un solo comando
docker exec nombre_contenedor_strapi node /app/seed-data.js
```

## 🌐 Método 2: Desde el Servidor (SSH)

```bash
# Conectarse al servidor
ssh usuario@tu-servidor

# Navegar al directorio de la app
cd /ruta/a/pizquito-backend-strapi

# Ejecutar el seed
node seed-data.js
```

## ✅ Verificación

### Antes de Ejecutar

- [ ] Backup de la base de datos realizado
- [ ] Variables de entorno configuradas correctamente
- [ ] Credenciales de admin válidas para el entorno
- [ ] Strapi ejecutándose en el puerto correcto

### Después de Ejecutar

- [ ] Revisar logs de la consola
- [ ] Verificar datos creados en el admin de Strapi
- [ ] Confirmar relaciones entre entidades

## 🗄️ Backup de Base de Datos

### PostgreSQL

```bash
pg_dump -U usuario -d basedatos > backup_pre_seed_$(date +%Y%m%d_%H%M%S).sql
```

### SQLite

```bash
cp database/data.db database/backup_data_$(date +%Y%m%d_%H%M%S).db
```

## 🔍 Troubleshooting

### Error de Autenticación

```bash
# Verificar que el usuario admin exista
# Revisar credenciales en el .env
```

### Error de Conexión

```bash
# Verificar que STRAPI_URL sea correcta
# Confirmar que el firewall permita conexiones
# Revisar que Strapi esté ejecutándose
```

### Error de Permisos

```bash
# Verificar permisos de escritura en la base de datos
# Revisar que el usuario tenga acceso a todas las tablas
```

## 📊 Configuración Actual del Seed

- **API URL**: Usa `STRAPI_URL` del .env o default
- **Estudiantes**: 2 registros
- **Tutores**: 3 registros
- **Empleados**: 1 registro
- **Aulas**: 2 registros
- **Servicios**: 6 registros
- **Matrículas**: 2 registros

## 🚨 Notas de Producción

Este seed está diseñado principalmente para **desarrollo y testing**. Para producción:

1. **Considera crear un script específico** que no borre datos existentes
2. **Implementa validaciones adicionales** para entornos productivos
3. **Usa flags de entorno** para controlar el comportamiento
4. **Agrega logging detallado** para auditoría

## 📋 Checklist Pre-Ejecución

- [ ] Backup completo de la base de datos
- [ ] Variables de entorno configuradas
- [ ] Credenciales de admin verificadas
- [ ] Strapi ejecutándose correctamente
- [ ] Conexión a la API verificada
- [ ] Entorno identificado como no productivo

---

**⚠️ ADVERTENCIA**: No ejecutar en entornos productivos con datos reales sin las debidas precauciones.
