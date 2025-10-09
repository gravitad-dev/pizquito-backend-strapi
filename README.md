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
- Employee payroll invoices based on active contract terms

Location: `config/cron-tasks.ts` (task key: `monthly_billing`)

### Default schedule
- Runs at 00:00 (midnight) on the configured day of the month
- Timezone: `Europe/Madrid`
- Default day: `25` (configurable via environment)

Default rule: `0 0 0 ${CRON_BILLING_DAY || 25} * *`

### Configuration (environment variables)
- `CRON_BILLING_DAY` (optional): Day of month to run (defaults to `25`)
- `BILLING_CRON_RULE` (optional): Full cron rule to override the default
  - Examples:
    - `0 0 5 25 * *` → run on the 25th at 05:00 (Europe/Madrid)
    - `0 0 0 1 * *` → run on the 1st at 00:00 (Europe/Madrid)
    - `* * * * *` → every minute (development testing only)

See examples in `.env.example`, `.env.example.development`, and `.env.example.production`.

### What gets created
- Enrollment invoices
  - Only for active enrollments
  - Aggregates amounts from active `student_service` services with `amount > 0`
  - Avoids duplicates by checking invoices within the current month window
- Employee payroll invoices
  - Only for active employees
  - Uses the latest contract term:
    - Monthly: `hourlyRate * workedHours` (or falls back to fixed `hourlyRate`)
    - Weekly/Biweekly/Daily: `hourlyRate * workedHours` (basic estimate)
  - Avoids duplicates by checking invoices within the current month window

### Logs
- On each run, Strapi logs entries like:
  - `[Cron] Ejecutando facturación mensual (alumnos y nóminas)`
  - `[Cron] Facturas de alumnos creadas: <n>`
  - `[Cron] Nóminas de empleados creadas: <n>`

### Testing tips
- Temporarily set `BILLING_CRON_RULE="* * * * *"` in development to verify creation
- Revert to the default monthly schedule once tested
