/* Modelo e layout do grafo de fluxo. Sem dependência de DOM: testável fora do navegador.
   Nós: aplicações (entrada), telas (views), serviços de backend e bancos de dados.
   Arestas: navegação tela -> tela, chamada canal -> serviço e serviço -> serviço/banco (modelo de entidades) e
   página -> serviço (requisições da página cruzadas com os spans pelo trace). */

export type TipoNo = "app" | "view" | "servico" | "banco";
export type TipoAresta = "nav" | "req" | "call";

/** Tipo de canal da aplicação RUM, pelo prefixo da entidade: web (APPLICATION-), mobile (MOBILE_APPLICATION-), custom (CUSTOM_APPLICATION-). */
export type Canal = "web" | "mobile" | "custom";
export const canalDaEntidade = (entidade: string | null | undefined): Canal =>
  !entidade ? "web" : entidade.startsWith("MOBILE_APPLICATION-") ? "mobile" : entidade.startsWith("CUSTOM_APPLICATION-") ? "custom" : "web";
export interface AppInfo { id: string; nome: string; canal?: Canal; entidade?: string | null }
export interface LinhaAresta { app: string; de: string | null; para: string; tipo: string | null; n: number; sessoes: number; appDe?: string | null;   // appDe: origem em outra aplicação (híbrido)
  /** 1.43: navegações da seta nas últimas 24 h (o desenho do grafo vem das 24 h; n é do período escolhido, ao vivo) */
  dia?: number }
export interface LinhaView { app: string; view: string; views: number; sessoes: number; tempo_ms: number | null; erros: number; excecoes: number; falhas: number }
export interface LinhaBackend { app: string; servico: string }                                      // canal -> serviço (relação calls da aplicação RUM)
export interface LinhaServico { id: string; nome: string; tipo: string; tecnologia?: string; fabricante?: string | null; requisicoes?: number; falhas?: number }   // dt.entity.service + requisições na janela
export interface LinhaChamada { de: string; para: string }                                          // serviço -> serviço ou banco (relação calls)
export interface LinhaPagina { app: string; view: string; servico: string; chamadas: number }       // página -> serviço atingido (traces)
export interface ServicoAtingido { id: string; nome: string; chamadas: number; proxy: boolean; ordem: number }   // ordem: 1 = primeiro servidor chamado

/** Servidor web, proxy, gateway ou ingress: só repassa a chamada. Pela tecnologia do agente ou pelo nome. */
const TECNOLOGIAS_PROXY = new Set(["NGINX", "APACHE", "APACHE_HTTP_SERVER", "IBM_HTTP_SERVER", "ORACLE_HTTP_SERVER", "HAPROXY", "ENVOY", "VARNISH"]);
export const ehProxy = (s?: { nome: string; tecnologia?: string } | null) =>
  !!s && (TECNOLOGIAS_PROXY.has((s.tecnologia ?? "").toUpperCase()) || /gateway|ingress|proxy/i.test(s.nome));

export interface NoFluxo {
  id: string;
  nome: string;
  tipo: TipoNo;
  app: string | null;        // aplicação dona (telas e entradas); null para backend
  canal: Canal | null;       // só na caixa da aplicação: web, mobile ou custom (define o ícone)
  entrada: boolean;          // atalho: tipo === "app"
  camada: number;
  ordem: number;
  entradas: number;          // navegações que chegam (telas) / requisições que chegam (backend)
  saidas: number;            // navegações que saem (telas)
  fim: number;               // chegam e não seguem (drop-off), estimado
  sessoes: number;
  tempoMs: number | null;
  erros: number;             // exceções JS + requisições com falha (+ outros)
  excecoes: number;
  falhas: number;
  chamadas: number;          // backend: requisições recebidas na janela (métrica nativa do serviço); página: requisições ligadas ao backend
  servicosAtingidos?: ServicoAtingido[];   // página: todos os serviços que as requisições dela atravessam (proxies por último)
  x: number;
  y: number;
}

