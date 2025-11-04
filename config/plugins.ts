export default ({ env }) => ({
  upload: {
    config: {
      provider: "cloudinary",
      providerOptions: {
        cloud_name: env("CLOUDINARY_NAME"),
        api_key: env("CLOUDINARY_KEY"),
        api_secret: env("CLOUDINARY_SECRET"),
      },

      breakpoints: {},
      sizeOptimization: false,
      responsiveDimensions: false,
      autoOrientation: false,

      optimization: {
        enabled: false,
      },

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

      localServer: {
        maxage: 0,
      },

      skipLocalProcessing: true,
      disableLocalOptimization: true,
    },
  },
});
