# Feedback web app (Next.js standalone; spec v3 D16, D29). Default stage = production image.
FROM node:22-alpine AS deps
WORKDIR /web
COPY package.json package-lock.json ./
RUN npm ci

# Local development (Docker Compose): Next dev server, /api forwarded to API_ORIGIN.
FROM deps AS dev
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev", "--", "--hostname", "0.0.0.0"]

FROM deps AS build
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN npm run build

# Cloud Run: the standalone server only, as a non-root user.
FROM node:22-alpine AS prod
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /web/.next/standalone ./
COPY --from=build --chown=app:app /web/.next/static ./.next/static
COPY --from=build --chown=app:app /web/public ./public
USER app
EXPOSE 3000
CMD ["node", "server.js"]
