/* banco-mobile-api: BFF do app mobile (iOS e Android), como num banco de verdade: camada própria do canal, com banco
   próprio (banco-mobile: dispositivos, sessões e notificações do app), e os serviços de domínio compartilhados com a web:
   identidade (login), ofertas (vitrine), contas (extrato) e pagamentos (Pix). */
const express = require("express");
const { Pool } = require("pg");

const PORTA = +(process.env.PORT || 3000);
const SERVICOS = {
  contas: process.env.CONTAS_URL || "http://contas:5000",
  identidade: process.env.IDENTIDADE_URL || "http://identidade:5000",
  pagamentos: process.env.PAGAMENTOS_URL || "http://pagamentos:5000",
  ofertas: process.env.OFERTAS_URL || "http://ofertas:3000",
};
const db = new Pool({ connectionString: process.env.MOBILE_DB_URL || "postgresql://mobile:mobile@mobile-db:5432/mobile" });
const log = (...a) => console.log(new Date().toISOString(), ...a);

async function servico(nome, method, caminho, corpo) {
  const r = await fetch(SERVICOS[nome].replace(/\/$/, "") + caminho, {
    method, headers: { "content-type": "application/json" },
    body: corpo ? JSON.stringify(corpo) : undefined
  });
  const texto = await r.text();
  let dados;
  try { dados = JSON.parse(texto); } catch (e) { dados = { erro: texto.slice(0, 200) }; }
  if (!r.ok) { const e = new Error(dados.erro || `${nome} HTTP ${r.status}`); e.status = r.status; throw e; }
  return dados;
}

async function prepararBanco() {
  for (let i = 0; i < 30; i++) {
    try { await db.query("select 1"); break; } catch (e) { await new Promise((r) => setTimeout(r, 1000)); }
  }
  await db.query(`create table if not exists dispositivos (
    id text primary key, conta text not null, os text, modelo text,
    criado_em timestamptz not null default now(), visto_em timestamptz not null default now())`);
  await db.query(`create table if not exists sessoes (
    id bigserial primary key, conta text not null, dispositivo text, inicio timestamptz not null default now(), fim timestamptz)`);
  await db.query(`create table if not exists notificacoes (
    id bigserial primary key, conta text not null, titulo text not null, criado_em timestamptz not null default now())`);
}

const app = express();
app.use(express.json());

function contaDe(req) {
  const conta = String((req.query && req.query.conta) || (req.body && req.body.conta) || "").trim();
  if (!conta) { const e = new Error("conta obrigatória"); e.status = 400; throw e; }
  return conta;
}

app.get("/v1/health", (req, res) => res.json({ ok: true }));

// login: autentica no serviço de identidade, vincula o dispositivo à conta e abre a sessão no banco do mobile
app.post("/v1/sessao", async (req, res, next) => {
  try {
    const conta = contaDe(req);
    const { dispositivo = "desconhecido", os = "", modelo = "" } = req.body || {};
    await servico("identidade", "POST", "/sessoes", { conta, canal: "mobile" });
    // conta de teste do lab: o Pix debita sempre; de vez em quando entra um salário, para o Pix não
    // virar só "saldo insuficiente" (422)
    if (Math.random() < 0.3) await servico("contas", "POST", `/contas/${encodeURIComponent(conta)}/lancamentos`, { descricao: "Salário", valor: 3000 });
    await db.query(`insert into dispositivos (id, conta, os, modelo) values ($1, $2, $3, $4)
                    on conflict (id) do update set conta = excluded.conta, visto_em = now()`, [dispositivo, conta, os, modelo]);
    const r = await db.query("insert into sessoes (conta, dispositivo) values ($1, $2) returning id", [conta, dispositivo]);
    res.status(201).json({ sessao: r.rows[0].id, conta });
  } catch (e) { next(e); }
});

app.post("/v1/sessao/encerrar", async (req, res, next) => {
  try {
    await db.query("update sessoes set fim = now() where id = $1 and fim is null", [Number((req.body && req.body.sessao) || 0)]);
    res.json({ status: "encerrada" });
  } catch (e) { next(e); }
});

// vitrine, extrato e Pix: serviços de domínio compartilhados com a web
app.get("/v1/ofertas", async (req, res, next) => {
  try { res.json(await servico("ofertas", "GET", "/ofertas?canal=mobile")); } catch (e) { next(e); }
});

app.get("/v1/extrato", async (req, res, next) => {
  try { res.json(await servico("contas", "GET", `/contas/${encodeURIComponent(contaDe(req))}/extrato`)); } catch (e) { next(e); }
});

app.post("/v1/pix", async (req, res, next) => {
  try {
    const conta = contaDe(req);
    const { favorecido, chave, valor } = req.body || {};
    const pix = await servico("pagamentos", "POST", `/contas/${encodeURIComponent(conta)}/pix`, { favorecido, chave, valor });
    await db.query("insert into notificacoes (conta, titulo) values ($1, $2)", [conta, `Pix de R$ ${pix.valor} enviado para ${pix.favorecido}`]);
    res.status(201).json(pix);
  } catch (e) { next(e); }
});

app.get("/v1/pix/:id", async (req, res, next) => {
  try { res.json(await servico("pagamentos", "GET", `/contas/${encodeURIComponent(contaDe(req))}/pix/${encodeURIComponent(req.params.id)}`)); } catch (e) { next(e); }
});

app.use((e, req, res, next) => {
  log("erro", req.method, req.originalUrl, e.status || 500, e.message);
  res.status(e.status || 500).json({ erro: e.message });
});

prepararBanco()
  .then(() => app.listen(PORTA, () => log(`banco-mobile-api na porta ${PORTA}, serviços = ${JSON.stringify(SERVICOS)}`)))
  .catch((e) => { log("falha ao preparar o banco do mobile", e.message); process.exit(1); });
