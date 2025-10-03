const path = require('path');

module.exports = ({ env }) => ({
  connection: {
    client: env('DATABASE_CLIENT', 'sqlite'),
    connection: env('DATABASE_CLIENT') === 'postgres'
      ? {
          host: env('DATABASE_HOST', 'localhost'),
          port: env.int('DATABASE_PORT', 5432),
          database: env('DATABASE_NAME', 'pizquito'),
          user: env('DATABASE_USERNAME', 'pizquito'),
          password: env('DATABASE_PASSWORD', 'pizquito'),
          ssl: env.bool('DATABASE_SSL', false),
        }
      : {
          filename: path.join(__dirname, '..', '..', env('DATABASE_FILENAME', '.tmp/data.db')),
        },
    useNullAsDefault: env('DATABASE_CLIENT') === 'sqlite',
  },
});
