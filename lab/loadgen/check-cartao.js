/* Testa de ponta a ponta, num navegador headless, os fluxos novos do varejo: cartão de crédito e abertura de conta.
   Uso (dentro do container do loadgen):  node check-cartao.js [base]   (padrão http://demo-app) */
const { chromium } = require("playwright");
const BASE = process.argv[2] || process.env.BASE_URL || "http://demo-app";

(async () => {
  const b = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const p = await b.newPage({ viewport: { width: 1366, height: 800 } });
  p.on("pageerror", (e) => console.log("pageerror:", e.message));
  p.on("console", (m) => { if (m.type() === "error") console.log("console.error:", m.text().slice(0, 200)); });
  const passo = async (rotulo, acao, url) => {
    await acao();
    await p.waitForURL(BASE + url, { timeout: 10000 });
    await p.locator("#app h1").waitFor({ timeout: 10000 });
    console.log(`ok  ${rotulo} -> ${url} · h1: ${await p.locator("#app h1").innerText()}`);
  };
  try {
    await p.goto(BASE + "/", { waitUntil: "load" });
    await passo("login", () => p.getByTestId("btn-login").click(), "/login");
    await passo("acessar", () => p.getByTestId("btn-entrar").click(), "/extrato");
    await passo("solicitar cartão", () => p.getByTestId("btn-cartao").click(), "/cartao");
    await p.selectOption("select[name=cartaoTipo]", "Platinum");
    await p.fill("input[name=renda]", "7.500,00");
    await passo("enviar pedido", () => p.getByTestId("btn-solicitar").click(), "/cartao/resultado");
    console.log("    texto:", (await p.locator("#app .cartao p").first().innerText()).slice(0, 120));
    await passo("ver extrato", () => p.getByTestId("btn-extrato").click(), "/extrato");
    await passo("sair", () => p.getByTestId("btn-sair").click(), "/sair");

    await p.goto(BASE + "/", { waitUntil: "load" });
    await passo("abrir conta", () => p.getByTestId("btn-abrir-conta").click(), "/abrir-conta");
    await p.fill("input[name=nome]", "Teste Headless");
    await p.fill("input[name=cpf]", "987.654.321-00");
    await passo("continuar", () => p.getByTestId("btn-continuar").click(), "/abrir-conta/documentos");
    await p.selectOption("select[name=documento]", "CNH");
    await passo("criar conta", () => p.getByTestId("btn-criar-conta").click(), "/abrir-conta/confirmacao");
    console.log("    texto:", (await p.locator("#app .cartao p").nth(1).innerText()).slice(0, 120));
    await passo("entrar com a conta nova", () => p.getByTestId("btn-login").click(), "/login");
    console.log("    conta preenchida:", await p.inputValue("input[name=conta]"));
    await passo("acessar conta nova", () => p.getByTestId("btn-entrar").click(), "/extrato");
    console.log("FIM: fluxos de cartão e abertura de conta funcionam no navegador");
  } catch (e) {
    console.log("FALHA:", e.message.split("\n")[0], "· url atual:", p.url());
    process.exitCode = 1;
  } finally {
    await b.close();
  }
})();
