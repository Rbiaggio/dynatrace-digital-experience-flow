/* banco-ofertas: vitrine do Banco Demo (ofertas da página inicial de cada canal e tabela de tarifas), servida de um
   cache Redis, como a vitrine de um banco. Atende os três canais pelos BFFs (web e mobile). */
const express = require("express");
const Redis = require("ioredis");

const PORTA = +(process.env.PORT || 3000);
const redis = new Redis(process.env.REDIS_URL || "redis://ofertas-cache:6379", { maxRetriesPerRequest: 3 });
const log = (...a) => console.log(new Date().toISOString(), ...a);

const OFERTAS = {
  pf: [
    { titulo: "Cashback no cartão Gold", descricao: "2% de volta nas compras do primeiro mês." },
    { titulo: "Pix agendado", descricao: "Programe pagamentos recorrentes sem tarifa." },
    { titulo: "Investimento automático", descricao: "O saldo parado rende 100% do CDI." },
  ],
  pj: [
    { titulo: "Pix em lote sem tarifa", descricao: "Pague fornecedores em uma única operação." },
    { titulo: "Antecipação de recebíveis", descricao: "Taxa reduzida para clientes PJ." },
  ],
  mobile: [
    { titulo: "Pix pelo celular", descricao: "Pague com a chave ou o QR Code em segundos." },
    { titulo: "Cartão virtual", descricao: "Gere um cartão para compras online direto no app." },
    { titulo: "Notificações de gastos", descricao: "Receba um aviso a cada compra no cartão." },
  ],
};
const TARIFAS = [
  { servico: "Pix em lote", valor: 0 }, { servico: "TED", valor: 9.9 },
  { servico: "Boleto de cobrança", valor: 2.5 }, { servico: "Folha de pagamento", valor: 0 },
];

async function carregarVitrine() {
  for (const [canal, lista] of Object.entries(OFERTAS)) await redis.set(`ofertas:${canal}`, JSON.stringify(lista));
  await redis.set("tarifas", JSON.stringify(TARIFAS));
}

const app = express();
app.get("/health", async (req, res) => { try { await redis.ping(); res.json({ ok: true }); } catch (e) { res.status(503).json({ ok: false }); } });

app.get("/ofertas", async (req, res, next) => {
  try {
    const lista = JSON.parse((await redis.get(`ofertas:${String(req.query.canal || "pf")}`)) || "[]");
    res.json(lista.length ? lista[Math.floor(Math.random() * lista.length)] : {});
  } catch (e) { next(e); }
});

app.get("/tarifas", async (req, res, next) => {
  try { res.json({ tarifas: JSON.parse((await redis.get("tarifas")) || "[]") }); } catch (e) { next(e); }
});

app.use((e, req, res, next) => {
  log("erro", req.method, req.originalUrl, e.message);
  res.status(500).json({ erro: e.message });
});

carregarVitrine()
  .then(() => app.listen(PORTA, () => log(`banco-ofertas na porta ${PORTA}`)))
  .catch((e) => { log("falha ao carregar a vitrine no Redis", e.message); process.exit(1); });
