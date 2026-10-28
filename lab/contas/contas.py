"""banco-contas: domínio de contas do Banco Demo (ex-banco-core). Contas, razão de lançamentos, extrato, abertura de
conta, consulta de CPF e cartão de crédito, no Postgres "banco".

Separação de 07/10/2026: login/sessões/senha foram para o serviço de identidade, ofertas e tarifas para o de ofertas e o
Pix para o de pagamentos, cada um com o próprio banco. Pagamentos usa as rotas internas de saldo e lançamentos daqui
para debitar a conta (o razão é das contas).

Cada conta nova é criada no primeiro acesso, com saldo inicial e três lançamentos de exemplo.
Abertura de conta e cartão de crédito NÃO têm falha forçada.
Cartão NEGADO por renda é desfecho de negócio (HTTP 201, status "negado"), não erro.
"""
import os, random, re, time
from datetime import date, timedelta

import psycopg2
import psycopg2.extras
from flask import Flask, jsonify, request

DSN = os.environ.get("DATABASE_URL", "postgresql://banco:banco@db:5432/banco")
LANCAMENTOS_BASE = [("Supermercado", -212.90, 0), ("Salário", 6500.00, 1), ("Pix recebido", 150.00, 2)]
SALDO_APRESENTADO = 4821.37                      # saldo que a conta nova (varejo) mostra no extrato
SALDO_APRESENTADO_PJ = 148210.37                 # conta PJ (canal Empresas, prefixo "PJ-"): paga lotes de 3 Pix sem esgotar
SOMA_BASE = sum(v for _, v, _ in LANCAMENTOS_BASE)
SALDO_INICIAL = round(SALDO_APRESENTADO - SOMA_BASE, 2)
SALDO_INICIAL_PJ = round(SALDO_APRESENTADO_PJ - SOMA_BASE, 2)
AGENCIA = "1234"
# cartões: renda mínima e teto de limite por tipo (limite = 2x a renda, até o teto)
CARTOES = {"Gold": (1500.0, 5000.0), "Platinum": (5000.0, 20000.0), "Black": (15000.0, 50000.0)}

app = Flask("banco-contas")   # nome do serviço no Dynatrace (Flask = nome da aplicação), igual ao container


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
    """Tabelas de abertura de conta e cartões sem recriar o volume do Postgres.
    Vários workers do gunicorn sobem juntos: o advisory lock serializa o DDL e a duplicidade (sequência já criada
    pelo outro worker) é ignorada."""
    try:
        with conectar() as cx, cx.cursor() as cur:
            cur.execute("select pg_advisory_xact_lock(4242)")
            cur.execute("""create table if not exists aberturas (
                             id bigserial primary key, conta text not null references contas(conta), nome text not null,
                             cpf text not null, email text, renda numeric(14,2), documento text, status text not null,
                             criado_em timestamptz not null default now())""")
            cur.execute("""create table if not exists cartoes (
                             id bigserial primary key, conta text not null references contas(conta), tipo text not null,
                             renda numeric(14,2) not null, limite numeric(14,2), status text not null, motivo text,
                             criado_em timestamptz not null default now())""")
    except (psycopg2.errors.UniqueViolation, psycopg2.errors.DuplicateTable, psycopg2.errors.DuplicateObject):
        pass


def garantir_conta(cur, conta):
    cur.execute("select 1 from contas where conta = %s", (conta,))
    if cur.fetchone():
        return
    cur.execute("insert into contas (conta, saldo_inicial) values (%s, %s)", (conta, SALDO_INICIAL_PJ if conta.startswith("PJ-") else SALDO_INICIAL))
    hoje = date.today()
    for descricao, valor, dias in LANCAMENTOS_BASE:
        cur.execute("insert into lancamentos (conta, data, descricao, valor) values (%s, %s, %s, %s)",
                    (conta, hoje - timedelta(days=dias), descricao, valor))


def saldo_de(cur, conta):
    cur.execute("select saldo_inicial from contas where conta = %s", (conta,))
    inicial = float(cur.fetchone()["saldo_inicial"])
    cur.execute("select coalesce(sum(valor), 0) as s from lancamentos where conta = %s", (conta,))
    return round(inicial + float(cur.fetchone()["s"]), 2)


def brl(v):
    """R$ no formato brasileiro (15.000,00)."""
    return f"{v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def numero(v):
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v or "").strip().replace(".", "").replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return 0.0


@app.get("/health")
def health():
    with conectar() as cx, cx.cursor() as cur:
        cur.execute("select 1")
    return jsonify({"ok": True})


@app.get("/contas/<conta>/extrato")
def extrato(conta):
    with conectar() as cx, cx.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        garantir_conta(cur, conta)
        saldo = saldo_de(cur, conta)
        cur.execute("""select to_char(data, 'YYYY-MM-DD') as data, descricao, valor::float as valor
                       from lancamentos where conta = %s order by data desc, id desc limit 15""", (conta,))
        return jsonify({"conta": conta, "saldo": saldo, "lancamentos": cur.fetchall()})


