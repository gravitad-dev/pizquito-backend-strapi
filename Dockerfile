FROM --platform=linux/amd64 node:20-alpine

# Installing libvips-dev for sharp Compatibility + build tools for native modules
RUN apk update && apk add --no-cache build-base gcc autoconf automake zlib-dev libpng-dev nasm bash vips-dev python3 make g++ postgresql-client

ENV NODE_ENV=${NODE_ENV:-production}

WORKDIR /opt/app

# Copy package files first for better caching
COPY package*.json ./

# Install dependencies with longer timeout
RUN npm config set fetch-retry-maxtimeout 600000 && \
    npm ci --only=production && \
    npm cache clean --force

# Copy source code
COPY . .

# Clean any existing cache and build
RUN rm -rf .cache build dist && \
    chown -R node:node /opt/app

USER node

# Build the application
RUN npm run build

EXPOSE 1337

CMD ["npm", "run", "start"]
