# 🚀 Getting started with Strapi

Strapi comes with a full featured [Command Line Interface](https://docs.strapi.io/dev-docs/cli) (CLI) which lets you scaffold and manage your project in seconds.

### `develop`

Start your Strapi application with autoReload enabled. [Learn more](https://docs.strapi.io/dev-docs/cli#strapi-develop)

```
npm run develop
# or
yarn develop
```

### `start`

Start your Strapi application with autoReload disabled. [Learn more](https://docs.strapi.io/dev-docs/cli#strapi-start)

```
npm run start
# or
yarn start
```

### `build`

Build your admin panel. [Learn more](https://docs.strapi.io/dev-docs/cli#strapi-build)

```
npm run build
# or
yarn build
```

## ⚙️ Deployment

Strapi gives you many possible deployment options for your project including [Strapi Cloud](https://cloud.strapi.io). Browse the [deployment section of the documentation](https://docs.strapi.io/dev-docs/deployment) to find the best solution for your use case.

```
yarn strapi deploy
```

## ⚙️ Deployment with Docker (using package.json script)

```
npm run test
```

## 📚 Learn more

- [Resource center](https://strapi.io/resource-center) - Strapi resource center.
- [Strapi documentation](https://docs.strapi.io) - Official Strapi documentation.
- [Strapi tutorials](https://strapi.io/tutorials) - List of tutorials made by the core team and the community.
- [Strapi blog](https://strapi.io/blog) - Official Strapi blog containing articles made by the Strapi team and the community.
- [Changelog](https://strapi.io/changelog) - Find out about the Strapi product updates, new features and general improvements.

Feel free to check out the [Strapi GitHub repository](https://github.com/strapi/strapi). Your feedback and contributions are welcome!

## ✨ Community

- [Discord](https://discord.strapi.io) - Come chat with the Strapi community including the core team.
- [Forum](https://forum.strapi.io/) - Place to discuss, ask questions and find answers, show your Strapi project and get feedback or just talk with other Community members.
- [Awesome Strapi](https://github.com/strapi/awesome-strapi) - A curated list of awesome things related to Strapi.

---

<sub>🤫 Psst! [Strapi is hiring](https://strapi.io/careers).</sub>

## 🧾 Monthly Billing Cron

This project includes an automated monthly billing cron that generates:
- Student invoices based on active enrollment services
- Employee payroll invoices based on active contract terms with improved frequency logic

Location: `config/cron-tasks.ts` (task key: `monthly_billing`)

### Configuration Management
The CRON is now fully configurable via the **Billing Configuration** Single Type in Strapi Admin:
- **Day of Month**: When to run billing (1-31)
- **Hour**: Hour to execute (0-23, default: 5)
- **Minute**: Minute to execute (0-59, default: 0)
- **Timezone**: Execution timezone (default: Europe/Madrid)
- **Test Mode**: Enable frequent execution for testing
- **Test Interval**: Minutes between executions in test mode
- **Active Status**: Enable/disable automatic billing
- **Execution Tracking**: Automatic timestamps and notes

### Execution Tracking & Monitoring
The system now includes comprehensive execution tracking:
- **Last Execution**: Automatically updated timestamp of last successful run
- **Next Execution**: Calculated timestamp of next scheduled run
- **Execution Notes**: Detailed results from last execution
- **System Logs**: Complete audit trail with structured logging

### Enhanced Employee Contract Logic
Improved payroll generation based on contract terms:
- **Monthly Contracts**: Billed once per month on the configured billing day
- **Biweekly Contracts**: Billed twice per month (1st and 15th)
- **Weekly Contracts**: Billed every Monday
- **Contract Validation**: Employees without valid contract terms are skipped
- **Frequency Respect**: System respects payment frequencies to avoid duplicate billing

### What gets created
- **Enrollment Invoices**
  - Only for active enrollments
  - Aggregates amounts from active `student_service` services with `amount > 0`
  - Avoids duplicates by checking invoices within the current month window
  - Detailed logging of creation process

- **Employee Payroll Invoices**
  - Only for active employees with valid contract terms
  - Respects payment frequency (monthly/biweekly/weekly)
  - Uses salary from contract terms
  - Skips employees not due for payment based on frequency
  - Comprehensive validation and error handling

### Advanced Logging System
The system now includes structured logging with:
- **Execution Events**: Start, success, error events with full context
- **Trace IDs**: Unique identifiers for tracking execution flows
- **Metadata**: Detailed execution results, configuration, and statistics
- **Error Tracking**: Complete error context and stack traces
- **Performance Metrics**: Execution timing and resource usage

### Log Examples
```
🕐 [Cron] INICIO - Ejecutando facturación mensual (2025-01-20 05:00:00)
⚙️  [Cron] Configuración: MODO PRODUCCIÓN (día 25 a las 05:00) - Zona horaria: Europe/Madrid
📋 [Cron] Generando facturas de enrollment...
👥 [Cron] Enrollments activos encontrados: 15
📊 [Cron] Facturas de alumnos creadas: 15
💰 [Cron] Generando nóminas de empleados...
👷 [Cron] Empleados activos encontrados: 10
📊 [Cron] Resumen de nóminas: 8 creadas, 2 omitidas por frecuencia de pago
✅ [Cron] COMPLETADO - Facturación completada exitosamente (2025-01-20 05:30:00)
```

### Environment Variables (Legacy Support)
While configuration is now managed via Strapi Admin, these environment variables are still supported:
- `BILLING_CRON_RULE` (optional): Full cron rule to override admin configuration
- Legacy variables are maintained for backward compatibility

### Testing & Development
- **Test Mode**: Enable in admin panel for frequent execution (every N minutes)
- **Manual Execution**: Trigger via admin panel or API
- **Detailed Logging**: All executions logged to System Logs collection
- **Configuration Validation**: Real-time validation of cron settings
- **Execution History**: Complete audit trail of all billing runs

### Monitoring & Troubleshooting
- Check **System Logs** collection for execution history
- Review **Billing Configuration** for last execution details
- Monitor execution notes for success/error information
- Use trace IDs to correlate logs across system components
