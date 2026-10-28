# nginx dos canais web (PF e PJ) com o OneAgent: o agente injeta a tag do RUM nas paginas (aplicacao monitorada pelo
# OneAgent + regra de deteccao por dominio) e responde a correlacao com o backend. Contexto de build = pasta lab/.
# versão FIXA: o OneAgent 1.347 não instrumenta o nginx 1.30.6 (log "Md5 not found", sem injeção do RUM; 14/10/2026)
FROM nginx:1.30.5
ARG DT_PAAS_TOKEN=""
ARG DT_TENANT_URL=""
COPY oneagent/install-oneagent.sh oneagent/entrypoint.sh /tmp/oneagent/
RUN DT_PAAS_TOKEN="$DT_PAAS_TOKEN" DT_TENANT_URL="$DT_TENANT_URL" sh /tmp/oneagent/install-oneagent.sh nginx \
 && cp /tmp/oneagent/entrypoint.sh /oneagent-entrypoint.sh && chmod +x /oneagent-entrypoint.sh
ENTRYPOINT ["/oneagent-entrypoint.sh", "/docker-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
