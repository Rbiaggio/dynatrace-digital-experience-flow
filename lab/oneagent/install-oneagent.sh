#!/bin/sh
# Instala o modulo de codigo do OneAgent (application-only) na imagem, se houver credencial.
# Uso no Dockerfile:  RUN DT_PAAS_TOKEN=... DT_TENANT_URL=... sh /tmp/install-oneagent.sh nodejs|python|nginx
# Sem DT_PAAS_TOKEN/DT_TENANT_URL a imagem sai SEM instrumentacao (o entrypoint segue normal).
#
# Padrao documentado pela Dynatrace para containers: baixar o instalador PaaS (um ZIP, que ja traz
# tenant, token do tenant e endpoints), descompactar e injetar por LD_PRELOAD.
set -eu
TEC="${1:?tecnologia: nodejs | python | nginx}"
if [ -z "${DT_PAAS_TOKEN:-}" ] || [ -z "${DT_TENANT_URL:-}" ]; then
  echo "OneAgent: DT_PAAS_TOKEN/DT_TENANT_URL ausentes - imagem sem instrumentacao"
  exit 0
fi
apt-get update -qq >/dev/null
apt-get install -y -qq --no-install-recommends curl ca-certificates unzip >/dev/null
BASE="${DT_TENANT_URL%/}"
DESTINO=/opt/dynatrace/oneagent
mkdir -p "$DESTINO"
echo "OneAgent: baixando modulo ${TEC} de ${BASE}"
curl -fsSL -H "Authorization: Api-Token ${DT_PAAS_TOKEN}" \
  "${BASE}/api/v1/deployment/installer/agent/unix/paas/latest?include=${TEC}&flavor=default&arch=x86" \
  -o /tmp/oneagent.zip
unzip -q -o /tmp/oneagent.zip -d "$DESTINO"
rm -f /tmp/oneagent.zip
LIB="$DESTINO/agent/lib64/liboneagentproc.so"
if [ ! -f "$LIB" ]; then
  echo "OneAgent: ERRO - $LIB nao existe apos descompactar"; ls -la "$DESTINO" "$DESTINO/agent" 2>/dev/null || true
  exit 1
fi
echo "export LD_PRELOAD=$LIB" > "$DESTINO/conexao.env"
VERSAO=$(sed -n 's/.*"version" *: *"\([^"]*\)".*/\1/p' "$DESTINO/manifest.json" 2>/dev/null | head -1)
echo "OneAgent: modulo ${TEC} instalado (versao ${VERSAO:-?})"
