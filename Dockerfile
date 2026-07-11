# syntax=docker/dockerfile:1

FROM node:20-alpine

ENV NODE_ENV=production

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY --chown=node:node server.js ./
COPY --chown=node:node public ./public
RUN mkdir -p output && chown -R node:node /app

USER node

ENV PORT=5000
EXPOSE 5000

CMD ["npm", "start"]