export interface ArestaFluxo {
  de: string;
  para: string;
  tipo: TipoAresta;
  n: number;                 // nav: navegações; req/call: 0 (o modelo de entidades diz quem chama, não quantas vezes)
  sessoes: number;
  pct: number;               // nav: % de quem sai de "de" e vai para "para"
  retorno: boolean;          // nav que volta para uma camada anterior (ou igual)
  /** 1.43: navegações nas últimas 24 h; seta com n = 0 e dia > 0 existe no dia mas não teve tráfego no período (apagada) */
  dia?: number;
}

export interface Grafo { nos: NoFluxo[]; arestas: ArestaFluxo[]; camadas: number; linhas: number }

export interface EntradaGrafo {
  apps: AppInfo[];
  arestas: LinhaAresta[];
  views: LinhaView[];
  backend?: LinhaBackend[];
  servicos?: LinhaServico[];
  chamadas?: LinhaChamada[];
  paginas?: LinhaPagina[];
  pctMinimo?: number;
}

export const idEntrada = (app: string) => `app|${app}`;
export const idView = (app: string, view: string) => `${app}|${view}`;
export const ENTRADA = "__entrada__";          // compatibilidade: prefixo lógico das entradas

export function montarGrafo(e: EntradaGrafo): Grafo {
  const pctMinimo = e.pctMinimo ?? 0;
  const indiceApp = new Map(e.apps.map((a, i) => [a.id, i]));
  const nomeApp = new Map(e.apps.map((a) => [a.id, a.nome]));
  const canalApp = new Map(e.apps.map((a) => [a.id, a.canal ?? "web"]));
  const nos = new Map<string, NoFluxo>();
  const novoNo = (id: string, nome: string, tipo: TipoNo, app: string | null): NoFluxo => {
    let n = nos.get(id);
    if (!n) {
      n = { id, nome, tipo, app, canal: tipo === "app" ? (canalApp.get(app ?? "") ?? "web") : null, entrada: tipo === "app", camada: -1, ordem: 0, entradas: 0, saidas: 0, fim: 0, sessoes: 0, tempoMs: null, erros: 0, excecoes: 0, falhas: 0, chamadas: 0, x: 0, y: 0 };
      nos.set(id, n);
    }
    return n;
  };

  // 1) navegações: agrega por (de, para) dentro de cada aplicação; sem origem = entrada -> tela. Quem decide a origem é
  //    a fonte (métrica rum_flow.navigation/entry e ORIGEM da cópia): carga de página ("hard") COM origem é passo, porque
  //    em micro-frontends toda troca de módulo recarrega a página
  const mapa = new Map<string, ArestaFluxo>();
  for (const l of e.arestas) {
    if (!l.para || !l.app) continue;
    if (!indiceApp.has(l.app)) { indiceApp.set(l.app, indiceApp.size); nomeApp.set(l.app, l.app); }
    const appDe = l.appDe ?? l.app;
    if (!indiceApp.has(appDe)) { indiceApp.set(appDe, indiceApp.size); nomeApp.set(appDe, appDe); }
    const de = !l.de ? idEntrada(l.app) : idView(appDe, l.de);
    const para = idView(l.app, l.para);
    if (de === para) continue;                                      // recarga da mesma tela não é passo
    const k = `${de}\u0000${para}`;
    const a = mapa.get(k) ?? { de, para, tipo: "nav" as TipoAresta, n: 0, sessoes: 0, pct: 0, retorno: false };
    a.n += l.n; a.sessoes += l.sessoes;
    if (l.dia) a.dia = (a.dia ?? 0) + l.dia;
    mapa.set(k, a);
    novoNo(de, de.startsWith("app|") ? (nomeApp.get(l.app) ?? l.app) : l.de!, de.startsWith("app|") ? "app" : "view", de.startsWith("app|") ? l.app : appDe);
    novoNo(para, l.para, "view", l.app);
  }
  let nav = [...mapa.values()];
  const saidaPor = new Map<string, number>();
  for (const a of nav) saidaPor.set(a.de, (saidaPor.get(a.de) ?? 0) + a.n);
  for (const a of nav) a.pct = (100 * a.n) / (saidaPor.get(a.de) || 1);
  // seta só do dia (sem tráfego no período): o "esconder caminhos raros" usa a fatia dela nas 24 h
  const saidaDia = new Map<string, number>();
  for (const a of nav) saidaDia.set(a.de, (saidaDia.get(a.de) ?? 0) + (a.dia ?? 0));
  const pctDia = (a: ArestaFluxo) => (100 * (a.dia ?? 0)) / (saidaDia.get(a.de) || 1);
  if (pctMinimo > 0) nav = nav.filter((a) => (a.n > 0 ? a.pct >= pctMinimo : pctDia(a) >= pctMinimo) || a.de.startsWith("app|"));
  nav.sort((a, b) => b.n - a.n);
  for (const a of nav) { novoNo(a.de, "", "view", null).saidas += a.n; novoNo(a.para, "", "view", null).entradas += a.n; }

  // métricas das telas
  for (const v of e.views) {
    const n = nos.get(idView(v.app, v.view));
    if (!n) continue;
    n.sessoes = v.sessoes; n.tempoMs = v.tempo_ms; n.erros = v.erros; n.excecoes = v.excecoes; n.falhas = v.falhas;
  }
  for (const n of nos.values()) {
    if (n.tipo === "app") { n.entradas = n.saidas; n.sessoes = n.sessoes || n.saidas; }
    if (n.tipo === "view") n.fim = Math.max(0, n.entradas - n.saidas);
    if (!n.sessoes) n.sessoes = n.entradas;
  }

  // 2) backend na ordem em que é chamado: página -> primeiro servidor que recebe a chamada (servidor web ou gateway)
  //    -> gateway -> ingress -> API -> microsserviços -> bancos. A ligação da página sai das requisições dela cruzadas
  //    com os spans pelo trace; a cadeia sai do modelo de entidades (quem chama quem; sem volume por ligação, o volume
  //    fica no nó). Canal -> porta só quando o canal não tem ligação de página (sem a cópia enxuta).
  const servicos = new Map((e.servicos ?? []).map((s) => [s.id, s]));
  const nomeServico = (id: string) => {
    const s = servicos.get(id);
    if (!s) return id.replace(/^SERVICE-/, "serviço ");
    return s.tipo === "DATABASE_SERVICE" && s.fabricante ? `${s.nome} (${s.fabricante})` : s.nome;
  };
  const tipoServico = (id: string): TipoNo => (servicos.get(id)?.tipo === "DATABASE_SERVICE" ? "banco" : "servico");
  const noServico = (id: string) => {
    const novo = !nos.has(id);
    const n = novoNo(id, nomeServico(id), tipoServico(id), null);
    // 1.45.9: as requisições com falha do serviço na janela (métrica nativa, R$ 0) deixam o nó vermelho, com o número
    if (novo) { n.chamadas = servicos.get(id)?.requisicoes ?? 0; n.entradas = n.chamadas; n.falhas = servicos.get(id)?.falhas ?? 0; n.erros = n.falhas; }
    return n;
  };
  const chamadoresDe = new Map<string, string[]>(), chamaPara = new Map<string, string[]>();
  for (const c of e.chamadas ?? []) {
    if (!c.de || !c.para || c.de === c.para) continue;
    (chamadoresDe.get(c.para) ?? chamadoresDe.set(c.para, []).get(c.para)!).push(c.de);
    (chamaPara.get(c.de) ?? chamaPara.set(c.de, []).get(c.de)!).push(c.para);
  }
  const vistas = new Set<string>();
  const req: ArestaFluxo[] = [];
  const proxy = (id: string) => ehProxy(servicos.get(id));
  // página -> primeiro servidor: entre os serviços que as requisições da página atravessam, os que ninguém do mesmo
  // conjunto chama. Cada serviço atingido ganha a ordem em que é chamado (1 = o primeiro), para o painel e o isolar.
  const porPagina = new Map<string, LinhaPagina[]>();
  for (const p of e.paginas ?? []) {
    const id = idView(p.app, p.view);
    if (!nos.has(id) || !p.servico) continue;
    const l = porPagina.get(id) ?? []; l.push(p); porPagina.set(id, l);
  }
  const appsComPagina = new Set<string>();
  for (const [pagina, linhas] of porPagina) {
    const atingidos = new Map(linhas.map((l) => [l.servico, l.chamadas]));
    let raizes = [...atingidos.keys()].filter((sv) => !(chamadoresDe.get(sv) ?? []).some((c) => atingidos.has(c) && c !== sv));
    if (!raizes.length) raizes = [linhas.reduce((a, b) => (b.chamadas > a.chamadas ? b : a)).servico];
    const ordem = new Map(raizes.map((r) => [r, 1]));
    const fila = [...raizes];
    while (fila.length) {
      const x = fila.shift()!;
      for (const y of chamaPara.get(x) ?? []) if (atingidos.has(y) && !ordem.has(y)) { ordem.set(y, ordem.get(x)! + 1); fila.push(y); }
    }
    const pag = nos.get(pagina)!;
    pag.servicosAtingidos = linhas.map((l) => ({ id: l.servico, nome: nomeServico(l.servico), chamadas: l.chamadas, proxy: proxy(l.servico), ordem: ordem.get(l.servico) ?? 99 }))
      .sort((a, b) => a.ordem - b.ordem || b.chamadas - a.chamadas);
    for (const r of raizes) {
      if (vistas.has(`${pagina}>${r}`)) continue;
      vistas.add(`${pagina}>${r}`);
      noServico(r);
      pag.chamadas += atingidos.get(r) ?? 0;
      req.push({ de: pagina, para: r, tipo: "req", n: atingidos.get(r) ?? 0, sessoes: 0, pct: 0, retorno: false });
    }
    if (pag.app) appsComPagina.add(pag.app);
  }
  // canal -> porta (modelo de entidades): só para o canal sem ligação de página
  for (const b of e.backend ?? []) {
    const de = idEntrada(b.app);
    if (appsComPagina.has(b.app) || !nos.has(de) || !b.servico || vistas.has(`${de}>${b.servico}`)) continue;
    vistas.add(`${de}>${b.servico}`);
    noServico(b.servico);
    req.push({ de, para: b.servico, tipo: "req", n: 0, sessoes: 0, pct: 0, retorno: false });
  }
  // serviço -> serviço/banco: tudo o que se alcança a partir dos primeiros servidores (a lista de chamadas vem em
  // qualquer ordem; só fica o que está ligado ao fluxo)
  const call: ArestaFluxo[] = [];
  const alcancados = new Set(req.map((a) => a.para));
  const filaBackend = [...alcancados];
  while (filaBackend.length) {
    const de = filaBackend.shift()!;
    for (const para of chamaPara.get(de) ?? []) {
      if (vistas.has(`${de}>${para}`)) continue;
      vistas.add(`${de}>${para}`);
      noServico(para);
      call.push({ de, para, tipo: "call", n: 0, sessoes: 0, pct: 100, retorno: false });
      if (!alcancados.has(para)) { alcancados.add(para); filaBackend.push(para); }
    }
  }

  // 3) camadas das telas pelo caminho DOMINANTE (origem que mais traz gente); entradas na camada 0
  const predominante = new Map<string, ArestaFluxo>();
  for (const a of nav) { const atual = predominante.get(a.para); if (!atual || a.n > atual.n) predominante.set(a.para, a); }
  for (const n of nos.values()) if (n.tipo === "app") n.camada = 0;
  for (let passo = 0; passo < nos.size + 1; passo++) {
    let mudou = false;
    for (const n of nos.values()) {
      if (n.camada >= 0 || n.tipo !== "view") continue;
      const pred = predominante.get(n.id);
      const camadaPred = pred ? nos.get(pred.de)?.camada ?? -1 : -1;
      if (camadaPred >= 0) { n.camada = camadaPred + 1; mudou = true; }
    }
    if (!mudou) break;
  }
  // ciclos sem ligação com a entrada: busca em largura por qualquer navegação; o que sobrar vai para o fim
  const saidasDe = new Map<string, ArestaFluxo[]>();
  for (const a of nav) { const l = saidasDe.get(a.de) ?? []; l.push(a); saidasDe.set(a.de, l); }
  const fila = [...nos.values()].filter((n) => n.camada >= 0).map((n) => n.id);
  while (fila.length) {
    const atual = fila.shift()!;
    for (const a of saidasDe.get(atual) ?? []) {
      const alvo = nos.get(a.para)!;
      if (alvo.camada < 0) { alvo.camada = nos.get(atual)!.camada + 1; fila.push(a.para); }
    }
  }
  let maxTelas = Math.max(0, ...[...nos.values()].filter((n) => n.tipo !== "servico" && n.tipo !== "banco").map((n) => n.camada));
  for (const n of nos.values()) if (n.tipo === "view" && n.camada < 0) n.camada = ++maxTelas;
  for (const a of nav) a.retorno = (nos.get(a.para)?.camada ?? 0) <= (nos.get(a.de)?.camada ?? 0);

  // 4) backend à direita das páginas, na ordem em que é chamado: os primeiros servidores na primeira coluna depois das
  //    páginas e cada serviço uma coluna depois de quem o chama (caminho mais longo: servidor web -> gateway -> ingress
  //    -> API -> microsserviços -> bancos).
  //    Ciclo (A chama B e B chama A, comum em CICS/mainframe): no caminho mais longo ele não termina e empurrava os
  //    serviços uma coluna por volta, até a borda da tela. A chamada que FECHA o ciclo (volta para quem está na pilha da
  //    busca em profundidade, a partir de quem as páginas chamam) não empurra coluna. No fim, colunas vazias somem.
  const baseBackend = maxTelas + 1;
  const ehBackend = (n: NoFluxo | undefined) => !!n && (n.tipo === "servico" || n.tipo === "banco");
  const backendIds = [...nos.values()].filter(ehBackend).map((n) => n.id);
  const filhos = new Map<string, string[]>();
  for (const c of call) { const l = filhos.get(c.de) ?? []; l.push(c.para); filhos.set(c.de, l); }
  const visita = new Map<string, 1 | 2>();
  const fechaCiclo = new Set<string>();
  const visitar = (id: string) => {
    visita.set(id, 1);
    for (const f of filhos.get(id) ?? []) {
      const v = visita.get(f);
      if (v === 1) fechaCiclo.add(`${id}>${f}`);
      else if (!v) visitar(f);
    }
    visita.set(id, 2);
  };
  const alvosReq = new Set(req.map((r) => r.para));
  const raizes = backendIds.filter((id) => alvosReq.has(id)).sort((x, y) => (nos.get(y)!.chamadas - nos.get(x)!.chamadas));
  for (const id of [...raizes, ...backendIds]) if (!visita.has(id)) visitar(id);
  for (const id of backendIds) nos.get(id)!.camada = baseBackend;
  const dag = call.filter((c) => !fechaCiclo.has(`${c.de}>${c.para}`));
  for (let passo = 0; passo <= backendIds.length; passo++) {
    let mudou = false;
    for (const c of dag) {
      const de = nos.get(c.de)!, para = nos.get(c.para)!;
      if (para.camada < de.camada + 1) { para.camada = de.camada + 1; mudou = true; }
    }
    if (!mudou) break;
  }
  const usadas = [...new Set(backendIds.map((id) => nos.get(id)!.camada))].sort((x, y) => x - y);
  const compacta = new Map(usadas.map((c, i) => [c, baseBackend + i]));
  for (const id of backendIds) { const n = nos.get(id)!; n.camada = compacta.get(n.camada) ?? n.camada; }
  const arestas = [...nav, ...req, ...call];

  // 5) ordem dentro da camada: telas agrupadas por aplicação (mais tráfego em cima), backend por volume
  const porCamada = new Map<number, NoFluxo[]>();
  for (const n of nos.values()) { const l = porCamada.get(n.camada) ?? []; l.push(n); porCamada.set(n.camada, l); }
  const peso = (n: NoFluxo) => (n.tipo === "servico" || n.tipo === "banco" ? -n.chamadas : -n.entradas);
  for (const lista of porCamada.values()) {
    lista.sort((a, b) => (indiceApp.get(a.app ?? "") ?? 99) - (indiceApp.get(b.app ?? "") ?? 99) || peso(a) - peso(b) || a.nome.localeCompare(b.nome));
    lista.forEach((n, i) => { n.ordem = i; });
  }
  const linhas = Math.max(1, ...[...porCamada.values()].map((l) => l.length));
  const camadas = Math.max(0, ...[...nos.values()].map((n) => n.camada)) + 1;
  const lista = [...nos.values()].sort((a, b) => a.camada - b.camada || a.ordem - b.ordem);
  return { nos: lista, arestas, camadas, linhas };
}

