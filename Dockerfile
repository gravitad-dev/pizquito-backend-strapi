FROM --platform=linux/amd64 node:18-alpine

# Installing libvips-dev for sharp Compatibility + build tools for native modules
RUN apk update && apk add --no-cache build-base gcc autoconf automake zlib-dev libpng-dev nasm bash vips-dev python3 make g++

ENV NODE_ENV=${NODE_ENV}

WORKDIR /opt/
COPY package.json package-lock.json ./

# Install dependencies with longer timeout and rebuild native modules
RUN npm config set fetch-retry-maxtimeout 600000 -g && \
    npm install && \
    npm install pg --save && \
    npm rebuild

WORKDIR /opt/app
COPY . .

# Rebuild native modules after copying source code
RUN npm rebuild @swc/core

ENV PATH /opt/node_modules/.bin:$PATH

# Change ownership and switch user
RUN chown -R node:node /opt/app
USER node
ENV DISABLE_SWC=true
# Build the application
RUN ["npm", "run", "build"]

EXPOSE 1337
CMD ["npm", "run", "start"]
