/* Banco Demo - SPA com rotas reais (history API) para o laboratório de fluxo RUM.
   Cada página é uma rota /caminho; a navegação é soft (pushState), como um app moderno.
   Dados vêm do backend (/api -> banco-api -> banco-core -> Postgres).
   Jornadas: login > extrato > Pix; abertura de conta (não cliente); solicitação de cartão de crédito (cliente). */
(function () {
  const app = document.getElementById("app");

  // valores digitados pelo usuário seguem para as próximas telas (ficam na sessão do navegador)
  const PADRAO = { agencia: "1234", conta: "56789-0", senha: "123456", codigo: "483921", chave: "maria@example.com", valor: "150,00", favorecido: "Maria da Silva",
                   nome: "Maria da Silva", cpf: "123.456.789-09", email: "maria@example.com", renda: "5.000,00", documento: "RG", cartaoTipo: "Gold" };
  let estado = Object.assign({}, PADRAO);
  try { estado = Object.assign({}, PADRAO, JSON.parse(sessionStorage.getItem("bancoDemo") || "{}")); } catch (e) {}
  function salvar() { try { sessionStorage.setItem("bancoDemo", JSON.stringify(estado)); } catch (e) {} }
  function coletar() {
    document.querySelectorAll("#app input[name], #app select[name]").forEach((i) => { estado[i.name] = i.value; });
    salvar();
  }
  const contaId = () => `${estado.agencia}-${estado.conta}`.replace(/\s+/g, "");
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const brl = (n) => Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const dataBR = (iso) => { const [a, m, d] = String(iso).slice(0, 10).split("-"); return `${d}/${m}/${a}`; };
  const opcoes = (lista, atual) => lista.map((o) => `<option value="${esc(o)}"${o === atual ? " selected" : ""}>${esc(o)}</option>`).join("");

  async function api(metodo, caminho, corpo) {
    const r = await fetch(caminho, { method: metodo, headers: { "content-type": "application/json" }, body: corpo ? JSON.stringify(corpo) : undefined });
    let dados = null;
    try { dados = await r.json(); } catch (e) {}
    if (!r.ok) throw new Error((dados && dados.erro) || `HTTP ${r.status}`);
    return dados;
  }

  const PAGINAS = {
    "/": {
      titulo: "Banco Demo - Início",
      carregar: () => api("GET", "/api/ofertas?canal=pf"),
      html: (d) => `
        <div class="cartao">
          <h1>Bem-vindo ao Banco Demo</h1>
          <p>Acesse sua conta, abra uma conta nova ou recupere sua senha.</p>
          ${d && d.titulo ? `<p class="dica"><b>${esc(d.titulo)}</b> · ${esc(d.descricao)}</p>` : ""}
          <div class="acoes">
            <button data-testid="btn-login" data-ir="/login">Entrar na conta</button>
            <button class="secundario" data-testid="btn-abrir-conta" data-ir="/abrir-conta">Abrir conta</button>
            <button class="secundario" data-testid="btn-recuperar" data-ir="/recuperar-senha">Recuperar senha</button>
          </div>
        </div>`
    },
    "/login": {
      titulo: "Banco Demo - Login",
      html: (d, erro) => `
        <div class="cartao">
          <h1>Login</h1>
          <p>Informe agência, conta e senha.</p>
          <label>Agência</label><input name="agencia" value="${esc(estado.agencia)}">
          <label>Conta</label><input name="conta" value="${esc(estado.conta)}">
          <label>Senha</label><input name="senha" type="password" value="${esc(estado.senha)}">
          ${erro ? `<p class="erro" style="margin-top:12px">Não foi possível entrar: ${esc(erro)}</p>` : ""}
          <div class="acoes" style="margin-top:16px">
            <button data-testid="btn-entrar" data-ir="/extrato">Acessar</button>
            <button class="secundario" data-testid="btn-voltar" data-ir="/">Voltar</button>
          </div>
        </div>`
    },
    "/recuperar-senha": {
      titulo: "Banco Demo - Recuperar senha",
      carregar: () => api("POST", "/api/senha/recuperar", { conta: contaId(), canal: "pf" }),
      html: (d) => `
        <div class="cartao">
          <h1>Recuperar senha</h1>
          <p>Enviamos um código para o celular cadastrado${d && d.enviado_para ? ` ${esc(d.enviado_para)}` : ""}.${d && d.protocolo ? ` Protocolo ${esc(d.protocolo)}.` : ""}</p>
          <label>Código</label><input name="codigo" value="${esc(estado.codigo)}">
          <div class="acoes" style="margin-top:16px">
            <button data-testid="btn-voltar" data-ir="/">Voltar ao início</button>
          </div>
        </div>`
    },
    "/abrir-conta": {
      titulo: "Banco Demo - Abrir conta",
      html: (d, erro) => `
        <div class="cartao">
          <h1>Abrir conta</h1>
          <p>Conta digital sem tarifa. Preencha seus dados para começar.</p>
          <label>Nome completo</label><input name="nome" value="${esc(estado.nome)}">
          <label>CPF</label><input name="cpf" value="${esc(estado.cpf)}">
          <label>E-mail</label><input name="email" value="${esc(estado.email)}">
          <label>Renda mensal (R$)</label><input name="renda" value="${esc(estado.renda)}">
          ${erro ? `<p class="erro" style="margin-top:12px">Não foi possível consultar o CPF: ${esc(erro)}</p>` : ""}
          <div class="acoes" style="margin-top:16px">
            <button data-testid="btn-continuar" data-ir="/abrir-conta/documentos">Continuar</button>
            <button class="secundario" data-testid="btn-voltar" data-ir="/">Voltar</button>
          </div>
        </div>`
    },
    "/abrir-conta/documentos": {
      titulo: "Banco Demo - Documentos",
      html: (d, erro) => `
        <div class="cartao">
          <h1>Documentos</h1>
          <p>Escolha o documento com foto e envie para a análise cadastral.</p>
          <label>Documento</label><select name="documento">${opcoes(["RG", "CNH", "Passaporte"], estado.documento)}</select>
          <p class="dica">Laboratório: o envio da foto é simulado.</p>
          ${erro ? `<p class="erro" style="margin-top:12px">Não foi possível concluir a abertura: ${esc(erro)}</p>` : ""}
          <div class="acoes" style="margin-top:16px">
            <button data-testid="btn-criar-conta" data-ir="/abrir-conta/confirmacao">Enviar e criar conta</button>
            <button class="secundario" data-testid="btn-voltar" data-ir="/">Voltar</button>
          </div>
        </div>`
    },
    "/abrir-conta/confirmacao": {
      titulo: "Banco Demo - Conta aberta",
      carregar: () => api("GET", `/api/aberturas?conta=${encodeURIComponent(contaId())}`),
      html: (d) => {
        const a = estado.ultimaAbertura || {};
        return `
        <div class="cartao">
          <h1>Conta ${esc((d && d.status) || "aberta")}</h1>
          <p>Parabéns, ${esc(a.nome)}! Sua conta foi criada. Protocolo ${esc(a.protocolo)}.</p>
          <p>Agência <b>${esc(a.agencia)}</b> · Conta <b>${esc(a.conta)}</b></p>
          <div class="acoes">
            <button data-testid="btn-login" data-ir="/login">Entrar na conta</button>
            <button class="secundario" data-testid="btn-sair" data-ir="/sair">Sair</button>
          </div>
        </div>`;
      }
    },
    "/extrato": {
      titulo: "Banco Demo - Extrato",
      carregar: () => api("GET", `/api/extrato?conta=${encodeURIComponent(contaId())}`),
      html: (d, erro) => `
        <div class="cartao">
          <h1>Extrato</h1>
          <p>Agência ${esc(estado.agencia)} · Conta ${esc(estado.conta)}</p>
          ${erro ? `<p class="erro">Não foi possível carregar o extrato: ${esc(erro)}</p>` : `
          <p>Saldo disponível: <b>R$ ${brl(d.saldo)}</b></p>
          <table><tr><th>Data</th><th>Descrição</th><th>Valor (R$)</th></tr>
          ${d.lancamentos.map((l) => `<tr><td>${dataBR(l.data)}</td><td>${esc(l.descricao)}</td><td style="color:${l.valor < 0 ? "#b91c1c" : "#15803d"}">${brl(l.valor)}</td></tr>`).join("")}
          </table>`}
          <div class="acoes">
            <button data-testid="btn-pix" data-ir="/pix">Fazer um Pix</button>
            <button class="secundario" data-testid="btn-cartao" data-ir="/cartao">Solicitar cartão</button>
            <button class="secundario" data-testid="btn-sair" data-ir="/sair">Sair</button>
          </div>
        </div>`
    },
    "/pix": {
      titulo: "Banco Demo - Pix",
      html: (d, erro) => `
        <div class="cartao">
          <h1>Pix</h1>
          <label>Favorecido</label><input name="favorecido" value="${esc(estado.favorecido)}">
          <label>Chave</label><input name="chave" value="${esc(estado.chave)}">
          <label>Valor (R$)</label><input name="valor" value="${esc(estado.valor)}">
          ${erro ? `<p class="erro" style="margin-top:12px">${esc(erro)}</p>` : ""}
          <div class="acoes" style="margin-top:16px">
            <button data-testid="btn-confirmar" data-ir="/pix/confirmacao">Confirmar Pix</button>
            <button class="secundario" data-testid="btn-voltar" data-ir="/extrato">Voltar</button>
          </div>
        </div>`
    },
    "/pix/confirmacao": {
      titulo: "Banco Demo - Pix confirmado",
      html: () => {
        const p = estado.ultimoPix || {};
        return `
        <div class="cartao">
          <h1>Pix ${esc(p.status || "confirmado")}</h1>
          <p>Comprovante ${esc(p.id)} · R$ ${brl(p.valor)} para ${esc(p.favorecido)} (${esc(p.chave)}).</p>
          <p>Novo saldo: <b>R$ ${brl(p.saldo)}</b></p>
          <div class="acoes">
            <button data-testid="btn-sair" data-ir="/sair">Sair</button>
            <button class="secundario" data-testid="btn-extrato" data-ir="/extrato">Ver extrato</button>
          </div>
        </div>`;
      }
    },
    "/cartao": {
      titulo: "Banco Demo - Cartão de crédito",
      html: (d, erro) => `
        <div class="cartao">
          <h1>Solicitar cartão de crédito</h1>
          <p>Escolha o cartão e informe sua renda para a análise de crédito.</p>
          <label>Cartão</label><select name="cartaoTipo">${opcoes(["Gold", "Platinum", "Black"], estado.cartaoTipo)}</select>
          <label>Renda mensal (R$)</label><input name="renda" value="${esc(estado.renda)}">
          ${erro ? `<p class="erro" style="margin-top:12px">Não foi possível analisar o pedido: ${esc(erro)}</p>` : ""}
          <div class="acoes" style="margin-top:16px">
            <button data-testid="btn-solicitar" data-ir="/cartao/resultado">Solicitar</button>
            <button class="secundario" data-testid="btn-voltar" data-ir="/extrato">Voltar</button>
          </div>
        </div>`
    },
    "/cartao/resultado": {
      titulo: "Banco Demo - Resultado do cartão",
      html: () => {
        const c = estado.ultimoCartao || {};
        const aprovado = c.status === "aprovado";
        return `
        <div class="cartao">
          <h1>Cartão ${esc(c.tipo)} ${aprovado ? "aprovado" : "não aprovado"}</h1>
          ${aprovado
            ? `<p>Proposta ${esc(c.proposta)} · limite de <b>R$ ${brl(c.limite)}</b>. O cartão chega em até 7 dias úteis.</p>`
            : `<p class="aviso">Proposta ${esc(c.proposta)}: ${esc(c.motivo || "não aprovado nesta análise")}.</p>`}
          <div class="acoes">
            <button data-testid="btn-extrato" data-ir="/extrato">Ver extrato</button>
            <button class="secundario" data-testid="btn-sair" data-ir="/sair">Sair</button>
          </div>
        </div>`;
      }
    },
    "/sair": {
      titulo: "Banco Demo - Sessão encerrada",
      carregar: () => api("POST", "/api/logout", { conta: contaId(), canal: "pf" }),
      html: () => `
        <div class="cartao">
          <h1>Sessão encerrada</h1>
          <p>Obrigado por usar o Banco Demo.</p>
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
    // LAB: erro JavaScript forçado em ~30% das visitas a /recuperar-senha (exceção não tratada -> evento de erro no RUM)
    if (caminho === "/recuperar-senha" && Math.random() < 0.3) {
      setTimeout(() => { throw new TypeError("Falha ao validar o código: sessão de recuperação expirada"); }, 300);
    }
    // RUM clássico (window.dtrum): nomeia a página explicitamente. RUM novo detecta a rota sozinho.
    if (window.dtrum && typeof window.dtrum.setPage === "function") {
      try { window.dtrum.setPage({ name: caminho, group: "banco-demo" }); } catch (e) {}
    }
  }

  function navegar(caminho, erro) {
    if (location.pathname !== caminho) history.pushState({}, "", caminho);
    return render(caminho, erro);
  }

  // passos que dependem do backend: só navegam para a tela de resultado se o core aceitar; senão a tela atual mostra .erro
  async function confirmarPix() {
    try {
      estado.ultimoPix = await api("POST", "/api/pix", { conta: contaId(), favorecido: estado.favorecido, chave: estado.chave, valor: estado.valor });
      salvar();
      return navegar("/pix/confirmacao");
    } catch (e) {
      return render("/pix", e.message);
    }
  }
  async function abrirConta() {
    try {
      estado.ultimaAbertura = await api("POST", "/api/contas", { nome: estado.nome, cpf: estado.cpf, email: estado.email, renda: estado.renda, documento: estado.documento });
      estado.agencia = estado.ultimaAbertura.agencia; estado.conta = estado.ultimaAbertura.conta;   // o login seguinte já usa a conta nova
      salvar();
      return navegar("/abrir-conta/confirmacao");
    } catch (e) {
      return render("/abrir-conta/documentos", e.message);
    }
  }
  async function solicitarCartao() {
    try {
      estado.ultimoCartao = await api("POST", "/api/cartoes", { conta: contaId(), tipo: estado.cartaoTipo, renda: estado.renda });
      salvar();
      return navegar("/cartao/resultado");
    } catch (e) {
      return render("/cartao", e.message);
    }
  }
  async function entrar() {
    try {
      await api("POST", "/api/login", { conta: contaId(), canal: "pf" });
      return navegar("/extrato");
    } catch (e) {
      return render("/login", e.message);
    }
  }
  async function consultarCpf() {
    try {
      await api("GET", `/api/cpf?cpf=${encodeURIComponent(estado.cpf)}`);
      return navegar("/abrir-conta/documentos");
    } catch (e) {
      return render("/abrir-conta", e.message);
    }
  }
  const PASSOS_BACKEND = { "/pix|/pix/confirmacao": confirmarPix, "/abrir-conta/documentos|/abrir-conta/confirmacao": abrirConta, "/cartao|/cartao/resultado": solicitarCartao,
                           "/login|/extrato": entrar, "/abrir-conta|/abrir-conta/documentos": consultarCpf };

  document.addEventListener("click", (ev) => {
    const alvo = ev.target.closest("[data-ir], a[data-link]");
    if (!alvo) return;
    ev.preventDefault();
    coletar();
    const destino = alvo.dataset.ir || alvo.getAttribute("href");
    const passo = PASSOS_BACKEND[`${location.pathname}|${destino}`];
    if (passo) { passo(); return; }
    navegar(destino);
  });
  window.addEventListener("popstate", () => render(location.pathname));

  // estado do agente, só para diagnóstico visual
  setTimeout(() => {
    const el = document.getElementById("agente");
    if (window.dynatrace) { el.textContent = "agente RUM: ativo (API nova)"; el.className = "agente ok"; }
    else if (window.dtrum) { el.textContent = "agente RUM: ativo (API clássica)"; el.className = "agente ok"; }
    else { el.textContent = "agente RUM: não carregou"; el.className = "agente erro"; }
  }, 2500);

  render(location.pathname);
})();