/** Nós que se movem junto com a caixa de uma aplicação: a própria caixa, suas telas e o backend alcançado só por elas.
    Serviço/banco compartilhado com outra aplicação fica parado, para não distorcer o fluxo da outra. */
export function grupoDaAplicacao(grafo: Grafo, appId: string): string[] {
  const porId = new Map(grafo.nos.map((n) => [n.id, n]));
  // destinos de cada nó, na ordem das ligações: a busca visita os mesmos nós na mesma ordem, sem varrer todas as
  // ligações a cada nó visitado
  const saem = new Map<string, string[]>();
  for (const a of grafo.arestas) { const l = saem.get(a.de); if (l) l.push(a.para); else saem.set(a.de, [a.para]); }
  const alcance = (app: string) => {
    const vistos = new Set(grafo.nos.filter((n) => n.app === app).map((n) => n.id));
    const fila = [...vistos];
    for (let i = 0; i < fila.length; i++) {
      for (const para of saem.get(fila[i]) ?? []) {
        if (vistos.has(para)) continue;
        const alvo = porId.get(para);
        if (alvo && alvo.app === null) { vistos.add(para); fila.push(para); }
      }
    }
    return vistos;
  };
  const meu = alcance(appId);
  const deOutras = new Set<string>();
  for (const n of grafo.nos) if (n.tipo === "app" && n.app && n.app !== appId) for (const id of alcance(n.app)) deOutras.add(id);
  return [...meu].filter((id) => porId.get(id)?.app === appId || !deOutras.has(id));
}

