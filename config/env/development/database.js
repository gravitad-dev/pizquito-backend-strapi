module.exports = ({ env }) => ({
  connection: {
    client: 'sqlite',
    connection: { filename: env('DATABASE_FILENAME', '.tmp/data.db') },
    acquireConnectionTimeout: 60000,
  },
});
