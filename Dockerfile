FROM node:22-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S app && adduser -S -G app app
COPY --from=dependencies /app/node_modules ./node_modules
COPY --chown=app:app package.json server.js start.sh ./
COPY --chown=app:app src ./src
COPY --chown=app:app public ./public
COPY --chown=app:app db ./db
USER app
EXPOSE 5311
CMD ["node", "src/server.js"]
