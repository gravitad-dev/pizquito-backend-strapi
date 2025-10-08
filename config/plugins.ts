// config/plugins/upload.js
module.exports = ({ env }) => {
  const CLOUDINARY_NAME = env("CLOUDINARY_NAME", "");
  const CLOUDINARY_KEY = env("CLOUDINARY_KEY", "");
  const CLOUDINARY_SECRET = env("CLOUDINARY_SECRET", "");

  if (!CLOUDINARY_NAME || !CLOUDINARY_KEY || !CLOUDINARY_SECRET) {
    // Fallar rápido con mensaje claro
    throw new Error(
      "[Config error] Cloudinary env vars missing. Please set CLOUDINARY_NAME, CLOUDINARY_KEY and CLOUDINARY_SECRET.",
    );
  }

  return {
    upload: {
      config: {
        provider: "cloudinary",
        providerOptions: {
          cloud_name: CLOUDINARY_NAME,
          api_key: CLOUDINARY_KEY,
          api_secret: CLOUDINARY_SECRET,
        },
        actionOptions: {
          upload: {
            // ejemplo: carpeta por dia en un solo slug YYYY_MM_DD
            folder: (() => {
              const now = new Date();
              const yyyy = now.getFullYear();
              const mm = String(now.getMonth() + 1).padStart(2, "0");
              const dd = String(now.getDate()).padStart(2, "0");
              return `Strapi/pizquito/files/${yyyy}_${mm}_${dd}`;
            })(),
            resource_type: "auto",
            use_filename: true,
            unique_filename: true,
          },
          uploadStream: {
            folder: (() => {
              const now = new Date();
              const yyyy = now.getFullYear();
              const mm = String(now.getMonth() + 1).padStart(2, "0");
              const dd = String(now.getDate()).padStart(2, "0");
              return `Strapi/pizquito/files/${yyyy}_${mm}_${dd}`;
            })(),
            resource_type: "auto",
            use_filename: true,
            unique_filename: true,
          },
          delete: {},
        },
      },
    },
  };
};
