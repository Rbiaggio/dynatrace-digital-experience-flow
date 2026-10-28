/* Banco Demo Empresas - canal pessoa jurídica. Login por CNPJ + token, painel e Pix em lote.
   Consome o MESMO backend do canal varejo (/api -> banco-api -> banco-core -> Postgres). */
(function () {
  const app = document.getElementById("app");

  const PADRAO = {
    cnpj: "12.345.678/0001-90", usuario: "financeiro", token: "483921",
    favorecido1: "Fornecedor Alfa Ltda", valor1: "1.250,00",
    favorecido2: "Transportadora Beta", valor2: "780,50",
    favorecido3: "Energia Gama S.A.", valor3: "2.310,00"
  };
  let estado = Object.assign({}, PADRAO);
  try { estado = Object.assign({}, PADRAO, JSON.parse(sessionStorage.getItem("bancoEmpresas") || "{}")); } catch (e) {}
  function salvar() { try { sessionStorage.setItem("bancoEmpresas", JSON.stringify(estado)); } catch (e) {} }
  function coletar() {
    document.querySelectorAll("#app input[name]").forEach((i) => { estado[i.name] = i.value; });
    salvar();
  }
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

  const PAGINAS = {
    "/": {
      titulo: "Banco Demo Empresas - Início",
      carregar: () => api("GET", "/api/ofertas?canal=pj"),
      html: (d) => `
        <div class="cartao">
          <h1>Soluções para a sua empresa</h1>
          <p>Gestão de caixa, pagamentos em lote e cobrança num só lugar.</p>
          ${d && d.titulo ? `<p><b>${esc(d.titulo)}</b> · ${esc(d.descricao)}</p>` : ""}
          <div class="acoes">
            <button data-testid="btn-login" data-ir="/login">Acessar conta PJ</button>
            <button class="secundario" data-testid="btn-tarifas" data-ir="/tarifas">Ver tarifas</button>
          </div>
        </div>`
    },
    "/tarifas": {
      titulo: "Banco Demo Empresas - Tarifas",
      carregar: () => api("GET", "/api/tarifas"),
      html: (d, erro) => `
        <div class="cartao">
          <h1>Tarifas pessoa jurídica</h1>
          ${erro ? `<p class="erro">Não foi possível carregar as tarifas: ${esc(erro)}</p>` : `
          <table><tr><th>Serviço</th><th>Tarifa</th></tr>
            ${((d && d.tarifas) || []).map((t) => `<tr><td>${esc(t.servico)}</td><td>R$ ${brl(t.valor)}</td></tr>`).join("")}
          </table>`}
          <div class="acoes"><button data-testid="btn-inicio" data-ir="/">Voltar ao início</button></div>
        </div>`
    },
    "/login": {
      titulo: "Banco Demo Empresas - Login",
      html: (d, erro) => `
        <div class="cartao">
          <h1>Acesso pessoa jurídica</h1>
          <p>Informe CNPJ, usuário e o token do dispositivo.</p>
          <label>CNPJ</label><input name="cnpj" value="${esc(estado.cnpj)}">
          <label>Usuário</label><input name="usuario" value="${esc(estado.usuario)}">
          <label>Token</label><input name="token" type="password" value="${esc(estado.token)}">
          ${erro ? `<div class="erro">Não foi possível entrar: ${esc(erro)}</div>` : ""}
          <div class="acoes" style="margin-top:16px">
            <button data-testid="btn-entrar" data-ir="/painel">Entrar</button>
            <button class="secundario" data-testid="btn-voltar" data-ir="/">Voltar</button>
          </div>
        </div>`
    },
    "/painel": {
      titulo: "Banco Demo Empresas - Painel",
      carregar: () => api("GET", `/api/extrato?conta=${encodeURIComponent(contaId())}`),
      html: (d, erro) => `
        <div class="cartao">
          <h1>Painel financeiro</h1>
          <p>CNPJ ${esc(estado.cnpj)} · conta ${esc(contaId())}</p>
          ${erro ? `<p class="erro">Não foi possível carregar o painel: ${esc(erro)}</p>` : `
          <p>Saldo disponível: <b>R$ ${brl(d.saldo)}</b></p>
          <table><tr><th>Data</th><th>Descrição</th><th>Valor (R$)</th></tr>
          ${d.lancamentos.map((l) => `<tr><td>${dataBR(l.data)}</td><td>${esc(l.descricao)}</td><td style="color:${l.valor < 0 ? "#b91c1c" : "#15803d"}">${brl(l.valor)}</td></tr>`).join("")}
          </table>`}
          <div class="acoes">
            <button data-testid="btn-pix-lote" data-ir="/pix-lote">Pix em lote</button>
            <button class="secundario" data-testid="btn-sair" data-ir="/sair">Sair</button>
          </div>
        </div>`
    },
    "/pix-lote": {
      titulo: "Banco Demo Empresas - Pix em lote",
      html: (d, erro) => `
        <div class="cartao">
          <h1>Pix em lote</h1>
          <p>Três pagamentos enviados em sequência para o mesmo processador do canal varejo.</p>
          <div class="lote">
            ${[1, 2, 3].map((i) => `
              <label>Favorecido ${i}<input name="favorecido${i}" value="${esc(estado["favorecido" + i])}"></label>
              <label>Valor (R$)<input name="valor${i}" value="${esc(estado["valor" + i])}"></label>`).join("")}
          </div>
          ${erro ? `<div class="erro">${erro}</div>` : ""}
          <div class="acoes" style="margin-top:16px">
            <button data-testid="btn-enviar-lote" data-ir="/pix-lote/comprovante">Enviar lote</button>
            <button class="secundario" data-testid="btn-voltar" data-ir="/painel">Voltar</button>
          </div>
        </div>`
    },
    "/pix-lote/comprovante": {
      titulo: "Banco Demo Empresas - Lote enviado",
      html: () => {
        const lote = estado.lote || [];
        return `
        <div class="cartao">
          <h1>Lote enviado</h1>
          <table><tr><th>Favorecido</th><th>Valor (R$)</th><th>Comprovante</th></tr>
          ${lote.map((p) => `<tr><td>${esc(p.favorecido)}</td><td>${brl(p.valor)}</td><td class="ok">${esc(p.id)}</td></tr>`).join("")}
          </table>
          <p>Novo saldo: <b>R$ ${brl(lote.length ? lote[lote.length - 1].saldo : 0)}</b></p>
          <div class="acoes">
            <button data-testid="btn-sair" data-ir="/sair">Sair</button>
            <button class="secundario" data-testid="btn-painel" data-ir="/painel">Voltar ao painel</button>
          </div>
        </div>`;
      }
    },
    "/sair": {
      titulo: "Banco Demo Empresas - Sessão encerrada",
      carregar: () => api("POST", "/api/logout", { conta: contaId(), canal: "pj" }),
      html: () => `
        <div class="cartao">
          <h1>Sessão encerrada</h1>
          <p>Até a próxima.</p>
          <div class="acoes"><button data-testid="btn-inicio" data-ir="/">Voltar ao início</button></div>
        </div>`
    }
  };

  // LAB: página pesada quando a vitrine veio lenta (lento=true da API): um aviso entra depois e empurra o conteúdo
  // (deslocamento de layout, CLS) e o primeiro clique trava a tela por ~650 ms (resposta ao clique, INP), como um
  // script pesado de terceiros. Com o LCP lento da própria vitrine, o Apdex de Web Vitals dessa carga cai para ~0,4.
  function simularPaginaPesada() {
    setTimeout(() => {
      const aviso = document.createElement("div");
      aviso.className = "cartao";
      aviso.style.minHeight = "220px";
      aviso.innerHTML = "<p><b>Aviso</b> · Atualizamos nossos termos de uso.</p>";
      app.prepend(aviso);
    }, 900);
    document.addEventListener("click", () => { const fim = performance.now() + 650; while (performance.now() < fim) { /* trava */ } }, { once: true, capture: true });
  }

  async function render(caminho, erro) {
    const pag = PAGINAS[caminho] || PAGINAS["/"];
    document.title = pag.titulo;
    let dados = null;
    if (pag.carregar && !erro) {
      try { dados = await pag.carregar(); } catch (e) { erro = e.message; }
    }
    app.innerHTML = pag.html(dados, erro);
    if (dados && dados.lento) simularPaginaPesada();
    // LAB: erro JavaScript forçado em ~15% das visitas a /tarifas
    if (caminho === "/tarifas" && Math.random() < 0.15) {
      setTimeout(() => { throw new ReferenceError("tabelaTarifas is not defined"); }, 300);
    }
    if (window.dtrum && typeof window.dtrum.setPage === "function") {
      try { window.dtrum.setPage({ name: caminho, group: "banco-empresas" }); } catch (e) {}
    }
  }

  function navegar(caminho, erro) {
    if (location.pathname !== caminho) history.pushState({}, "", caminho);
    return render(caminho, erro);
  }

  // envia os três Pix em sequência; se algum falhar, fica na tela e mostra quais falharam
  async function enviarLote() {
    const ok = [], falhas = [];
    for (const i of [1, 2, 3]) {
      const favorecido = estado["favorecido" + i], valor = estado["valor" + i];
      try {
        const r = await api("POST", "/api/pix", { conta: contaId(), favorecido, chave: `pj${i}@example.com`, valor });
        ok.push(r);
      } catch (e) { falhas.push(`${favorecido}: ${e.message}`); }
    }
    if (falhas.length) {
      return render("/pix-lote", `${falhas.length} de 3 pagamentos não foram processados:<br>${falhas.map(esc).join("<br>")}${ok.length ? `<br>(${ok.length} já enviados)` : ""}`);
    }
    estado.lote = ok; salvar();
    return navegar("/pix-lote/comprovante");
  }

  // login: autentica no backend (registra o acesso) antes de abrir o painel
  async function entrar() {
    try {
      await api("POST", "/api/login", { conta: contaId(), canal: "pj" });
      return navegar("/painel");
    } catch (e) {
      return render("/login", e.message);
    }
  }

  document.addEventListener("click", (ev) => {
    const alvo = ev.target.closest("[data-ir], a[data-link]");
    if (!alvo) return;
    ev.preventDefault();
    coletar();
    const destino = alvo.dataset.ir || alvo.getAttribute("href");
    if (destino === "/pix-lote/comprovante" && location.pathname === "/pix-lote") { enviarLote(); return; }
    if (destino === "/painel" && location.pathname === "/login") { entrar(); return; }
    navegar(destino);
  });
  window.addEventListener("popstate", () => render(location.pathname));

  setTimeout(() => {
    const el = document.getElementById("agente");
    if (window.dynatrace) { el.textContent = "agente RUM: ativo (API nova)"; el.className = "agente ok"; }
    else if (window.dtrum) { el.textContent = "agente RUM: ativo (API clássica)"; el.className = "agente ok"; }
    else { el.textContent = "agente RUM: não carregou"; el.className = "agente erro"; }
  }, 2500);

  render(location.pathname);
})();
