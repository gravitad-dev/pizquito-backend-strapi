// config/plugins/upload.js
module.exports = ({ env }) => {
  return {
    upload: {
      config: {
        provider: "cloudinary",
        providerOptions: {
          cloud_name: env("CLOUDINARY_NAME"),
          api_key: env("CLOUDINARY_KEY"),
          api_secret: env("CLOUDINARY_SECRET"),
        },

        // Deshabilitar completamente optimizaciones locales para evitar EBUSY en Windows
        breakpoints: {},
        sizeOptimization: false,
        responsiveDimensions: false,
        autoOrientation: false,
        
        // Configuración adicional para evitar procesamiento local
        optimization: {
          enabled: false,
        },
        
        // Evitar generación de thumbnails y formatos adicionales
        generateThumbnails: false,
        generateFormats: false,

        actionOptions: {
          upload: { 
            resource_type: "auto",
            use_filename: true,
            unique_filename: true,
          },
          uploadStream: { 
            resource_type: "auto",
            use_filename: true,
            unique_filename: true,
          },
          delete: {},
        },
        
        // Configuración específica para evitar archivos temporales
        localServer: {
          maxage: 0,
        },
        
        // Deshabilitar completamente el procesamiento local
        skipLocalProcessing: true,
        disableLocalOptimization: true,
      },
    },
  };
};