/** Porta de entrada do backend: serviço que recebe as chamadas das páginas ou do canal (servidor web, gateway). */
export const ehEntradaBackend = (grafo: Grafo, id: string) =>
  grafo.nos.some((n) => n.id === id && (n.tipo === "servico" || n.tipo === "banco")) && grafo.arestas.some((a) => a.para === id && a.tipo === "req");

/** Nós que se movem junto com a porta de entrada do backend (como a caixa do canal move a aplicação): ela e todo o
    backend que ela alcança pelas chamadas serviço → serviço. Os demais serviços continuam se movendo sozinhos. */
export function grupoDoBackend(grafo: Grafo, id: string): string[] {
  const vistos = new Set([id]);
  const fila = [id];
  while (fila.length) {
    const atual = fila.shift()!;
    for (const a of grafo.arestas) if (a.de === atual && a.tipo === "call" && !vistos.has(a.para)) { vistos.add(a.para); fila.push(a.para); }
  }
  return [...vistos];
}

/** Profundidade do recorte "isolar": níveis para cada lado do nó, ou tudo. */
export type Niveis = 1 | 2 | 3 | "tudo";

/** Recorte "isolar": só os nós em caminhos que passam pelo nó, para trás até a entrada (canal) e para a frente até o
    fim, seguindo navegações de avanço (as de retorno só entram quando as duas pontas ficaram). Backend: isolando uma
    página, só os serviços que as requisições das páginas do recorte atingem (trace a trace) e os bancos deles;
    isolando o canal ou um serviço, a cadeia inteira. Camadas e ordem são recompactadas. */
