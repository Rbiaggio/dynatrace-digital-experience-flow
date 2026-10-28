/* Verificação única: abre a home, espera o agente RUM carregar e lista os beacons enviados.
   Uso (na pasta lab/): docker compose run --rm --no-deps loadgen node check-agent.js */
const { chromium } = require("playwright");
const BASE = process.env.BASE_URL || "http://demo-app";
(async () => {
  const b = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const p = await b.newPage();
  const reqs = [];
  p.on("request", (r) => { const u = r.url(); if (!u.startsWith(BASE)) reqs.push(r.method() + " " + u.slice(0, 140)); });
  p.on("console", (m) => { if (m.type() === "error") console.log("console.error:", m.text().slice(0, 200)); });
  await p.goto(BASE + "/", { waitUntil: "load" });
  await p.waitForTimeout(4000);
  await p.getByTestId("btn-login").click();
  await p.waitForURL(BASE + "/login");
  await p.waitForTimeout(5000);
  const s = await p.evaluate(() => ({
    dynatrace: !!window.dynatrace, dtrum: !!window.dtrum,
    agente: document.getElementById("agente").textContent,
    scripts: Array.from(document.scripts).map((x) => x.src).filter(Boolean)
  }));
  console.log(JSON.stringify(s, null, 1));
  console.log("requisicoes externas:\n  " + (reqs.join("\n  ") || "(nenhuma)"));
  await b.close();
})();
