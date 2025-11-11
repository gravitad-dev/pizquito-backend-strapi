import {
  cleanOldHistoryRecords,
  DEFAULT_RUN_EVERY_MINUTE_RULE,
  generateEmployeePayrolls,
  generateEnrollmentInvoices,
  getBillingConfig,
  getMadridTime,
  logCronExecution,
  TaskContext,
  updateExecutionTimestamps,
} from "../src/utils/cron/helpers";
// Nota: Backfill se ejecuta una sola vez en bootstrap (src/index.ts)

console.log("🔧 [Cron] Cargando configuración de cron-tasks.ts");
console.log("🔧 [Cron] Regla del cron:", DEFAULT_RUN_EVERY_MINUTE_RULE);

export default {
  monthly_billing: {
    options: {
      rule: DEFAULT_RUN_EVERY_MINUTE_RULE,
      tz: "Europe/Madrid",
    },
    task: async (ctx: TaskContext) => {
      const startTime = Date.now();

      // Log para confirmar que el cron se está ejecutando
      const madridTime = getMadridTime();
      ctx.strapi.log.info(
        `🔄 [Cron] Ejecutando verificación de facturación - Madrid: ${madridTime.toLocaleString("es-ES", { timeZone: "Europe/Madrid" })} (UTC: ${new Date().toISOString()})`,
      );

      // Obtener configuración de facturación
      const billingConfig = await getBillingConfig(ctx.strapi);

      // Log para ver la configuración obtenida
      ctx.strapi.log.info(
        `🔧 [Cron] Config: active=${billingConfig.isActive}, testMode=${billingConfig.testMode}, interval=${billingConfig.testIntervalMinutes}min, lastExec=${billingConfig.lastExecution?.toISOString()}`,
      );

      // Verificar si el CRON está activo
      if (!billingConfig.isActive) {
        ctx.strapi.log.warn(
          `⏸️  [Cron] Facturación desactivada en configuración - saltando ejecución`,
        );
        return;
      }

      // Si no estamos en modo test, comprobar si es el momento configurado
      const now = madridTime; // Usar la hora de Madrid ya calculada
      if (!billingConfig.testMode) {
        // Solo ejecutar si día, hora y minuto coinciden con la configuración
        if (
          now.getDate() !== billingConfig.day ||
          now.getHours() !== billingConfig.hour ||
          now.getMinutes() !== billingConfig.minute
        ) {
          // Not the configured time -> skip
          return;
        }
      } else {
        // En modo test, verificar si han pasado suficientes minutos desde la última ejecución
        ctx.strapi.log.info(
          `🧪 [Cron] Modo test activado - Verificando última ejecución`,
        );

        if (billingConfig.lastExecution) {
          const nowTime = now.getTime();
          const lastTime = billingConfig.lastExecution.getTime();
          const diffMs = nowTime - lastTime;
          const diffMin = Math.floor(diffMs / (60 * 1000));

          ctx.strapi.log.info(
            `🧪 [Cron] Ahora: ${now.toISOString()}, Última: ${billingConfig.lastExecution.toISOString()}`,
          );
          ctx.strapi.log.info(
            `🧪 [Cron] Diferencia: ${diffMin} minutos (necesarios: ${billingConfig.testIntervalMinutes})`,
          );

          if (diffMin < billingConfig.testIntervalMinutes) {
            // aún no llegó el intervalo mínimo de test -> saltar
            ctx.strapi.log.info(
              `⏳ [Cron] Modo test: faltan ${billingConfig.testIntervalMinutes - diffMin} minutos para la próxima ejecución`,
            );
            return;
          }
        }
        // Si no hay lastExecution o ya pasó el tiempo, continuar con la ejecución
        ctx.strapi.log.info(
          `🧪 [Cron] Modo test: ejecutando (intervalo: ${billingConfig.testIntervalMinutes} min)`,
        );
      }

      const timestamp = new Date().toLocaleString("es-ES", {
        timeZone: billingConfig.timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });

      const modeText = billingConfig.testMode
        ? `MODO TESTEO (cada ${billingConfig.testIntervalMinutes} min)`
        : `MODO PRODUCCIÓN (día ${billingConfig.day} a las ${billingConfig.hour}:${billingConfig.minute.toString().padStart(2, "0")})`;

      ctx.strapi.log.info(
        `🕐 [Cron] INICIO - Ejecutando facturación (${timestamp})`,
      );
      ctx.strapi.log.info(
        `⚙️  [Cron] Configuración: ${modeText} - Zona horaria: ${billingConfig.timezone}`,
      );

      // Registrar inicio en history
      await logCronExecution(ctx.strapi, {
        title: "Cron Facturación - Inicio",
        message: `Iniciando proceso de facturación automática. ${modeText}`,
        level: "INFO",
        event_type: "cron_billing_start",
        payload: {
          billing_config: billingConfig,
          execution_mode: billingConfig.testMode ? "test" : "production",
          timestamp,
        },
      });

      let enrollmentResults = { created: 0, skipped: 0 };
      let payrollResults = { created: 0, skipped: 0 };

      try {
        ctx.strapi.log.info(`📋 [Cron] Generando facturas de enrollment...`);
        enrollmentResults = await generateEnrollmentInvoices({
          strapi: ctx.strapi,
          billingConfig,
        });

        ctx.strapi.log.info(`💰 [Cron] Generando nóminas de empleados...`);
        payrollResults = await generateEmployeePayrolls({
          strapi: ctx.strapi,
          billingConfig,
        });

        const duration = Date.now() - startTime;
        const enrollmentSkippedText =
          enrollmentResults.skipped && enrollmentResults.skipped > 0
            ? ` (${enrollmentResults.skipped} omitidos sin periodo escolar)`
            : "";
        const payrollSkippedText =
          payrollResults.skipped && payrollResults.skipped > 0
            ? ` (${payrollResults.skipped} empleados omitidos por frecuencia de pago)`
            : "";
        const successMessage = `Facturación completada exitosamente. Facturas: ${enrollmentResults.created} creadas${enrollmentSkippedText}. Nóminas: ${payrollResults.created} creadas${payrollSkippedText}.`;

        ctx.strapi.log.info(
          `✅ [Cron] COMPLETADO - ${successMessage} (${timestamp})`,
        );

        // Actualizar fechas de ejecución usando el id correcto
        await updateExecutionTimestamps(
          ctx.strapi,
          new Date(),
          `Ejecución exitosa: ${enrollmentResults.created} facturas${enrollmentSkippedText}, ${payrollResults.created} nóminas${payrollSkippedText}`,
        );

        // Registrar éxito en history
        await logCronExecution(ctx.strapi, {
          title: "Cron Facturación - Completado",
          message: successMessage,
          level: "INFO",
          event_type: "cron_billing_success",
          duration_ms: duration.toString(),
          payload: {
            billing_config: billingConfig,
            execution_duration_ms: duration,
            enrollment_invoices: enrollmentResults,
            employee_payrolls: payrollResults,
            timestamp,
          },
        });
      } catch (error) {
        const duration = Date.now() - startTime;
        const errorMessage = `Falló la facturación: ${(error && (error as Error).message) || error}`;

        ctx.strapi.log.error(`❌ [Cron] ERROR - ${errorMessage}`);

        // Actualizar fechas de ejecución incluso en error
        await updateExecutionTimestamps(
          ctx.strapi,
          new Date(),
          `Error en ejecución: ${errorMessage}`,
        );

        // Registrar error en history
        await logCronExecution(ctx.strapi, {
          title: "Cron Facturación - Error",
          message: errorMessage,
          level: "ERROR",
          event_type: "cron_billing_error",
          duration_ms: duration.toString(),
          status_code: "500",
          payload: {
            billing_config: billingConfig,
            execution_duration_ms: duration,
            error_message: (error && (error as Error).message) || error,
            error_stack:
              error && (error as Error).stack
                ? (error as Error).stack
                : undefined,
            timestamp,
          },
        });

        throw error;
      }
    },
  },

  /**
   * Daily cleanup task: clean old history records (logs)
   * Runs every day at 2:00 AM
   */
  daily_cleanup: {
    options: {
      rule: "0 2 * * *", // Every day at 2:00 AM
      tz: "Europe/Madrid",
    },
    task: async (ctx: TaskContext) => {
      const startTime = Date.now();
      const timestamp = new Date().toLocaleString("es-ES", {
        timeZone: "Europe/Madrid",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });

      ctx.strapi.log.info(
        `🧹 [Cleanup] INICIO - Ejecutando limpieza diaria de logs (${timestamp})`,
      );

      // Registrar inicio en history
      await logCronExecution(ctx.strapi, {
        title: "Cron Limpieza - Inicio",
        message: "Iniciando proceso de limpieza automática de logs antiguos",
        level: "INFO",
        event_type: "cron_cleanup_start",
        payload: {
          timestamp,
          retention_days: 90,
        },
      });

      let historyResults = { deleted: 0 };

      try {
        // Limpiar registros de history antiguos (>90 días)
        ctx.strapi.log.info(
          `📋 [Cleanup] Limpiando registros de history antiguos...`,
        );
        historyResults = await cleanOldHistoryRecords(ctx.strapi, 90);

        const duration = Date.now() - startTime;
        const successMessage = `Limpieza completada exitosamente. History: ${historyResults.deleted} registros eliminados.`;

        ctx.strapi.log.info(
          `✅ [Cleanup] COMPLETADO - ${successMessage} (${timestamp})`,
        );

        // Registrar éxito en history
        await logCronExecution(ctx.strapi, {
          title: "Cron Limpieza - Completado",
          message: successMessage,
          level: "INFO",
          event_type: "cron_cleanup_success",
          duration_ms: duration.toString(),
          payload: {
            execution_duration_ms: duration,
            history_records_deleted: historyResults.deleted,
            retention_days: 90,
            timestamp,
          },
        });
      } catch (error) {
        const duration = Date.now() - startTime;
        const errorMessage = `Falló la limpieza: ${(error && (error as Error).message) || error}`;

        ctx.strapi.log.error(`❌ [Cleanup] ERROR - ${errorMessage}`);

        // Registrar error en history
        await logCronExecution(ctx.strapi, {
          title: "Cron Limpieza - Error",
          message: errorMessage,
          level: "ERROR",
          event_type: "cron_cleanup_error",
          duration_ms: duration.toString(),
          status_code: "500",
          payload: {
            execution_duration_ms: duration,
            error_message: (error && (error as Error).message) || error,
            error_stack:
              error && (error as Error).stack
                ? (error as Error).stack
                : undefined,
            retention_days: 90,
            timestamp,
          },
        });

        throw error;
      }
    },
  },
};