@app.get("/contas/<conta>/saldo")
def saldo(conta):
    """Rota interna (serviço de pagamentos): saldo disponível antes de um débito."""
    with conectar() as cx, cx.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        garantir_conta(cur, conta)
        return jsonify({"conta": conta, "saldo": saldo_de(cur, conta)})


@app.post("/contas/<conta>/lancamentos")
def lancar(conta):
    """Rota interna (serviço de pagamentos): grava um lançamento no razão da conta e devolve o saldo novo."""
    d = request.get_json(silent=True) or {}
    valor = numero(d.get("valor"))
    descricao = str(d.get("descricao") or "Lançamento").strip()
    if valor == 0:
        return jsonify({"erro": "valor inválido"}), 400
    with conectar() as cx, cx.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        garantir_conta(cur, conta)
        cur.execute("insert into lancamentos (conta, data, descricao, valor) values (%s, current_date, %s, %s) returning id",
                    (conta, descricao, valor))
        lid = cur.fetchone()["id"]
        return jsonify({"id": lid, "saldo": saldo_de(cur, conta)}), 201


@app.post("/contas")
def abrir_conta():
    """Abertura de conta: valida o CPF, passa pela 'análise cadastral' e cria a conta (saldo zero)."""
    d = request.get_json(silent=True) or {}
    nome = str(d.get("nome") or "").strip()
    cpf = re.sub(r"\D", "", str(d.get("cpf") or ""))
    email = str(d.get("email") or "").strip()
    documento = str(d.get("documento") or "RG").strip()
    renda = numero(d.get("renda"))
    if not nome:
        return jsonify({"erro": "nome obrigatório"}), 400
    if len(cpf) != 11:
        return jsonify({"erro": "CPF inválido"}), 400
    with conectar() as cx, cx.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        for _ in range(20):
            conta = f"{random.randint(10000, 99999)}-{random.randint(0, 9)}"
            cur.execute("select 1 from contas where conta = %s", (f"{AGENCIA}-{conta}",))
            if not cur.fetchone():
                break
        conta_id = f"{AGENCIA}-{conta}"
        cur.execute("insert into contas (conta, saldo_inicial) values (%s, 0)", (conta_id,))
        cur.execute("insert into aberturas (conta, nome, cpf, email, renda, documento, status) values (%s, %s, %s, %s, %s, %s, 'aberta') returning id",
                    (conta_id, nome, cpf, email, renda, documento))
        protocolo = "A" + time.strftime("%Y%m%d%H%M%S") + f"{cur.fetchone()['id']:06d}"
        return jsonify({"status": "aberta", "protocolo": protocolo, "agencia": AGENCIA, "conta": conta, "nome": nome}), 201


@app.get("/cpf/<cpf>")
def consultar_cpf(cpf):
    """Consulta cadastral do CPF antes da abertura de conta (já é cliente?)."""
    cpf = re.sub(r"\D", "", cpf)
    if len(cpf) != 11:
        return jsonify({"erro": "CPF inválido"}), 400
    with conectar() as cx, cx.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("select count(*) as n from aberturas where cpf = %s", (cpf,))
        return jsonify({"situacao": "regular", "contas_anteriores": cur.fetchone()["n"]})


@app.get("/contas/<conta>/abertura")
def consultar_abertura(conta):
    with conectar() as cx, cx.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("""select status, nome, to_char(criado_em, 'DD/MM/YYYY HH24:MI') as criado_em
                       from aberturas where conta = %s order by id desc limit 1""", (conta,))
        return jsonify(cur.fetchone() or {"status": "não encontrada"})


@app.post("/contas/<conta>/cartoes")
def solicitar_cartao(conta):
    """Solicitação de cartão: análise de crédito por renda e tipo. Negado é desfecho de negócio, não erro."""
    d = request.get_json(silent=True) or {}
    tipo = str(d.get("tipo") or "Gold").strip().title()
    renda = numero(d.get("renda"))
    if tipo not in CARTOES:
        return jsonify({"erro": f"tipo de cartão inválido: {tipo}"}), 400
    if renda <= 0:
        return jsonify({"erro": "renda inválida"}), 400
    renda_minima, teto = CARTOES[tipo]
    with conectar() as cx, cx.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        garantir_conta(cur, conta)
        if renda < renda_minima:
            status, limite, motivo = "negado", None, f"renda abaixo do mínimo do cartão {tipo} (R$ {brl(renda_minima)})"
        else:
            status, limite, motivo = "aprovado", round(min(renda * 2, teto), 2), None
        cur.execute("insert into cartoes (conta, tipo, renda, limite, status, motivo) values (%s, %s, %s, %s, %s, %s) returning id",
                    (conta, tipo, renda, limite, status, motivo))
        proposta = "C" + time.strftime("%Y%m%d%H%M%S") + f"{cur.fetchone()['id']:06d}"
        return jsonify({"status": status, "proposta": proposta, "tipo": tipo, "renda": renda, "limite": limite, "motivo": motivo}), 201


garantir_tabelas()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
