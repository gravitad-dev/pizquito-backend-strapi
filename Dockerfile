FROM --platform=linux/amd64 node:20-alpine

# Dependencies needed for sharp and other native modules
RUN apk update && apk add --no-cache \
    build-base \
    gcc \
    autoconf \
    automake \
    zlib-dev \
    libpng-dev \
    nasm \
    bash \
    vips-dev \
    python3 \
    make \
    g++

ENV NODE_ENV=${NODE_ENV}

WORKDIR /opt/
COPY package.json ./

# Fix sharp compilation: install node-addon-api first
RUN npm install node-addon-api --save

# Install project dependencies
RUN npm install && \
    npm install pg --save

WORKDIR /opt/app
COPY . .

# Avoid building SWC native binaries in Alpine
ENV DISABLE_SWC=true

# Change ownership before switching user
RUN chown -R node:node /opt/app
USER node

# Build the application
RUN npm run build

EXPOSE 1337
CMD ["npm", "run", "start"]
