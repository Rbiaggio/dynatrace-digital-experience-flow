# contexto de build = pasta lab/ (para enxergar oneagent/), igual à banco-api
FROM node:20-slim
ARG DT_PAAS_TOKEN=""
ARG DT_TENANT_URL=""
WORKDIR /app
COPY oneagent/install-oneagent.sh oneagent/entrypoint.sh /tmp/oneagent/
RUN DT_PAAS_TOKEN="$DT_PAAS_TOKEN" DT_TENANT_URL="$DT_TENANT_URL" sh /tmp/oneagent/install-oneagent.sh nodejs \
 && cp /tmp/oneagent/entrypoint.sh /entrypoint.sh && chmod +x /entrypoint.sh
COPY mobile-api/package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY mobile-api/server.js ./
ENV NODE_ENV=production
EXPOSE 3000
ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "server.js"]
