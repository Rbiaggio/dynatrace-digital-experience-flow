/* banco-api: BFF da web do Banco Demo (canais PF e PJ). O frontend chama /api/*; a API orquestra os serviços de
   domínio, cada um com o próprio banco: identidade (login, sessões, senha), ofertas (vitrine e tarifas, em cache),
   contas (extrato, abertura, cartão) e pagamentos (Pix). */
const express = require("express");

const PORTA = +(process.env.PORT || 3000);
const SERVICOS = {
  contas: process.env.CONTAS_URL || "http://contas:5000",
  identidade: process.env.IDENTIDADE_URL || "http://identidade:5000",
  pagamentos: process.env.PAGAMENTOS_URL || "http://pagamentos:5000",
  ofertas: process.env.OFERTAS_URL || "http://ofertas:3000",
};
const log = (...a) => console.log(new Date().toISOString(), ...a);

const app = express();
app.use(express.json());

async function servico(nome, method, caminho, corpo, extra = {}) {
  const r = await fetch(SERVICOS[nome].replace(/\/$/, "") + caminho, {
    method, headers: { "content-type": "application/json", ...extra },
    body: corpo ? JSON.stringify(corpo) : undefined
  });
  const texto = await r.text();
  let dados;
  try { dados = JSON.parse(texto); } catch (e) { dados = { erro: texto.slice(0, 200) }; }
  if (!r.ok) { const e = new Error(dados.erro || `${nome} HTTP ${r.status}`); e.status = r.status; throw e; }
  return dados;
}

function contaDe(req) {
  const conta = String((req.query && req.query.conta) || (req.body && req.body.conta) || "").trim();
  if (!conta) { const e = new Error("conta obrigatória"); e.status = 400; throw e; }
  return encodeURIComponent(conta);
}
const canalDe = (req) => String((req.body && req.body.canal) || (req.query && req.query.canal) || "pf");

app.get("/api/health", (req, res) => res.json({ ok: true, servicos: Object.keys(SERVICOS) }));

// ---- identidade: login, logout, recuperação de senha
app.post("/api/login", async (req, res, next) => {
  try { res.status(201).json(await servico("identidade", "POST", "/sessoes", { conta: decodeURIComponent(contaDe(req)), canal: canalDe(req) })); } catch (e) { next(e); }
});
app.post("/api/logout", async (req, res, next) => {
  try { res.json(await servico("identidade", "POST", "/sessoes/encerrar", { conta: (req.body && req.body.conta) || "", canal: canalDe(req) })); } catch (e) { next(e); }
});
app.post("/api/senha/recuperar", async (req, res, next) => {
  try { res.status(201).json(await servico("identidade", "POST", `/contas/${contaDe(req)}/senha/recuperacao`, { canal: canalDe(req) })); } catch (e) { next(e); }
});

// ---- ofertas: vitrine da página inicial e tarifas
// LAB: vitrine lenta simulada. A página inicial espera as ofertas para desenhar, então o LCP piora e o Apdex de Web
// Vitals cai como numa página real carregada devagar: mais nas regiões de LENTIDAO_REGIONAL (padrão RJ=0.7,PE=0.6) e em
// LENTIDAO_PADRAO (15%) das visitas nas outras. A resposta leva lento=true para o site simular o resto de uma página
// pesada (aviso que empurra o conteúdo e primeiro clique lento).
const LENTIDAO = Object.fromEntries((process.env.LENTIDAO_REGIONAL || "RJ=0.7,PE=0.6").split(",").filter((p) => p.includes("="))
  .map((p) => { const [k, v] = p.split("="); return [k.trim(), +v]; }));
const LENTIDAO_PADRAO = +(process.env.LENTIDAO_PADRAO || 0.15);
const dorme = (ms) => new Promise((r) => setTimeout(r, ms));
app.get("/api/ofertas", async (req, res, next) => {
  try {
    const lento = Math.random() < (LENTIDAO[req.get("x-lab-regiao") || ""] ?? LENTIDAO_PADRAO);
    if (lento) await dorme(3500 + Math.floor(Math.random() * 2500));
    const ofertas = await servico("ofertas", "GET", `/ofertas?canal=${encodeURIComponent(canalDe(req))}`);
    res.json(lento ? { ...ofertas, lento: true } : ofertas);
  } catch (e) { next(e); }
});
app.get("/api/tarifas", async (req, res, next) => {
  try { res.json(await servico("ofertas", "GET", "/tarifas")); } catch (e) { next(e); }
});

// ---- contas: extrato, abertura de conta, consulta de CPF, cartão de crédito
app.get("/api/extrato", async (req, res, next) => {
  try { res.json(await servico("contas", "GET", `/contas/${contaDe(req)}/extrato`)); } catch (e) { next(e); }
});
app.post("/api/contas", async (req, res, next) => {
  try {
    const { nome, cpf, email, renda, documento } = req.body || {};
    res.status(201).json(await servico("contas", "POST", "/contas", { nome, cpf, email, renda, documento }));
  } catch (e) { next(e); }
});
app.get("/api/cpf", async (req, res, next) => {
  try { res.json(await servico("contas", "GET", `/cpf/${encodeURIComponent(String(req.query.cpf || ""))}`)); } catch (e) { next(e); }
});
app.get("/api/aberturas", async (req, res, next) => {
  try { res.json(await servico("contas", "GET", `/contas/${contaDe(req)}/abertura`)); } catch (e) { next(e); }
});
app.post("/api/cartoes", async (req, res, next) => {
  try {
    const { tipo, renda } = req.body || {};
    res.status(201).json(await servico("contas", "POST", `/contas/${contaDe(req)}/cartoes`, { tipo, renda }));
  } catch (e) { next(e); }
});

// ---- pagamentos: Pix e comprovante
app.post("/api/pix", async (req, res, next) => {
  try {
    const { favorecido, chave, valor } = req.body || {};
    // LAB: a região simulada pelo gerador de carga segue até o processador (falha regional, ver pagamentos.py)
    const regiao = req.get("x-lab-regiao");
    res.status(201).json(await servico("pagamentos", "POST", `/contas/${contaDe(req)}/pix`, { favorecido, chave, valor }, regiao ? { "x-lab-regiao": regiao } : {}));
  } catch (e) { next(e); }
});
app.get("/api/pix/comprovante", async (req, res, next) => {
  try { res.json(await servico("pagamentos", "GET", `/contas/${contaDe(req)}/pix/${encodeURIComponent(String(req.query.id || ""))}`)); } catch (e) { next(e); }
});

app.use((e, req, res, next) => {
  log("erro", req.method, req.originalUrl, e.status || 500, e.message);
  res.status(e.status || 500).json({ erro: e.message });
});

app.listen(PORTA, () => log(`banco-api na porta ${PORTA}, serviços = ${JSON.stringify(SERVICOS)}`));
