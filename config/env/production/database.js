module.exports = ({ env }) => ({
  connection: {
    client: 'postgres',
    connection: env('DATABASE_URL')
      ? env('DATABASE_URL')
      : {
          host: env('DATABASE_HOST'),
          port: env.int('DATABASE_PORT', 5432),
          database: env('DATABASE_NAME'),
          user: env('DATABASE_USERNAME'),
          password: env('DATABASE_PASSWORD'),
          ssl: env.bool('DATABASE_SSL', true)
            ? { rejectUnauthorized: env.bool('DATABASE_SSL_REJECT_UNAUTHORIZED', false) }
            : false,
        },
    acquireConnectionTimeout: env.int('DB_ACQUIRE_TIMEOUT', 60000),
    pool: { min: env.int('DB_POOL_MIN', 2), max: env.int('DB_POOL_MAX', 10) },
  },
});
