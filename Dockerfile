FROM node:22

# Installing libvips-dev for sharp compatibility
RUN apt-get update && apt-get install -y \
    build-essential \
    autoconf \
    automake \
    zlib1g-dev \
    libpng-dev \
    libjpeg-dev \
    libvips-dev \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=${NODE_ENV}

# Fix SWC native binding issue
# ENV SWC_DISABLE_BINARY=1

WORKDIR /opt/

COPY package.json ./
RUN npm install --legacy-peer-deps

WORKDIR /opt/app
COPY . .

ENV PATH="/opt/node_modules/.bin:$PATH"

RUN chown -R node:node /opt/app

RUN chmod -R 755 /opt/app

#RUN chown -R node:node /opt/app/public/uploads

USER node

RUN ["npm", "run", "build"]

EXPOSE 1337

CMD ["npm", "run", "start"]
