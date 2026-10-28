/* Gerador de jornadas - cada jornada é um contexto novo do navegador (= sessão RUM nova).
   PERFIL=varejo (Banco Demo), PERFIL=empresas (Banco Demo Empresas) ou PERFIL=portal (Portal PJ, em
   micro-frontends: troca de módulo recarrega a página inteira, como num canal em micro-frontends). As proporções do perfil são o
   GABARITO: o app de fluxo tem que reproduzi-las. Saída: /out/gabarito[-perfil].json + log no stdout. */
const { chromium } = require("playwright");
const fs = require("fs");

const PERFIL = process.env.PERFIL || "varejo";
const PARALELO = +(process.env.PARALELO || 2);
const PAUSA_MS = +(process.env.PAUSA_MS || 2000);        // entre jornadas, por worker
const PASSO_MIN = +(process.env.PASSO_MIN_MS || 1500);   // tempo "lendo" a página
const PASSO_MAX = +(process.env.PASSO_MAX_MS || 3000);
const TOTAL = +(process.env.TOTAL || 0);                 // 0 = sem limite
const MAX_PASSOS = 14;                                   // trava contra laços (ex.: extrato > cartão > extrato > ...)

const NOMES = ["Maria da Silva", "Joao Pereira", "Ana Souza", "Carlos Lima", "Beatriz Costa", "Pedro Alves", "Juliana Rocha", "Rafael Martins"];
const EMPRESAS = ["Fornecedor Alfa Ltda", "Transportadora Beta", "Energia Gama S.A.", "Serviços Delta", "Gráfica Épsilon"];
const entre = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const sorteiaItem = (lista) => lista[Math.floor(Math.random() * lista.length)];
const contaAleatoria = () => `${10000 + Math.floor(Math.random() * 89999)}-${Math.floor(Math.random() * 10)}`;
const cnpjAleatorio = () => `${entre(10, 99)}.${entre(100, 999)}.${entre(100, 999)}/0001-${entre(10, 99)}`;
const cpfAleatorio = () => `${entre(100, 999)}.${entre(100, 999)}.${entre(100, 999)}-${entre(10, 99)}`;
const valorAleatorio = (min = 10, max = 500) => `${entre(min, max)},${String(entre(0, 99)).padStart(2, "0")}`;
const rendaAleatoria = () => `${entre(1, 14)}.${String(entre(0, 999)).padStart(3, "0")},00`;   // R$ 1.000 a R$ 14.999: Gold quase sempre aprova, Black quase nunca