export function isolarGrafo(grafo: Grafo, id: string, niveis: Niveis = "tudo"): Grafo {
  if (!grafo.nos.some((n) => n.id === id)) return grafo;
  const limite = niveis === "tudo" ? Infinity : niveis;
  const porId = new Map(grafo.nos.map((n) => [n.id, n]));
  const avanco = grafo.arestas.filter((a) => a.tipo === "nav" && !a.retorno);
  // vizinhos por mapa (na ordem das ligações), em vez de filtrar todas as ligações a cada nó da busca
  const frenteDe = new Map<string, string[]>(), trasDe = new Map<string, string[]>(), chamaDe = new Map<string, ArestaFluxo[]>(), chamadoPor = new Map<string, ArestaFluxo[]>();
  const juntar = <T,>(m: Map<string, T[]>, k: string, v: T) => { const l = m.get(k); if (l) l.push(v); else m.set(k, [v]); };
  for (const a of avanco) { juntar(frenteDe, a.de, a.para); juntar(trasDe, a.para, a.de); }
  for (const a of grafo.arestas) if (a.tipo !== "nav") { juntar(chamaDe, a.de, a); juntar(chamadoPor, a.para, a); }
  const bfs = (vizinhos: (x: string) => string[]) => {
    const dist = new Map<string, number>([[id, 0]]);
    const fila = [id];
    while (fila.length) {
      const atual = fila.shift()!, d = dist.get(atual)!;
      if (d >= limite) continue;
      for (const v of vizinhos(atual)) if (!dist.has(v)) { dist.set(v, d + 1); fila.push(v); }
    }
    return dist;
  };
  const frente = bfs((x) => frenteDe.get(x) ?? []);
  const tras = bfs((x) => trasDe.get(x) ?? []);
  const ids = new Set([...frente.keys(), ...tras.keys()]);
  // serviço/banco isolado: quem o chama (telas e serviços) e quem ele chama também entram
  const no = porId.get(id)!;
  if (no.tipo === "servico" || no.tipo === "banco") {
    const filaTras = [id];
    while (filaTras.length) { const x = filaTras.shift()!; for (const a of chamadoPor.get(x) ?? []) if (!ids.has(a.de)) { ids.add(a.de); filaTras.push(a.de); } }
    // a busca para trás parte sempre do nó isolado (o bfs não usa a página x), então o resultado é o mesmo de rodar uma
    // vez por página: roda uma vez só, se houver página no recorte
    if ([...ids].some((x) => porId.get(x)?.tipo === "view")) for (const [k] of bfs((y) => trasDe.get(y) ?? [])) ids.add(k);
  }
  const atingidos = new Set<string>();
  if (no.tipo === "view") for (const x of ids) for (const s of porId.get(x)?.servicosAtingidos ?? []) atingidos.add(s.id);
  const entra = (alvo: string) => no.tipo !== "view" || porId.get(alvo)?.tipo === "banco" || atingidos.has(alvo);
  const fila = [...ids].filter((x) => porId.get(x)?.tipo === "view" || porId.get(x)?.tipo === "servico" || (x === id && no.tipo === "app"));
  while (fila.length) { const x = fila.shift()!; for (const a of chamaDe.get(x) ?? []) if (!ids.has(a.para) && entra(a.para)) { ids.add(a.para); fila.push(a.para); } }
  const nos = grafo.nos.filter((n) => ids.has(n.id)).map((n) => ({ ...n }));
  return recompactar(nos, grafo.arestas.filter((a) => ids.has(a.de) && ids.has(a.para)).map((a) => ({ ...a })));
}

