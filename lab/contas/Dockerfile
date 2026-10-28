# contexto de build = pasta lab/ (para enxergar oneagent/)
FROM python:3.12-slim
ARG DT_PAAS_TOKEN=""
ARG DT_TENANT_URL=""
WORKDIR /app
COPY oneagent/install-oneagent.sh oneagent/entrypoint.sh /tmp/oneagent/
RUN DT_PAAS_TOKEN="$DT_PAAS_TOKEN" DT_TENANT_URL="$DT_TENANT_URL" sh /tmp/oneagent/install-oneagent.sh python \
 && cp /tmp/oneagent/entrypoint.sh /entrypoint.sh && chmod +x /entrypoint.sh
COPY contas/requirements.txt ./
RUN pip install --no-cache-dir -q -r requirements.txt
COPY contas/contas.py ./
ENV PYTHONUNBUFFERED=1
EXPOSE 5000
ENTRYPOINT ["/entrypoint.sh"]
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "2", "--access-logfile", "-", "contas:app"]