// árvore de decisão: página atual -> [[próxima página, peso %], ...]; lista vazia = fim da jornada.
// botao: data-testid que leva ao destino (por destino); botaoDe: exceções por página de origem.
// preencher: campos digitados antes de sair da página.
// passosComFalha: destinos cujo passo pode falhar no backend (a tela mostra .erro); cada um com o contador do gabarito
// e o caminho de recuperação (abandono) a partir da página em que o usuário ficou.
const PERFIS = {
  varejo: {
    base: "http://demo-app",
    saida: "/out/gabarito.json",
    arvore: {
      "/":                        [["/login", 80], ["/abrir-conta", 12], ["/recuperar-senha", 8]],
      "/login":                   [["/extrato", 100]],
      "/recuperar-senha":         [],
      "/abrir-conta":             [["/abrir-conta/documentos", 85], ["/", 15]],
      "/abrir-conta/documentos":  [["/abrir-conta/confirmacao", 100]],
      "/abrir-conta/confirmacao": [["/login", 60], ["/sair", 40]],
      "/extrato":                 [["/pix", 50], ["/cartao", 20], ["/sair", 30]],
      "/pix":                     [["/pix/confirmacao", 100]],
      "/pix/confirmacao":         [["/sair", 100]],
      "/cartao":                  [["/cartao/resultado", 100]],
      "/cartao/resultado":        [["/extrato", 50], ["/sair", 50]],
      "/sair":                    []
    },
    botao: { "/": "btn-voltar", "/login": "btn-login", "/recuperar-senha": "btn-recuperar", "/abrir-conta": "btn-abrir-conta", "/abrir-conta/documentos": "btn-continuar",
             "/abrir-conta/confirmacao": "btn-criar-conta", "/extrato": "btn-entrar", "/pix": "btn-pix", "/pix/confirmacao": "btn-confirmar",
             "/cartao": "btn-cartao", "/cartao/resultado": "btn-solicitar", "/sair": "btn-sair" },
    botaoDe: { "/cartao/resultado": { "/extrato": "btn-extrato" }, "/pix/confirmacao": { "/extrato": "btn-extrato" } },
    preencher: {
      "/login": () => [["input[name=conta]", contaAleatoria()]],
      "/abrir-conta": () => [["input[name=nome]", sorteiaItem(NOMES)], ["input[name=cpf]", cpfAleatorio()], ["input[name=renda]", rendaAleatoria()]],
      "/pix": () => [["input[name=favorecido]", sorteiaItem(NOMES)], ["input[name=valor]", valorAleatorio()]],
      "/cartao": () => [["input[name=renda]", rendaAleatoria()]]
    },
    selecionar: { "/cartao": () => [["select[name=cartaoTipo]", sorteiaItem(["Gold", "Gold", "Platinum", "Black"])]] },
    // só o Pix tem falha forçada no backend; abertura de conta e cartão não 
    passosComFalha: {
      "/pix/confirmacao": { contador: "pixFalhos", recuperacao: [["/pix", "/extrato", "btn-voltar"], ["/extrato", "/sair", "btn-sair"]] }
    }
  },
  empresas: {
    base: "http://demo-empresas",
    saida: "/out/gabarito-empresas.json",
    arvore: {
      "/":                      [["/login", 80], ["/tarifas", 20]],
      "/tarifas":               [],
      "/login":                 [["/painel", 100]],
      "/painel":                [["/pix-lote", 70], ["/sair", 30]],
      "/pix-lote":              [["/pix-lote/comprovante", 100]],
      "/pix-lote/comprovante":  [["/sair", 100]],
      "/sair":                  []
    },
    botao: { "/login": "btn-login", "/tarifas": "btn-tarifas", "/painel": "btn-entrar", "/pix-lote": "btn-pix-lote", "/sair": "btn-sair", "/pix-lote/comprovante": "btn-enviar-lote" },
    botaoDe: {},
    preencher: {
      "/login": () => [["input[name=cnpj]", cnpjAleatorio()]],
      "/pix-lote": () => [["input[name=favorecido1]", sorteiaItem(EMPRESAS)], ["input[name=valor1]", valorAleatorio(100, 3000)], ["input[name=valor2]", valorAleatorio(100, 3000)]]
    },
    selecionar: {},
    passosComFalha: {
      "/pix-lote/comprovante": { contador: "pixFalhos", recuperacao: [["/pix-lote", "/painel", "btn-voltar"], ["/painel", "/sair", "btn-sair"]] }
    }
  },
  // micro-frontends: cada módulo (/portal/, /inicio/, ...) é uma página inteira; /pix/comprovante e
  // /extrato/detalhe são passos sem recarga dentro do módulo; /redirecionar/ redireciona sozinho para a home
  portal: {
    base: "http://demo-portal",
    saida: "/out/gabarito-portal.json",
    inicio: "/portal/",
    pronto: "btn-acessar",
    automatico: { "/redirecionar/": true },
    arvore: {
      "/portal/":         [["/entrar/", 100]],
      "/entrar/":         [["/redirecionar/", 100]],
      "/redirecionar/":       [["/inicio/", 100]],
      "/inicio/":           [["/pix/", 40], ["/extrato/", 30], ["/ajuda/", 10], ["/sair/", 20]],
      "/pix/":            [["/pix/comprovante", 85], ["/inicio/", 15]],
      "/pix/comprovante": [["/inicio/", 40], ["/sair/", 60]],
      "/extrato/":        [["/extrato/detalhe", 60], ["/inicio/", 40]],
      "/extrato/detalhe": [["/inicio/", 40], ["/sair/", 60]],
      "/ajuda/":          [["/inicio/", 100]],
      "/sair/":           []
    },
    botao: { "/entrar/": "btn-acessar", "/redirecionar/": "btn-entrar", "/inicio/": "btn-inicio", "/pix/": "btn-pix", "/extrato/": "btn-extrato",
             "/ajuda/": "btn-ajuda", "/sair/": "btn-sair", "/pix/comprovante": "btn-enviar", "/extrato/detalhe": "btn-detalhe" },
    botaoDe: { "/pix/": { "/inicio/": "btn-voltar" } },
    preencher: {
      "/entrar/": () => [["input[name=cnpj]", cnpjAleatorio()]],
      "/pix/": () => [["input[name=favorecido]", sorteiaItem(EMPRESAS)], ["input[name=valor]", valorAleatorio(100, 3000)]]
    },
    selecionar: {},
    passosComFalha: {
      "/pix/comprovante": { contador: "pixFalhos", recuperacao: [["/pix/", "/inicio/", "btn-voltar"], ["/inicio/", "/sair/", "btn-sair"]] }
    }
  }
};
const P = PERFIS[PERFIL];
if (!P) { console.error(`perfil desconhecido: ${PERFIL} (use ${Object.keys(PERFIS).join(" | ")})`); process.exit(1); }
const BASE = process.env.BASE_URL || P.base;
const SAIDA = process.env.SAIDA || P.saida;
const botaoPara = (de, para) => (P.botaoDe[de] && P.botaoDe[de][para]) || P.botao[para];