/** Esconde tipos de nó (serviços de backend e/ou bancos) e as arestas ligadas a eles. Bancos somem junto com os
    serviços, porque pendem deles. */
export function ocultarTipos(grafo: Grafo, ocultos: Set<TipoNo>): Grafo {
  if (ocultos.size === 0) return grafo;
  const tipos = new Set(ocultos);
  if (tipos.has("servico")) tipos.add("banco");
  const nos = grafo.nos.filter((n) => !tipos.has(n.tipo)).map((n) => ({ ...n }));
  const ids = new Set(nos.map((n) => n.id));
  return recompactar(nos, grafo.arestas.filter((a) => ids.has(a.de) && ids.has(a.para)).map((a) => ({ ...a })));
}

export interface Dominante { grafo: Grafo; limitado: boolean; porApp: { app: string; nome: string; total: number; mostradas: number }[] }

/** Caminho dominante: num canal com mais páginas que o limite, fica só o caminho que mais gente percorre (as N páginas
    com mais entradas; a de entrada sempre fica). O resto se alcança por "mostrar tudo", busca ou isolar. Backend
    das páginas mantidas continua. */
export function caminhoDominante(grafo: Grafo, limite: number): Dominante {
  const porApp = new Map<string, NoFluxo[]>();
  for (const n of grafo.nos) if (n.tipo === "view" && n.app) { const l = porApp.get(n.app) ?? []; l.push(n); porApp.set(n.app, l); }
  const manter = new Set(grafo.nos.filter((n) => n.tipo !== "view").map((n) => n.id));
  const resumo: Dominante["porApp"] = [];
  let limitado = false;
  for (const [app, paginas] of porApp) {
    const nome = grafo.nos.find((n) => n.tipo === "app" && n.app === app)?.nome ?? app;
    if (paginas.length <= limite) { for (const n of paginas) manter.add(n.id); resumo.push({ app, nome, total: paginas.length, mostradas: paginas.length }); continue; }
    limitado = true;
    const ordenadas = [...paginas].sort((a, b) => b.entradas - a.entradas || a.camada - b.camada || a.nome.localeCompare(b.nome));
    for (const n of ordenadas.slice(0, limite)) manter.add(n.id);
    resumo.push({ app, nome, total: paginas.length, mostradas: limite });
  }
  if (!limitado) return { grafo, limitado: false, porApp: resumo };
  const nos = grafo.nos.filter((n) => manter.has(n.id)).map((n) => ({ ...n }));
  const ids = new Set(nos.map((n) => n.id));
  const arestas = grafo.arestas.filter((a) => ids.has(a.de) && ids.has(a.para)).map((a) => ({ ...a }));
  // backend que só era alcançado por páginas escondidas sai também
  const comEntrada = new Set(arestas.map((a) => a.para));
  const nosFinal = nos.filter((n) => n.tipo === "app" || n.tipo === "view" || comEntrada.has(n.id));
  const idsFinal = new Set(nosFinal.map((n) => n.id));
  return { grafo: recompactar(nosFinal, arestas.filter((a) => idsFinal.has(a.de) && idsFinal.has(a.para))), limitado: true, porApp: resumo };
}

