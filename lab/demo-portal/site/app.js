/* Banco Demo Portal PJ - canal em micro-frontends: cada módulo é um micro-frontend próprio
   (/portal/, /entrar/, /redirecionar/, /inicio/, /pix/, /extrato/, /ajuda/, /sair/) e a troca de módulo
   CARREGA A PÁGINA INTEIRA (navegação "hard": o contador de páginas do RUM volta a 1 em todo carregamento).
   Dentro de alguns módulos há passos sem recarga (navegação "soft"): /pix/comprovante, /extrato/detalhe.
   O roteador de autenticação (/redirecionar/) só redireciona para a home, como um roteador de login.
   Mesmo backend dos outros canais (/api -> gateway -> ingress -> banco-api -> serviços). */
(function () {
  const app = document.getElementById("app");
  const PADRAO = { cnpj: "12.345.678/0001-90", token: "483921", favorecido: "Fornecedor Alfa Ltda", valor: "1.250,00" };
  let estado = Object.assign({}, PADRAO);
  try { estado = Object.assign({}, PADRAO, JSON.parse(sessionStorage.getItem("bancoPortal") || "{}")); } catch (e) {}
  const salvar = () => { try { sessionStorage.setItem("bancoPortal", JSON.stringify(estado)); } catch (e) {} };
  const coletar = () => { document.querySelectorAll("#app input[name]").forEach((i) => { estado[i.name] = i.value; }); salvar(); };
  const contaId = () => "PJ-" + String(estado.cnpj).replace(/\D/g, "");
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const brl = (n) => Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const dataBR = (iso) => { const [a, m, d] = String(iso).slice(0, 10).split("-"); return `${d}/${m}/${a}`; };

  async function api(metodo, caminho, corpo) {
    const r = await fetch(caminho, { method: metodo, headers: { "content-type": "application/json" }, body: corpo ? JSON.stringify(corpo) : undefined });
    let dados = null;
    try { dados = await r.json(); } catch (e) {}
    if (!r.ok) throw new Error((dados && dados.erro) || `HTTP ${r.status}`);
    return dados;
  }
  const botao = (testid, ir, texto, secundario) => `<button${secundario ? ' class="secundario"' : ""} data-testid="${testid}" data-ir="${ir}">${texto}</button>`;

  // telas por caminho completo; o módulo (micro-frontend) é o primeiro segmento
  const TELAS = {
    "/portal/": {
      titulo: "Portal PJ - Entrada",
      carregar: () => api("GET", "/api/ofertas?canal=pj"),
      html: (d) => `<div class="cartao"><h1>Portal PJ</h1><p>Todos os serviços da sua empresa num só lugar.</p>
        ${d && d.titulo ? `<p><b>${esc(d.titulo)}</b> · ${esc(d.descricao)}</p>` : ""}
        <div class="acoes">${botao("btn-acessar", "/entrar/", "Acessar")}</div></div>`
    },
    "/entrar/": {
      titulo: "Portal PJ - Autenticação",
      html: (d, erro) => `<div class="cartao"><h1>Autenticação</h1><p>CNPJ e token do dispositivo.</p>
        <label>CNPJ</label><input name="cnpj" value="${esc(estado.cnpj)}">
        <label>Token</label><input name="token" type="password" value="${esc(estado.token)}">
        ${erro ? `<div class="erro">Não foi possível entrar: ${esc(erro)}</div>` : ""}
        <div class="acoes" style="margin-top:16px">${botao("btn-entrar", "/redirecionar/", "Entrar")}</div></div>`
    },
    "/redirecionar/": {
      titulo: "Portal PJ - Redirecionando",
      html: () => `<div class="cartao"><h1>Preparando o seu ambiente…</h1><p>Carregando permissões e módulos.</p></div>`,
      // roteador de autenticação: decide o módulo inicial e troca de página sem clique
      depois: () => setTimeout(() => location.replace("/inicio/"), 1200)
    },
    "/inicio/": {
      titulo: "Portal PJ - Início",
      carregar: () => api("GET", `/api/extrato?conta=${encodeURIComponent(contaId())}`),
      html: (d, erro) => `<div class="cartao"><h1>Início</h1><p>CNPJ ${esc(estado.cnpj)} · conta ${esc(contaId())}</p>
        ${erro ? `<p class="erro">Não foi possível carregar o saldo: ${esc(erro)}</p>` : `<p>Saldo disponível: <b>R$ ${brl(d.saldo)}</b></p>`}
        <div class="acoes">${botao("btn-pix", "/pix/", "Pix")}${botao("btn-extrato", "/extrato/", "Extrato")}${botao("btn-ajuda", "/ajuda/", "Ajuda", true)}${botao("btn-sair", "/sair/", "Sair", true)}</div></div>`
    },
    "/pix/": {
      titulo: "Portal PJ - Pix",
      html: (d, erro) => `<div class="cartao"><h1>Pix</h1>
        <label>Favorecido</label><input name="favorecido" value="${esc(estado.favorecido)}">
        <label>Valor (R$)</label><input name="valor" value="${esc(estado.valor)}">
        ${erro ? `<div class="erro">${esc(erro)}</div>` : ""}
        <div class="acoes" style="margin-top:16px">${botao("btn-enviar", "/pix/comprovante", "Enviar")}${botao("btn-voltar", "/inicio/", "Voltar", true)}</div></div>`
    },
    "/pix/comprovante": {
      titulo: "Portal PJ - Comprovante",
      html: () => `<div class="cartao"><h1>Pix enviado</h1><p>Comprovante <b class="ok">${esc(estado.comprovante)}</b> · novo saldo R$ ${brl(estado.saldo)}</p>
        <div class="acoes">${botao("btn-inicio", "/inicio/", "Voltar ao início")}${botao("btn-sair", "/sair/", "Sair", true)}</div></div>`
    },
    "/extrato/": {
      titulo: "Portal PJ - Extrato",
      carregar: () => api("GET", `/api/extrato?conta=${encodeURIComponent(contaId())}`),
      html: (d, erro) => `<div class="cartao"><h1>Extrato</h1>
        ${erro ? `<p class="erro">Não foi possível carregar o extrato: ${esc(erro)}</p>` : `
        <table><tr><th>Data</th><th>Descrição</th><th>Valor (R$)</th></tr>
        ${d.lancamentos.slice(0, 5).map((l) => `<tr><td>${dataBR(l.data)}</td><td>${esc(l.descricao)}</td><td>${brl(l.valor)}</td></tr>`).join("")}</table>`}
        <div class="acoes">${botao("btn-detalhe", "/extrato/detalhe", "Ver detalhes")}${botao("btn-inicio", "/inicio/", "Voltar ao início", true)}</div></div>`
    },
    "/extrato/detalhe": {
      titulo: "Portal PJ - Extrato detalhado",
      carregar: () => api("GET", `/api/extrato?conta=${encodeURIComponent(contaId())}`),
      html: (d, erro) => `<div class="cartao"><h1>Extrato detalhado</h1>
        ${erro ? `<p class="erro">${esc(erro)}</p>` : `<p>${d.lancamentos.length} lançamentos · saldo R$ ${brl(d.saldo)}</p>`}
        <div class="acoes">${botao("btn-inicio", "/inicio/", "Voltar ao início")}${botao("btn-sair", "/sair/", "Sair", true)}</div></div>`
    },
    "/ajuda/": {
      titulo: "Portal PJ - Ajuda",
      html: () => `<div class="cartao"><h1>Ajuda</h1><p>Central de atendimento PJ: 0000-0000 (fictício).</p>
        <div class="acoes">${botao("btn-inicio", "/inicio/", "Voltar ao início")}</div></div>`,
      // LAB: erro JavaScript forçado em ~15% das visitas
      depois: () => { if (Math.random() < 0.15) setTimeout(() => { throw new ReferenceError("faqModulo is not defined"); }, 300); }
    },
    "/sair/": {
      titulo: "Portal PJ - Sessão encerrada",
      carregar: () => api("POST", "/api/logout", { conta: contaId(), canal: "pj" }),
      html: () => `<div class="cartao"><h1>Sessão encerrada</h1><p>Até a próxima.</p>
        <div class="acoes">${botao("btn-portal", "/portal/", "Voltar ao portal")}</div></div>`
    }
  };
  const modulo = (caminho) => "/" + caminho.split("/")[1] + "/";

  async function render(caminho, erro) {
    const tela = TELAS[caminho] || TELAS["/portal/"];
    document.title = tela.titulo;
    document.getElementById("mfe").textContent = "micro-frontend " + modulo(caminho);
    let dados = null;
    if (tela.carregar && !erro) { try { dados = await tela.carregar(); } catch (e) { erro = e.message; } }
    app.innerHTML = tela.html(dados, erro);
    if (tela.depois) tela.depois();
  }

  // troca de módulo = página inteira (hard); mesmo módulo = sem recarga (soft)
  function navegar(destino, erro) {
    if (modulo(destino) !== modulo(location.pathname)) { location.assign(destino); return; }
    if (location.pathname !== destino) history.pushState({}, "", destino);
    return render(destino, erro);
  }

  async function entrar() {
    try { await api("POST", "/api/login", { conta: contaId(), canal: "pj" }); navegar("/redirecionar/"); }
    catch (e) { render("/entrar/", e.message); }
  }
  async function enviarPix() {
    try {
      const r = await api("POST", "/api/pix", { conta: contaId(), favorecido: estado.favorecido, chave: "pj@example.com", valor: estado.valor });
      estado.comprovante = r.id; estado.saldo = r.saldo; salvar();
      navegar("/pix/comprovante");
    } catch (e) { render("/pix/", `O Pix não foi processado: ${e.message}`); }
  }

  document.addEventListener("click", (ev) => {
    const alvo = ev.target.closest("[data-ir]");
    if (!alvo) return;
    ev.preventDefault();
    coletar();
    const destino = alvo.dataset.ir;
    if (destino === "/redirecionar/" && location.pathname === "/entrar/") { entrar(); return; }
    if (destino === "/pix/comprovante") { enviarPix(); return; }
    navegar(destino);
  });
  window.addEventListener("popstate", () => render(location.pathname));

  setTimeout(() => {
    const el = document.getElementById("agente");
    if (window.dynatrace) { el.textContent = "agente RUM: ativo (API nova)"; el.className = "agente ok"; }
    else if (window.dtrum) { el.textContent = "agente RUM: ativo (API clássica)"; el.className = "agente ok"; }
    else { el.textContent = "agente RUM: não carregou"; el.className = "agente erro"; }
  }, 2500);

  // "/" (ou caminho desconhecido) entra pelo portal, com página inteira, como um link externo
  if (!TELAS[location.pathname]) { location.replace("/portal/"); return; }
  render(location.pathname);
})();
