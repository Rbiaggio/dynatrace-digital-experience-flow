"""banco-identidade: autenticação e sessões do Banco Demo (login, logout, recuperação de senha), para os três canais.
Banco próprio, o Postgres "identidade": credenciais, acessos e recuperações de senha.
No laboratório a credencial é criada no primeiro login da conta. Sem falha forçada.
"""
import os, random, time

import psycopg2
import psycopg2.extras
from flask import Flask, jsonify, request

DSN = os.environ.get("DATABASE_URL", "postgresql://identidade:identidade@identidade-db:5432/identidade")
app = Flask("banco-identidade")   # nome do serviço no Dynatrace (Flask = nome da aplicação), igual ao container


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
    """Dois workers do gunicorn sobem juntos: o advisory lock serializa o DDL."""
    try:
        with conectar() as cx, cx.cursor() as cur:
            cur.execute("select pg_advisory_xact_lock(4243)")
            cur.execute("""create table if not exists credenciais (
                             conta text primary key, criada_em timestamptz not null default now(), ultimo_acesso timestamptz)""")
            cur.execute("""create table if not exists acessos (
                             id bigserial primary key, conta text not null, canal text not null, evento text not null,
                             criado_em timestamptz not null default now())""")
            cur.execute("""create table if not exists recuperacoes_senha (
                             id bigserial primary key, conta text not null, canal text not null, codigo text not null,
                             criado_em timestamptz not null default now())""")
    except (psycopg2.errors.UniqueViolation, psycopg2.errors.DuplicateTable, psycopg2.errors.DuplicateObject):
        pass


@app.get("/health")
def health():
    with conectar() as cx, cx.cursor() as cur:
        cur.execute("select 1")
    return jsonify({"ok": True})


@app.post("/sessoes")
def login():
    """Login: confere a credencial (criada no primeiro acesso no laboratório) e registra o acesso."""
    d = request.get_json(silent=True) or {}
    conta = str(d.get("conta") or "").strip()
    canal = str(d.get("canal") or "pf").strip()
    if not conta:
        return jsonify({"erro": "conta obrigatória"}), 400
    with conectar() as cx, cx.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("insert into credenciais (conta) values (%s) on conflict (conta) do nothing", (conta,))
        cur.execute("select to_char(ultimo_acesso, 'DD/MM/YYYY HH24:MI') as ultimo from credenciais where conta = %s", (conta,))
        ultimo = cur.fetchone()["ultimo"]
        cur.execute("update credenciais set ultimo_acesso = now() where conta = %s", (conta,))
        cur.execute("insert into acessos (conta, canal, evento) values (%s, %s, 'login') returning id", (conta, canal))
        sessao = cur.fetchone()["id"]
        return jsonify({"status": "autenticado", "conta": conta, "sessao": sessao, "ultimo_acesso": ultimo}), 201


@app.post("/sessoes/encerrar")
def logout():
    d = request.get_json(silent=True) or {}
    conta = str(d.get("conta") or "").strip() or "anonimo"
    with conectar() as cx, cx.cursor() as cur:
        cur.execute("insert into acessos (conta, canal, evento) values (%s, %s, 'logout')", (conta, str(d.get("canal") or "pf")))
    return jsonify({"status": "encerrada"})


@app.post("/contas/<conta>/senha/recuperacao")
def recuperar_senha(conta):
    """Recuperação de senha: gera o código e registra o envio para o celular cadastrado."""
    d = request.get_json(silent=True) or {}
    codigo = f"{random.randint(0, 999999):06d}"
    with conectar() as cx, cx.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("insert into recuperacoes_senha (conta, canal, codigo) values (%s, %s, %s) returning id",
                    (conta, str(d.get("canal") or "pf"), codigo))
        protocolo = "R" + time.strftime("%Y%m%d%H%M%S") + f"{cur.fetchone()['id']:06d}"
    return jsonify({"protocolo": protocolo, "enviado_para": "(11) 9****-4321"}), 201


garantir_tabelas()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
