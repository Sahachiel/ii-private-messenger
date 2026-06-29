# syntax=docker/dockerfile:1.6
# -------- Build stage --------
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# -------- Runtime stage --------
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist ./dist
# Migrations .sql live next to compiled db/client.js at runtime (tsc doesn't copy non-TS)
COPY --from=build /app/src/db/migrations ./dist/db/migrations
# MTD admin key dir, writable by node user
RUN mkdir -p /app/mtd-keys && chown node:node /app/mtd-keys && chmod 700 /app/mtd-keys
EXPOSE 3000
USER node
CMD ["node", "dist/index.js"]
