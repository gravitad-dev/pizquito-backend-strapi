export default ({ env }) => ({
  host: env("HOST", "0.0.0.0"),
  port: env.int("PORT", 1337),
  app: { keys: env.array("APP_KEYS") },
  url: env("URL", "https://pizquito-strapi.gravitad.xyz"),
  proxy: true,
  transfer: {
    remote: { enabled: true }, // <- habilita transfer remotas
    token: { salt: env("TRANSFER_TOKEN_SALT") }, // <- usa tu SALT
  },
});