const gabarito = { perfil: PERFIL, inicio: new Date().toISOString(), atualizado: null, jornadas: 0, falhas: 0, pixFalhos: 0, arestas: {}, paginas: {}, caminhos: {}, regioes: {} };
const dorme = (ms) => new Promise((r) => setTimeout(r, ms));
function sorteia(opcoes) {
  const total = opcoes.reduce((s, [, p]) => s + p, 0);
  let x = Math.random() * total;
  for (const [destino, peso] of opcoes) { x -= peso; if (x < 0) return destino; }
  return opcoes[opcoes.length - 1][0];
}
function salvar() {
  gabarito.atualizado = new Date().toISOString();
  try { fs.writeFileSync(SAIDA + ".tmp", JSON.stringify(gabarito, null, 2)); fs.renameSync(SAIDA + ".tmp", SAIDA); } catch (e) {}
}
function registrar(de, para, caminho) {
  const k = `${de} -> ${para}`;
  gabarito.arestas[k] = (gabarito.arestas[k] || 0) + 1;
  gabarito.paginas[para] = (gabarito.paginas[para] || 0) + 1;
  caminho.push(para);
}

// sistemas e navegadores variados (pesos aproximados), para os filtros de segmento do DEF
// terem o que mostrar. Nunca "HeadlessChrome": com ele o Dynatrace marca a sessão como robô (dt.rum.user_type = robot).
const PERFIS_NAVEGADOR = [
  [45, "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36", { width: 1366, height: 800 }],
  [15, "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0", { width: 1536, height: 864 }],
  [12, "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15", { width: 1440, height: 900 }],
  [8, "Mozilla/5.0 (X11; Linux x86_64; rv:141.0) Gecko/20100101 Firefox/141.0", { width: 1920, height: 1080 }],
  [12, "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36", { width: 412, height: 915 }],
  [8, "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1", { width: 390, height: 844 }],
];
function perfilNavegador() {
  if (process.env.USER_AGENT) return [process.env.USER_AGENT, { width: 1366, height: 800 }];
  let r = Math.random() * PERFIS_NAVEGADOR.reduce((s, p) => s + p[0], 0);
  for (const [peso, ua, tela] of PERFIS_NAVEGADOR) { if ((r -= peso) < 0) return [ua, tela]; }
  return [PERFIS_NAVEGADOR[0][1], PERFIS_NAVEGADOR[0][2]];
}

// De onde vem a sessão: o lab roda numa máquina só, então todo acesso cairia em São Paulo. Cada jornada sorteia um lugar
// (pesos aproximados da população) e manda um IP público de lá no X-Forwarded-For; o OneAgent do nginx usa esse
// cabeçalho para achar o IP do cliente, e a Dynatrace tira dele país e região (geo.*). Blocos de redes acadêmicas (RNP e
// RCTS), estáveis na geolocalização. REGIOES=0 desliga (volta a sair tudo do IP da máquina).
const REGIOES = process.env.REGIOES !== "0";
const LUGARES = [
  [38, "SP", "143.107"], [15, "RJ", "146.164"], [11, "MG", "150.164"], [7, "RS", "143.54"], [5, "SC", "150.162"],
  [8, "PE", "150.161"], [8, "DF", "164.41"], [2, "Portugal", "193.136"], [2, "Estados Unidos", "8.8"],
];
function lugarDaSessao() {
  let r = Math.random() * LUGARES.reduce((s, l) => s + l[0], 0);
  const [, nome, bloco] = LUGARES.find((l) => (r -= l[0]) < 0) || LUGARES[0];
  return [nome, `${bloco}.${entre(1, 254)}.${entre(1, 254)}`];
}

