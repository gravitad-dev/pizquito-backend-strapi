export default ({ env }) => ({
  auth: {
    secret: env('ADMIN_JWT_SECRET'),
    // Configuración de sesiones para la autenticación del Admin (Strapi v5)
    // Nota: admin.auth.options.expiresIn está deprecado en v6; usa sesiones.
    sessions: {
      // Vida del access token (en segundos). Por defecto: 30 minutos.
      accessTokenLifespan: env.int('ADMIN_SESSIONS_ACCESS_TTL', 30 * 60),
      // Vida máxima del refresh token (en segundos). Por defecto: 30 días.
      maxRefreshTokenLifespan: env.int(
        'ADMIN_SESSIONS_MAX_REFRESH_TTL',
        30 * 24 * 60 * 60,
      ),
      // Vida máxima de la sesión (en segundos). Por defecto: 30 días.
      maxSessionLifespan: env.int(
        'ADMIN_SESSIONS_MAX_SESSION_TTL',
        30 * 24 * 60 * 60,
      ),
    },
  },
  apiToken: {
    salt: env('API_TOKEN_SALT'),
  },
  transfer: {
    token: {
      salt: env('TRANSFER_TOKEN_SALT'),
    },
  },
  secrets: {
    encryptionKey: env('ENCRYPTION_KEY'),
  },
  flags: {
    nps: env.bool('FLAG_NPS', true),
    promoteEE: env.bool('FLAG_PROMOTE_EE', true),
  },
});
