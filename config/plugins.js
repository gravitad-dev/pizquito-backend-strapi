module.exports = ({ env }) => ({
  graphql: {
    enabled: env.bool('STRAPI_PLUGIN_GRAPHQL_ENABLED', true),
    config: { shadowCRUD: env.bool('STRAPI_PLUGIN_GRAPHQL_SHADOW_CRUD', true) },
  },
});