async function jornada(navegador, id) {
  const [userAgent, viewport] = perfilNavegador();
  const [lugar, ip] = REGIOES ? lugarDaSessao() : [null, null];
  if (lugar) gabarito.regioes[lugar] = (gabarito.regioes[lugar] || 0) + 1;
  const ctx = await navegador.newContext({ viewport, locale: "pt-BR", userAgent });
  // o cabeçalho vai SÓ para o próprio site do lab (páginas, API e beacon pela mesma origem): num pedido a outro domínio,
  // como o coletor da Dynatrace (bf.dynatrace.com), ele obriga um preflight de CORS que o coletor recusa e o beacon some
  if (ip) {
    const origem = new URL(BASE).origin;
    // x-lab-regiao: a API repassa ao processador de Pix, que falha mais em algumas regiões (FALHA_REGIONAL, pagamentos.py)
    await ctx.route((u) => u.origin === origem, (rota) => rota.continue({ headers: { ...rota.request().headers(), "x-forwarded-for": ip, "x-lab-regiao": lugar } }));
  }
  const page = await ctx.newPage();
  const inicio = P.inicio || "/";
  const caminho = [inicio];
  try {
    await page.goto(BASE + inicio, { waitUntil: "load" });
    await page.getByTestId(P.pronto || P.botao["/login"]).waitFor({ timeout: 10000 });
    let atual = inicio, passos = 0;
    gabarito.paginas[atual] = (gabarito.paginas[atual] || 0) + 1;
    while (P.arvore[atual].length && passos++ < MAX_PASSOS) {
      await dorme(entre(PASSO_MIN, PASSO_MAX));
      const destino = sorteia(P.arvore[atual]);
      if (P.automatico && P.automatico[atual]) {
        // a página troca sozinha (roteador): sem clique, só espera chegar
        await page.waitForURL(BASE + destino, { timeout: 10000 });
        await page.locator("#app h1").waitFor({ timeout: 10000 });
        registrar(atual, destino, caminho);
        atual = destino;
        continue;
      }
      for (const [seletor, valor] of (P.preencher[atual] ? P.preencher[atual]() : [])) await page.fill(seletor, valor);
      for (const [seletor, valor] of (P.selecionar[atual] ? P.selecionar[atual]() : [])) await page.selectOption(seletor, valor);
      await page.getByTestId(botaoPara(atual, destino)).click();
      const falha = P.passosComFalha[destino];
      if (falha) {
        // o passo pode falhar no backend (HTTP 5xx forçado): a tela mostra .erro e o usuário desiste
        const erro = page.locator("#app .erro");
        await Promise.race([page.waitForURL(BASE + destino, { timeout: 15000 }), erro.waitFor({ timeout: 15000 })]);
        if (!page.url().endsWith(destino)) {
          gabarito[falha.contador]++;
          caminho.push(`(${destino} falhou)`);
          await dorme(entre(PASSO_MIN, PASSO_MAX));
          for (const [de, para, botao] of falha.recuperacao) {
            await page.getByTestId(botao).click();
            await page.waitForURL(BASE + para, { timeout: 10000 });
            await page.locator("#app h1").waitFor({ timeout: 10000 });
            registrar(de, para, caminho);
            await dorme(entre(PASSO_MIN, PASSO_MAX));
          }
          atual = falha.recuperacao[falha.recuperacao.length - 1][1];
          continue;
        }
      } else {
        await page.waitForURL(BASE + destino, { timeout: 10000 });
      }
      await page.locator("#app h1").waitFor({ timeout: 10000 });
      registrar(atual, destino, caminho);
      atual = destino;
    }
    await dorme(4000);                                  // tempo para o agente enviar os beacons finais
    gabarito.jornadas++;
    const k = caminho.join(" > ");
    gabarito.caminhos[k] = (gabarito.caminhos[k] || 0) + 1;
    console.log(`[${new Date().toISOString()}] ${PERFIL} #${id} ok  ${k}`);
  } catch (e) {
    gabarito.falhas++;
    console.log(`[${new Date().toISOString()}] ${PERFIL} #${id} FALHA em ${caminho.join(" > ")}: ${e.message.split("\n")[0]}`);
  } finally {
    // sair da página antes de fechar: o RUM manda o resumo da página (Web Vitals, base do Apdex) quando ela é
    // descarregada, e o ctx.close() direto não descarrega (PF e PJ ficavam sem Apdex; 16/10/2026)
    await page.goto("about:blank", { timeout: 5000 }).catch(() => {});
    await dorme(1500);
    await ctx.close();
    salvar();
  }
}

(async () => {
  console.log(`loadgen: perfil=${PERFIL} base=${BASE} paralelo=${PARALELO} pausa=${PAUSA_MS}ms total=${TOTAL || "sem limite"} saida=${SAIDA}`);
  const navegador = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  let seq = 0, parar = false;
  process.on("SIGTERM", () => { parar = true; });
  process.on("SIGINT", () => { parar = true; });
  const worker = async () => {
    while (!parar && (!TOTAL || seq < TOTAL)) {
      const id = ++seq;
      await jornada(navegador, id);
      await dorme(PAUSA_MS + entre(0, 1000));
    }
  };
  await Promise.all(Array.from({ length: PARALELO }, () => worker()));
  await navegador.close();
  salvar();
  console.log(`loadgen: fim. jornadas=${gabarito.jornadas} falhas=${gabarito.falhas}`);
})();
