#!/bin/sh
# Ativa o OneAgent (se a imagem foi construida com ele) e executa o processo da aplicacao.
if [ -f /opt/dynatrace/oneagent/conexao.env ]; then
  . /opt/dynatrace/oneagent/conexao.env
  export DT_CUSTOM_PROP="${DT_CUSTOM_PROP:-lab=banco-demo}"
  echo "OneAgent: ativo (LD_PRELOAD=${LD_PRELOAD})"
else
  echo "OneAgent: imagem sem instrumentacao"
fi
exec "$@"
