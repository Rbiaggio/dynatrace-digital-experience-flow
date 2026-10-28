"""banco-pagamentos: Pix do Banco Demo, para os três canais. Banco próprio, o Postgres "pagamentos", com as transações
Pix. O débito vai para o razão da conta no serviço de contas (saldo e lançamentos), como num core bancário.

Falha forçada do laboratório: ~8% dos Pix falham no processador de pagamentos (HTTP 500, trace com falha).
Falha REGIONAL simulada: o gerador de carga manda a região da sessão em X-Lab-Regiao (a API repassa); nas regiões de
FALHA_REGIONAL (padrão "RJ=0.6,PE=0.4") o Pix falha com essa probabilidade, como um processador regional instável.
"""
import os, random, time

import psycopg2
import psycopg2.extras
import requests
from flask import Flask, jsonify, request

DSN = os.environ.get("DATABASE_URL", "postgresql://pagamentos:pagamentos@pagamentos-db:5432/pagamentos")
CONTAS = os.environ.get("CONTAS_URL", "http://contas:5000").rstrip("/")
FALHA_REGIONAL = {k.strip(): float(v) for k, v in (p.split("=") for p in os.environ.get("FALHA_REGIONAL", "RJ=0.6,PE=0.4").split(",") if "=" in p)}
app = Flask("banco-pagamentos")   # nome do serviço no Dynatrace (Flask = nome da aplicação), igual ao container


class ProcessadorIndisponivel(RuntimeError):
    """Falha simulada do processador de pagamentos."""


@app.errorhandler(ProcessadorIndisponivel)
def _erro_processador(e):
    app.logger.error("pix falhou: %s", e)
    return jsonify({"erro": str(e)}), 500


def conectar():
    ultimo = None
    for _ in range(30):
        try:
            return psycopg2.connect(DSN)
        except psycopg2.OperationalError as e:  # banco ainda subindo
            ultimo = e
            time.sleep(1)
    raise ultimo


def garantir_tabelas():
    try:
        with conectar() as cx, cx.cursor() as cur:
            cur.execute("select pg_advisory_xact_lock(4244)")
            cur.execute("""create table if not exists pix (
                             id bigserial primary key, conta text not null, favorecido text not null, chave text,
                             valor numeric(14,2) not null, status text not null, comprovante text, lancamento bigint,
                             criado_em timestamptz not null default now())""")
    except (psycopg2.errors.UniqueViolation, psycopg2.errors.DuplicateTable, psycopg2.errors.DuplicateObject):
        pass


def numero(v):
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v or "").strip().replace(".", "").replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return 0.0


def contas(metodo, caminho, corpo=None):
    r = requests.request(metodo, CONTAS + caminho, json=corpo, timeout=10)
    dados = r.json() if r.headers.get("content-type", "").startswith("application/json") else {"erro": r.text[:200]}
    if r.status_code >= 400:
        raise RuntimeError(dados.get("erro") or f"contas HTTP {r.status_code}")
    return dados


@app.get("/health")
def health():
    with conectar() as cx, cx.cursor() as cur:
        cur.execute("select 1")
    return jsonify({"ok": True})


@app.post("/contas/<conta>/pix")
def pix(conta):
    d = request.get_json(silent=True) or {}
    valor = numero(d.get("valor"))
    favorecido = str(d.get("favorecido") or "").strip() or "Favorecido"
    chave = str(d.get("chave") or "").strip()
    if valor <= 0:
        return jsonify({"erro": "valor inválido"}), 400
    # LAB: ~8% dos Pix falham no "processador de pagamentos" (exceção -> HTTP 500 -> trace com falha); mais nas
    # regiões de FALHA_REGIONAL
    if random.random() < FALHA_REGIONAL.get(request.headers.get("X-Lab-Regiao", ""), 0.08):
        raise ProcessadorIndisponivel("processador de pagamentos indisponível (falha forçada do laboratório)")
    saldo = contas("GET", f"/contas/{conta}/saldo")["saldo"]
    if saldo < valor:
        return jsonify({"erro": f"saldo insuficiente (disponível R$ {saldo:.2f})"}), 422
    with conectar() as cx, cx.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("insert into pix (conta, favorecido, chave, valor, status) values (%s, %s, %s, %s, 'pendente') returning id",
                    (conta, favorecido, chave, valor))
        pid = cur.fetchone()["id"]
        cx.commit()
        lanc = contas("POST", f"/contas/{conta}/lancamentos", {"descricao": f"Pix enviado - {favorecido}", "valor": -valor})
        comprovante = "E" + time.strftime("%Y%m%d%H%M%S") + f"{pid:06d}"
        cur.execute("update pix set status = 'confirmado', comprovante = %s, lancamento = %s where id = %s", (comprovante, lanc["id"], pid))
        return jsonify({"status": "confirmado", "id": comprovante, "valor": valor, "favorecido": favorecido,
                        "chave": chave, "saldo": lanc["saldo"]}), 201


@app.get("/contas/<conta>/pix/<comprovante>")
def consultar_pix(conta, comprovante):
    """Comprovante de um Pix."""
    with conectar() as cx, cx.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("""select comprovante as id, favorecido, chave, valor::float as valor, status,
                              to_char(criado_em, 'YYYY-MM-DD HH24:MI:SS') as data
                       from pix where conta = %s and comprovante = %s""", (conta, comprovante))
        return jsonify(cur.fetchone() or {"status": "não encontrado"})


garantir_tabelas()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
