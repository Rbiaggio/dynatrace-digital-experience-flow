/* Verifica, num navegador real com o agente RUM carregado, se as respostas das chamadas de API trazem o cabeçalho
   Server-Timing do OneAgent (dtTrId/dtSInfo/dtRpid). É isso que liga página -> serviço no Digital Experience Flow; proxys
   (API gateway), WAF e CDN podem remover o cabeçalho, e aí a ligação some.

   Uso (dentro do container do loadgen, que tem o Chromium):
     node check-server-timing.js <url da página> [--click data-testid ...] [--filtro /api/]
   Lab:  node check-server-timing.js http://demo-app/ --click btn-login btn-entrar --filtro /api/
   Outro ambiente: apontar para a URL do canal (com o agente RUM injetado) e clicar até a tela que chama a API. */
const { chromium } = require("playwright");
const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith("--")) || "http://demo-app/";
const cliques = (() => { const i = args.indexOf("--click"); if (i < 0) return []; const out = []; for (let j = i + 1; j < args.length && !args[j].startsWith("--"); j++) out.push(args[j]); return out; })();
const filtro = (() => { const i = args.indexOf("--filtro"); return i >= 0 ? args[i + 1] : "/api/"; })();

(async () => {
  const b = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const p = await b.newPage({ viewport: { width: 1366, height: 800 }, userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36" });
  const vistas = [];
  p.on("response", async (r) => {
    const u = r.url();
    if (!u.includes(filtro)) return;
    const h = await r.allHeaders();
    const req = r.request();
    const rh = req.headers();
    vistas.push({ metodo: req.method(), url: u, status: r.status(), serverTiming: h["server-timing"] || "", expose: h["access-control-expose-headers"] || "", cabecalhos: Object.keys(h).join(", "),
                  origin: rh["origin"] || "", traceparent: !!rh["traceparent"], xdtpc: !!rh["x-dtpc"] });
  });
  await p.goto(url, { waitUntil: "load" });
  await p.waitForTimeout(1500);
  const agente = await p.evaluate(() => (window.dynatrace ? "novo" : window.dtrum ? "classico" : "nenhum"));
  for (const t of cliques) { await p.getByTestId(t).click(); await p.waitForTimeout(1500); }
  await p.waitForTimeout(1000);
  console.log(`página: ${url} · agente RUM na página: ${agente} · chamadas observadas (${filtro}): ${vistas.length}\n`);
  let ok = 0;
  for (const v of vistas) {
    const tem = /dtTrId|dtSInfo/.test(v.serverTiming);
    if (tem) ok++;
    console.log(`${tem ? "✓" : "✗"} ${v.metodo} ${v.url} -> HTTP ${v.status} · Server-Timing ${tem ? "PRESENTE" : "ausente"}${v.serverTiming ? ` (${v.serverTiming.slice(0, 80)})` : ""}`
      + ` · origin enviado: ${v.origin ? "sim" : "não"} · traceparent: ${v.traceparent ? "sim" : "não"} · x-dtpc: ${v.xdtpc ? "sim" : "não"}${v.expose ? ` · expose-headers: ${v.expose}` : ""}`);
    if (!tem) console.log(`    cabeçalhos da resposta: ${v.cabecalhos}`);
  }
  const comTrace = vistas.filter((v) => v.traceparent).length;
  console.log(`
traceparent enviado em ${comTrace}/${vistas.length} chamadas (é o que liga página -> serviço no Digital Experience Flow; proxies e CDN precisam deixar passar).`);
  console.log(`Server-Timing recebido em ${ok}/${vistas.length} (informativo: ausente = proxy/WAF removendo, CORS sem expor, ou OneAgent sem ligação RUM).`);
  await b.close();
  process.exitCode = vistas.length > 0 && comTrace === vistas.length ? 0 : 1;
})();