/** Depois de um recorte: renumera camadas sem buracos e a ordem dentro de cada camada. */
function recompactar(nos: NoFluxo[], arestas: ArestaFluxo[]): Grafo {
  const camadasUsadas = [...new Set(nos.map((n) => n.camada))].sort((a, b) => a - b);
  const novaCamada = new Map(camadasUsadas.map((c, i) => [c, i]));
  const porCamada = new Map<number, NoFluxo[]>();
  for (const n of nos) { n.camada = novaCamada.get(n.camada) ?? 0; const l = porCamada.get(n.camada) ?? []; l.push(n); porCamada.set(n.camada, l); }
  for (const lista of porCamada.values()) { lista.sort((a, b) => a.ordem - b.ordem); lista.forEach((n, i) => { n.ordem = i; }); }
  const linhas = Math.max(1, ...[...porCamada.values()].map((l) => l.length));
  return { nos: nos.sort((a, b) => a.camada - b.camada || a.ordem - b.ordem), arestas, camadas: Math.max(1, camadasUsadas.length), linhas };
}

// números no formato do idioma da interface (lib/i18n.ts; lido de globalThis, sem import de valor)
const loc = () => ((globalThis as { __DEF_IDIOMA?: string }).__DEF_IDIOMA === "en" ? "en-US" : "pt-BR");
export const formatarPct = (p: number) => (p >= 99.5 ? "100%" : p < 1 ? "<1%" : `${Math.round(p)}%`);
export const formatarMs = (ms: number | null) => (ms == null ? "" : ms >= 1000 ? `${(ms / 1000).toLocaleString(loc(), { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s` : `${Math.round(ms)} ms`);
export const formatarInt = (n: number) => n.toLocaleString(loc());
/** Número com casas decimais no formato do idioma (ex.: páginas por sessão). */
export const formatarDec = (n: number, casas = 1) => n.toLocaleString(loc(), { minimumFractionDigits: casas, maximumFractionDigits: casas });
/** Percentual com até 1 casa, no formato do idioma ("2,5%" / "2.5%"; "3%" sem ",0"); "<0,1%" e ">99,9%" nas pontas. */
export const formatarPctFino = (p: number | null) => {
  if (p == null) return "–";
  const f = (n: number) => n.toLocaleString(loc(), { minimumFractionDigits: 0, maximumFractionDigits: 1 });
  return p === 0 ? "0%" : p < 0.1 ? `<${f(0.1)}%` : p > 99.9 && p < 100 ? `>${f(99.9)}%` : `${p < 10 ? f(p) : Math.round(p)}%`;
};
