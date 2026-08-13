# Mirror XRPL FSA monitor + status API (Cloud Run).
# Build from repo root:
#   docker build -f deploy/cloudrun/xrpl-monitor.Dockerfile -t mirror-xrpl-monitor .
#
# Requires CPU always allocated + min instances = 1 (outbound XRPL WebSocket).

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY scripts/package.json ./
RUN npm install --omit=dev && npm install tsx@4.19.3
COPY scripts ./scripts
COPY config ./config
EXPOSE 8080
USER node
CMD ["npx", "tsx", "scripts/relayer/xrpl-monitor.ts"]
