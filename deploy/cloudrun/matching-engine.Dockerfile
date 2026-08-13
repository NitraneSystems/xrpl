# Mirror matching-engine HTTP service (Cloud Run).
# Build from repo root:
#   docker build -f deploy/cloudrun/matching-engine.Dockerfile -t mirror-matching-engine .
#
# This is the TypeScript /action server only — not the FCC tee-node Confidential Space image.

FROM node:22-slim AS build
WORKDIR /ext
COPY fce-matching-engine/typescript/package.json fce-matching-engine/typescript/package-lock.json ./
RUN npm ci
COPY fce-matching-engine/typescript/tsconfig.json ./
COPY fce-matching-engine/typescript/src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /ext/package.json ./
COPY --from=build /ext/node_modules ./node_modules
COPY --from=build /ext/dist ./dist
EXPOSE 8080
USER node
CMD ["node", "dist/main.js"]
