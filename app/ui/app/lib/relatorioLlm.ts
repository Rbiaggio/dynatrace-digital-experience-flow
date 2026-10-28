/* Relatório "Oportunidades de melhoria da experiência digital" (PDF, botão "Gerar relatório" da Visão geral). Com a janela
   "Analisar com LLM", é o único lugar com a análise por LLM. Monta no navegador, a partir do que a tela já
   avaliou (lib/oportunidades.ts): nenhuma consulta nova.
   Estrutura: capa · resumo executivo (números da Visão geral, resumo do Dynatrace Assist quando pronto, as 3 que mais
   pesam) · oportunidades priorizadas e "para medir melhor" · matriz impacto x esforço e plano em ondas (só aqui, não na
   tela) · iniciativas recomendadas (catálogo editável, SEM preço) · anexo A (os dossiês de evidências da análise por
   LLM: o que cada um leva e a regra de privacidade) · anexo B (as regras avaliadas e o resultado de cada uma).
   Aqui também o PDF da ANÁLISE por LLM (gerarAnaliseLlmPdf, "Baixar a análise (PDF)" da janela "Analisar com LLM"): o resumo estrutural no topo e cada oportunidade em Problema x Causa x Solução x Benefício.
   O PDF sai do gerador próprio de lib/assistPdf.ts (só texto, fontes padrão Latin-1, leve e pesquisável): a mesma classe,
   desenhada aqui com tabelas, caixas e a matriz. Todo texto livre passa por mascarar() (lib/assist.ts). */
import { PdfSimples, latin1 } from "./assistPdf";
import { mascarar } from "./assist";
import { catalogoRegras, textoTipo, textoEsforco, letraEsforco, nomeCurtoApp, PESOS, PESO_ESFORCO, type Oportunidade, type ResultadoOportunidades, type TipoServico, type IdRegra } from "./oportunidades";
import type { ProblemaDado } from "./qualidade";
import type { Confianca, Esforco, ResultadoLlm } from "./llmCliente";

// idioma da interface (lib/i18n.ts): cópia local, como em lib/inicio.ts
const t = (pt: string, en: string) => ((globalThis as { __DEF_IDIOMA?: string }).__DEF_IDIOMA === "en" ? en : pt);
const loc = () => ((globalThis as { __DEF_IDIOMA?: string }).__DEF_IDIOMA === "en" ? "en-US" : "pt-BR");
const int = (n: number) => Math.round(n).toLocaleString(loc());
const dec = (n: number, c = 2) => n.toLocaleString(loc(), { minimumFractionDigits: c, maximumFractionDigits: c });

/** Quem pode gerar o relatório: ponto ÚNICO de decisão (por enquanto, todos; a permissão por perfil entra aqui). */
export function podeGerarRelatorio(_perfil?: { email?: string | null; papeis?: string[] }): boolean {
  return true;
}

/* ---- Catálogo de iniciativas (editável, sem preço) -------------------------------------------------------------- */
export interface OfertaIniciativa { oferta: string; entrega: string; formato: string; duracao: string }
/** Iniciativa por tipo de problema: nomes, escopo, entregas e duração típica são sugestões para ajustar ao seu contexto (passe `catalogo` em DadosRelatorio para trocar). Sem preço. */
export const catalogoIniciativasPadrao = (): Record<TipoServico, OfertaIniciativa> => ({
  "back-resiliencia": { oferta: t("Confiabilidade de jornadas críticas (SRE)", "Critical journey reliability (SRE)"), entrega: t("SLO por jornada, failover e roteamento regional, circuit breaker, nova tentativa idempotente, alertas por estado, teste de carga e de falha", "SLO per journey, failover and regional routing, circuit breaker, idempotent retry, alerts per state, load and failure tests"), formato: t("time de SRE com o time do serviço", "SRE team with the service team"), duracao: t("4 a 8 semanas", "4 to 8 weeks") },
  "back-api": { oferta: t("Correção de APIs com causa raiz", "API fixes with root cause"), entrega: t("análise pelos traces (serviço onde a falha nasce), correção, testes de contrato e de regressão, painel de erros por endpoint", "trace analysis (service where the failure starts), fix, contract and regression tests, error dashboard per endpoint"), formato: t("time de backend", "backend team"), duracao: t("2 a 6 semanas", "2 to 6 weeks") },
  "front-desempenho": { oferta: t("Core Web Vitals na meta", "Core Web Vitals on target"), entrega: t("orçamento de desempenho, carga tardia de componentes, cache e timeout de APIs, espaço reservado contra CLS, guia para o time", "performance budget, lazy loading of components, API cache and timeout, reserved space against CLS, team guide"), formato: t("especialistas de frontend com o time do app", "frontend specialists with the app team"), duracao: t("2 a 4 semanas", "2 to 4 weeks") },
  "front-codigo": { oferta: t("Sprint de estabilidade do frontend", "Frontend stability sprint"), entrega: t("triagem dos erros de JavaScript por impacto, correção, testes de tela automatizados e alerta de regressão", "triage of JavaScript errors by impact, fixes, automated page tests and regression alerts"), formato: t("sprint dedicada", "dedicated sprint"), duracao: t("1 a 2 semanas", "1 to 2 weeks") },
  mobile: { oferta: t("Desempenho e estabilidade do app", "App performance and stability"), entrega: t("crash e ANR, abertura do app, ações lentas, versão com monitoração e meta no Apdex mobile", "crash and ANR, app start, slow actions, monitored release and a mobile Apdex target"), formato: t("time mobile", "mobile team"), duracao: t("3 a 6 semanas", "3 to 6 weeks") },
  observabilidade: { oferta: t("Observabilidade Dynatrace (RUM, OpenPipeline, Grail)", "Dynatrace observability (RUM, OpenPipeline, Grail)"), entrega: t("nomes de telas, correlação RUM e backend, métrica de Apdex por tela (web e mobile), custo de DPS sob controle", "screen names, RUM and backend correlation, per-screen Apdex metric (web and mobile), DPS cost under control"), formato: t("especialistas em Dynatrace", "Dynatrace specialists"), duracao: t("1 a 3 semanas", "1 to 3 weeks") },
  jornada: { oferta: t("Jornadas e conversão", "Journeys and conversion"), entrega: t("jornadas salvas no Digital Experience Flow, funis, mensagens de erro com saída para o cliente, testes A/B", "journeys saved in Digital Experience Flow, funnels, error messages with a way out for the customer, A/B tests"), formato: t("UX e dados com o negócio", "UX and data with the business"), duracao: t("3 a 6 semanas", "3 to 6 weeks") },
});
const acompanhamento = (): OfertaIniciativa => ({ oferta: t("Acompanhamento mensal da experiência digital", "Monthly digital experience follow-up"), entrega: t("revisão mensal das oportunidades com o negócio, relatório, priorização do backlog e medição do ganho (Apdex, conversão, saídas após erro)", "monthly review of the opportunities with the business, report, backlog prioritization and measurement of the gain (Apdex, conversion, exits after errors)"), formato: t("rotina contínua", "ongoing routine"), duracao: t("contínuo", "ongoing") });

/* ---- Entrada ---------------------------------------------------------------------------------------------------------- */
export interface DadosRelatorio {
  resultado: ResultadoOportunidades;
  /** "Todas as aplicações" ou o nome da aplicação */
  escopo: string;
  apps: { id: string; nome: string; canal?: string }[];
  /** período dos números (lib/oportunidades.ts textoPeriodo) */
  periodo: string;
  sessoes: number;
  /** 1.44.6: no escopo padrão, as sessões da capa são da última hora (o resto do relatório segue o período escolhido) */
  sessoesUltimaHora?: boolean;
  /** quando o relatório foi gerado (ms) e por quem (nome da plataforma) */
  geradoEm: number;
  geradoPor?: string | null;
  /** o texto do "Resumo do Dynatrace Assist", quando pronto */
  resumoAssist?: string | null;
  experiencia?: { web?: { apdex: number; nota: string } | null; mobile?: { apdex: number; nota: string; validar?: string | null } | null };
  /** "Para ver o fluxo completo" de hoje (lib/qualidade.ts): entram em "para medir melhor" com os novos (Q1, Q2, W8) */
  ajustesExistentes?: ProblemaDado[];
  /** um dossiê de evidências da análise por LLM (lib/dossie.ts), para o início do JSON no anexo A */
  dossie?: unknown | null;
  catalogo?: Partial<Record<TipoServico, OfertaIniciativa>>;
}

/* ---- Desenho ---------------------------------------------------------------------------------------------------------- */
type Pdf = PdfSimples;
/** Documento vazio do gerador de lib/assistPdf.ts. */
const novoPdf = (): Pdf => new PdfSimples();
type Cor = readonly [number, number, number];
const COR = {
  texto: [27, 31, 42], sub: [91, 98, 115], linha: [223, 226, 232], caixa: [244, 245, 248], azul: [25, 102, 255],
  erro: [179, 38, 58], erroF: [253, 238, 240], aviso: [138, 90, 0], avisoF: [255, 245, 221],
  /** azul da marca do app: só o filete da capa e do rodapé */
  marca: [59, 42, 128],
} as const satisfies Record<string, Cor>;
const A4 = { l: 210, a: 297 }, M = 14, LARG = A4.l - 2 * M, TOPO = 18, BASE = A4.a - 18;
const MM = 0.3528;
type EstiloF = "normal" | "bold" | "italic" | "bolditalic";
interface Txt { tam?: number; estilo?: EstiloF; cor?: Cor; fam?: "helvetica" | "courier" }

class Folha {
  pdf = novoPdf();
  y = TOPO;
  fonte(o: Txt = {}) { this.pdf.setFont(o.fam ?? "helvetica", o.estilo ?? "normal"); this.pdf.setFontSize(o.tam ?? 9.5); const c = o.cor ?? COR.texto; this.pdf.setTextColor(c[0], c[1], c[2]); }
  lh(tam = 9.5) { return tam * MM * 1.38; }
  /** quebra em linhas; a linha que começa num espaço (o gerador corta na palavra que estoura) perde o espaço, menos no código */
  partir(s: string, larg: number, o: Txt = {}) { this.fonte(o); const ls = this.pdf.splitTextToSize(latin1(s), larg); return o.fam === "courier" ? ls : ls.map((l) => l.trimStart()); }
  nova() { this.pdf.addPage(); this.y = TOPO; }
  quebra(h: number) { if (this.y + h > BASE) this.nova(); }
  /** texto corrido (quebra por palavra e por página) a partir do topo atual */
  bloco(s: string, o: Txt & { x?: number; larg?: number; depois?: number } = {}) {
    const tam = o.tam ?? 9.5, x = o.x ?? M, ls = this.partir(s, o.larg ?? LARG - (x - M), o), lh = this.lh(tam);
    for (const l of ls) { this.quebra(lh); this.fonte(o); this.pdf.text(l, x, this.y + tam * MM * 0.82); this.y += lh; }
    this.y += o.depois ?? 1.5;
  }
  titulo(s: string, nivel: 1 | 2 = 1) { this.quebra(nivel === 1 ? 14 : 10); this.bloco(s, { tam: nivel === 1 ? 15 : 11.5, estilo: "bold", depois: nivel === 1 ? 3 : 1.5 }); }
  preencher(c: Cor) { this.pdf.setFillColor(c[0], c[1], c[2]); }
  tracar(c: Cor, w = 0.25) { this.pdf.setDrawColor(c[0], c[1], c[2]); this.pdf.setLineWidth(w); }
  caixa(x: number, y: number, w: number, h: number, fundo: Cor | null, borda: Cor | null = COR.linha) {
    if (fundo) { this.preencher(fundo); this.pdf.rect(x, y, w, h, "F"); }
    if (borda) { this.tracar(borda); this.pdf.rect(x, y, w, h, "S"); }
  }
  /** texto centrado num ponto (para os números das bolhas) */
  centro(s: string, cx: number, cyBase: number, o: Txt) { this.fonte(o); const w = this.pdf.getTextWidth(latin1(s)); this.pdf.text(latin1(s), cx - w / 2, cyBase); }
}

interface Celula { s: string; estilo?: EstiloF; cor?: Cor; tam?: number; extra?: { s: string; cor?: Cor; estilo?: EstiloF } }
interface Coluna { titulo: string; larg: number; centro?: boolean }
const cel = (x: string | Celula): Celula => (typeof x === "string" ? { s: x } : x);
/** Tabela com quebra de linha nas células, cabeçalho repetido em página nova e linha que não se parte entre páginas. */
function tabela(f: Folha, cols: Coluna[], linhas: (string | Celula)[][], o: { tam?: number; ordem?: (i: number) => Celula | null } = {}) {
  const tam = o.tam ?? 8.3, lh = f.lh(tam), pad = 1.6;
  const cabecalho = () => {
    const hs = cols.map((c) => f.partir(c.titulo, c.larg - 2 * pad, { tam, estilo: "bold" }));
    const h = Math.max(...hs.map((x) => x.length)) * lh + 2 * pad;
    f.quebra(h + lh * 2 + 2 * pad);
    let x = M;
    cols.forEach((c, i) => { hs[i].forEach((l, k) => { f.fonte({ tam, estilo: "bold", cor: COR.sub }); f.pdf.text(l, x + pad, f.y + pad + k * lh + tam * MM * 0.82); }); x += c.larg; });
    f.y += h; f.tracar(COR.linha, 0.4); f.pdf.line(M, f.y, M + LARG, f.y);
  };
  cabecalho();
  for (const linha of linhas) {
    const cs = linha.map(cel);
    const partes = cs.map((c, i) => {
      const a = f.partir(c.s, cols[i].larg - 2 * pad, { tam: c.tam ?? tam, estilo: c.estilo });
      const b = c.extra ? f.partir(c.extra.s, cols[i].larg - 2 * pad, { tam: tam - 0.8, estilo: c.extra.estilo }) : [];
      return { a, b };
    });
    const h = Math.max(...partes.map((p) => p.a.length * lh + p.b.length * f.lh(tam - 0.8))) + 2 * pad;
    if (f.y + h > BASE) { f.nova(); cabecalho(); }
    let x = M;
    cs.forEach((c, i) => {
      let yy = f.y + pad;
      for (const l of partes[i].a) {
        f.fonte({ tam: c.tam ?? tam, estilo: c.estilo, cor: c.cor });
        const w = cols[i].centro ? f.pdf.getTextWidth(l) : 0;
        f.pdf.text(l, cols[i].centro ? x + cols[i].larg / 2 - w / 2 : x + pad, yy + (c.tam ?? tam) * MM * 0.82); yy += lh;
      }
      for (const l of partes[i].b) { f.fonte({ tam: tam - 0.8, estilo: c.extra!.estilo, cor: c.extra!.cor ?? COR.sub }); f.pdf.text(l, x + pad, yy + (tam - 0.8) * MM * 0.82); yy += f.lh(tam - 0.8); }
      x += cols[i].larg;
    });
    f.y += h; f.tracar(COR.linha, 0.2); f.pdf.line(M, f.y, M + LARG, f.y);
  }
  f.y += 3;
}

/* ---- Montagem --------------------------------------------------------------------------------------------------------- */
const tomCor = (o: Oportunidade): Cor => (o.tom === "grave" ? COR.erro : COR.aviso);
const m = (s: string) => mascarar(s);
const formula = (o: Oportunidade) => {
  const p = o.impacto, partes = [p.perdidos ? `${PESOS.perdidos} x ${int(p.perdidos)}` : "", p.afetados ? `${int(p.afetados)}` : "", p.lentos ? `${dec(PESOS.lentos, 1)} x ${int(p.lentos)}` : ""].filter(Boolean);
  return `${int(Math.round(o.pontuacao * 10) / 10)} = (${partes.join(" + ") || "0"}) / ${PESO_ESFORCO[o.esforco]}`;
};
const nomesApps = (d: DadosRelatorio, ids: string[]) => ids.map((a) => d.apps.find((x) => x.id === a)?.nome ?? a);

/** O PDF do relatório (bytes). */
export function gerarRelatorioPdf(d: DadosRelatorio): Uint8Array {
  const f = new Folha();
  const r = d.resultado, itens = r.itens;
  f.pdf.setProperties({ title: latin1(t("Oportunidades de melhoria da experiência digital", "Digital experience improvement opportunities")), creator: "Digital Experience Flow" });
  const quando = new Date(d.geradoEm);
  const data = quando.toLocaleDateString(loc(), { day: "2-digit", month: "2-digit", year: "numeric" });

  // capa
  f.y = 30;
  f.bloco(t("RELATÓRIO DE EXPERIÊNCIA DIGITAL · GERADO PELO DIGITAL EXPERIENCE FLOW", "DIGITAL EXPERIENCE REPORT · GENERATED BY DIGITAL EXPERIENCE FLOW"), { tam: 9, cor: COR.sub, depois: 40 });
  const yTitulo = f.y;
  f.bloco(t("Oportunidades de melhoria da experiência digital", "Digital experience improvement opportunities"), { tam: 26, estilo: "bold", x: M + 5, depois: 6 });
  f.preencher(COR.marca); f.pdf.rect(M, yTitulo + 1, 1.6, f.y - yTitulo - 7, "F");
  const linhasCapa = [
    `${d.escopo} · ${nomesApps(d, d.apps.map((a) => a.id)).join(", ")}`,
    d.sessoesUltimaHora ? t(`Período analisado: ${d.periodo} · ${int(d.sessoes)} sessões na última hora`, `Timeframe: ${d.periodo} · ${int(d.sessoes)} sessions in the last hour`)
      : t(`Período analisado: ${d.periodo} · ${int(d.sessoes)} sessões`, `Timeframe: ${d.periodo} · ${int(d.sessoes)} sessions`),
    t(`Fonte: Dynatrace (RUM on Grail, traces e métricas) lido pelo Digital Experience Flow${d.resumoAssist ? ", com resumo do Dynatrace Assist" : ""}.`, `Source: Dynatrace (RUM on Grail, traces and metrics) read by Digital Experience Flow${d.resumoAssist ? ", with a Dynatrace Assist summary" : ""}.`),
  ];
  for (const l of linhasCapa) f.bloco(m(l), { tam: 12, cor: COR.sub, x: M + 5, depois: 2.5 });
  f.tracar(COR.linha, 0.3); f.pdf.line(M, BASE - 8, M + LARG, BASE - 8);
  f.fonte({ tam: 9, cor: COR.sub });
  f.pdf.text(latin1(t(`Gerado pelo Digital Experience Flow${d.geradoPor ? ` para ${m(d.geradoPor)}` : ""}`, `Generated by Digital Experience Flow${d.geradoPor ? ` for ${m(d.geradoPor)}` : ""}`)), M, BASE - 3);
  f.pdf.text(latin1(data), M + LARG, BASE - 3, { align: "right" });

  // resumo executivo
  f.nova();
  f.titulo(t("Resumo executivo", "Executive summary"));
  const lentos = itens.filter((o) => o.regras.includes("W1")).reduce((s, o) => s + o.impacto.lentos, 0);
  const web = d.experiencia?.web, mob = d.experiencia?.mobile;
  const kpis: { v: string; r: string; c: Cor }[] = [
    { v: int(r.numeros.naoConcluiram), r: t("clientes não concluíram uma transação por erro", "customers did not complete a transaction due to an error"), c: r.numeros.naoConcluiram ? COR.erro : COR.texto },
    { v: int(r.numeros.sairamAposErro), r: t("saíram da sessão logo após um erro", "left the session right after an error"), c: r.numeros.sairamAposErro ? COR.erro : COR.texto },
    lentos ? { v: int(lentos), r: t("esperaram mais de 4 s por uma página", "waited more than 4 s for a page"), c: COR.aviso } : { v: int(itens.length), r: t("oportunidades com impacto no cliente", "opportunities with customer impact"), c: COR.texto },
    { v: [web ? dec(web.apdex) : null, mob ? dec(mob.apdex) : null].filter(Boolean).join(" · ") || "-", r: [web ? t(`Apdex web (${web.nota})`, `Web Apdex (${web.nota})`) : "", mob ? t(`Apdex mobile (${mob.nota}${mob.validar ? ", Validar" : ""})`, `Mobile Apdex (${mob.nota}${mob.validar ? ", Validate" : ""})`) : ""].filter(Boolean).join(" · ") || t("Apdex sem medição no período", "Apdex not measured in the timeframe"), c: COR.texto },
  ];
  const kw = (LARG - 9) / 4, ky = f.y;
  kpis.forEach((k, i) => {
    const x = M + i * (kw + 3);
    f.caixa(x, ky, kw, 24, null);
    f.fonte({ tam: 17, estilo: "bold", cor: k.c }); f.pdf.text(latin1(k.v), x + 3, ky + 9);
    f.partir(k.r, kw - 6, { tam: 7.8 }).slice(0, 4).forEach((l, j) => { f.fonte({ tam: 7.8, cor: COR.sub }); f.pdf.text(l, x + 3, ky + 14 + j * 3.1); });
  });
  f.y = ky + 29;
  if (d.resumoAssist) {
    const ls = f.partir(m(d.resumoAssist), LARG - 10, { tam: 9.5 }), h = ls.length * f.lh(9.5) + 11;
    f.quebra(h);
    f.caixa(M, f.y, LARG, h, COR.caixa, null); f.preencher(COR.azul); f.pdf.rect(M, f.y, 1, h, "F");
    f.fonte({ tam: 7.8, cor: COR.sub }); f.pdf.text(latin1(t("Resumo do Dynatrace Assist", "Dynatrace Assist summary")), M + 5, f.y + 5);
    ls.forEach((l, j) => { f.fonte({ tam: 9.5 }); f.pdf.text(l, M + 5, f.y + 10 + j * f.lh(9.5)); });
    f.y += h + 5;
  }
  if (itens.length) {
    f.titulo(t("As três oportunidades que mais pesam", "The three opportunities that weigh the most"), 2);
    itens.slice(0, 3).forEach((o, i) => f.bloco(m(`${i + 1}. ${o.titulo}: ${o.impactoTexto}. ${t("O que fazer", "What to do")}: ${o.acao} (${t("esforço", "effort")} ${letraEsforco(o.esforco)}).`), { tam: 9.5, x: M + 2, depois: 2 }));
  }
  f.titulo(t("Como lemos os números", "How we read the numbers"), 2);
  const semAchado = r.verificacoes.filter((v) => v.estado === "sem-achado"), semDado = r.verificacoes.filter((v) => v.estado === "sem-dado");
  f.bloco(t(`Cada oportunidade sai de uma regra sobre os dados que o Digital Experience Flow já lê (anexo B), com os mesmos números da Visão geral. A ordem pesa o que mais custa ao cliente: quem não concluiu ou saiu logo após o problema pesa ${PESOS.perdidos}, outros clientes afetados ${PESOS.afetados}, lentidão ${dec(PESOS.lentos, 1)}, e o total é dividido pelo esforço (P 1, M 2, G 3). Os números são do período analisado; em produção, olhe 7 dias para confirmar a tendência.`,
            `Each opportunity comes from a rule over the data Digital Experience Flow already reads (appendix B), with the same numbers as the overview. The order weighs what costs customers the most: customers who did not complete or left right after the problem weigh ${PESOS.perdidos}, other affected customers ${PESOS.afetados}, slowness ${dec(PESOS.lentos, 1)}, and the total is divided by the effort (S 1, M 2, L 3). The numbers are from the analyzed timeframe; in production, look at 7 days to confirm the trend.`), { tam: 9.5 });
  f.bloco(t(`Avaliamos ${r.verificacoes.length} regras: ${r.verificacoes.length - semAchado.length - semDado.length} com achado, ${semAchado.length} sem achado e ${semDado.length} sem dado neste ambiente (${semDado.map((v) => v.regra).join(", ") || "nenhuma"}).`,
            `We checked ${r.verificacoes.length} rules: ${r.verificacoes.length - semAchado.length - semDado.length} with findings, ${semAchado.length} without findings and ${semDado.length} without data in this environment (${semDado.map((v) => v.regra).join(", ") || "none"}).`), { tam: 9.5 });

  // oportunidades priorizadas
  f.nova();
  f.titulo(t("Oportunidades priorizadas", "Prioritized opportunities"));
  if (!itens.length) f.bloco(t("Nenhuma oportunidade com impacto no cliente neste período.", "No opportunity with customer impact in this timeframe."), { cor: COR.sub });
  else tabela(f, [{ titulo: "", larg: 6 }, { titulo: t("Oportunidade", "Opportunity"), larg: 32 }, { titulo: t("Impacto no cliente", "Customer impact"), larg: 28 }, { titulo: t("Evidência", "Evidence"), larg: 43 }, { titulo: t("O que fazer", "What to do"), larg: 37 }, { titulo: t("Esforço", "Effort"), larg: 15, centro: true }, { titulo: t("Tipo de serviço", "Service type"), larg: 21 }],
    itens.map((o, i) => [{ s: String(i + 1), estilo: "bold", cor: tomCor(o) }, { s: m(o.titulo), estilo: "bold", extra: { s: o.apps.map((a) => nomeCurtoApp(d.apps.find((x) => x.id === a)?.nome ?? a)).join(" · ") } },
      { s: m(o.impactoTexto), estilo: "bold", cor: tomCor(o) }, { s: m(o.evidencia), cor: COR.sub }, { s: m(o.acao), extra: { s: t(`Quem faz: ${m(o.quem)}`, `Who: ${m(o.quem)}`) } },
      { s: letraEsforco(o.esforco), estilo: "bold" }, { s: textoTipo(o.tipo) }]));
  const ajustes = [...(d.ajustesExistentes ?? []), ...r.ajustes];
  if (ajustes.length) {
    f.titulo(t("Para medir melhor", "To measure better"), 2);
    f.bloco(t("Não afetam o cliente, mas escondem ou distorcem parte do que acontece (na tela: \"Para ver o fluxo completo\").", "They don't affect customers, but hide or distort part of what happens (on screen: \"To see the whole flow\")."), { tam: 8.5, cor: COR.sub });
    tabela(f, [{ titulo: "", larg: 7 }, { titulo: t("Ajuste", "Fix"), larg: 40 }, { titulo: t("O que acontece", "What happens"), larg: 70 }, { titulo: t("Correção", "Correction"), larg: 65 }],
      ajustes.map((a, i) => [{ s: String(itens.length + i + 1), cor: COR.sub }, { s: m(a.titulo), estilo: "bold" }, { s: m(a.detalhe), cor: COR.sub }, { s: m(a.correcao), extra: { s: t(`Quem faz: ${m(a.quem)}`, `Who: ${m(a.quem)}`) } }]));
  }
  if (itens.length) f.bloco(t(`Esforço: P = ${textoEsforco("P")} · M = ${textoEsforco("M")} · G = ${textoEsforco("G")}. Pontuação: ${itens.map((o, i) => `${i + 1}) ${formula(o)}`).join("; ")}.`,
                              `Effort: S = ${textoEsforco("P")} · M = ${textoEsforco("M")} · L = ${textoEsforco("G")}. Score: ${itens.map((o, i) => `${i + 1}) ${formula(o)}`).join("; ")}.`), { tam: 7.8, cor: COR.sub });

  // matriz e ondas
  if (itens.length) {
    f.nova();
    f.titulo(t("Impacto x esforço", "Impact x effort"));
    f.bloco(t("Em cima e à esquerda: mais impacto no cliente com menos esforço. A altura é o impacto (escala logarítmica); vermelho perdeu ou afetou clientes, âmbar é lentidão.", "Top left: more customer impact with less effort. Height is the impact (log scale); red lost or affected customers, amber is slowness."), { tam: 8.5, cor: COR.sub });
    matriz(f, itens);
    f.titulo(t("Plano em ondas", "Plan in waves"));
    const ondas: [1 | 2 | 3, string, string][] = [
      [1, t("Onda 1 · agora (até 2 semanas)", "Wave 1 · now (up to 2 weeks)"), t("a oportunidade que mais pesa e as correções rápidas", "the opportunity that weighs the most and the quick fixes")],
      [2, t("Onda 2 · próximas semanas (2 a 6)", "Wave 2 · next weeks (2 to 6)"), t("as de esforço médio que vêm a seguir", "the medium-effort ones that come next")],
      [3, t("Onda 3 · contínuo", "Wave 3 · ongoing"), t("o restante e o acompanhamento mensal", "the rest and the monthly follow-up")],
    ];
    for (const [n, tit, foco] of ondas) {
      const os = itens.filter((o) => o.onda === n);
      const linhas = os.flatMap((o) => [{ s: `${itens.indexOf(o) + 1}. ${m(o.titulo)} · ${t("esforço", "effort")} ${letraEsforco(o.esforco)} · ${m(o.quem)}`, b: true }, { s: t(`Como medir o ganho no Digital Experience Flow: ${m(o.medida)}`, `How to measure the gain in Digital Experience Flow: ${m(o.medida)}`), b: false }]);
      if (n === 3) linhas.push({ s: acompanhamento().oferta, b: true }, { s: `${acompanhamento().entrega.charAt(0).toUpperCase()}${acompanhamento().entrega.slice(1)}.`, b: false });
      const partes = linhas.map((l) => ({ ...l, ls: f.partir(l.s, LARG - 10, { tam: l.b ? 9 : 8, estilo: l.b ? "bold" : "normal" }) }));
      const h = 12 + partes.reduce((s, p) => s + p.ls.length * f.lh(p.b ? 9 : 8) + (p.b ? 0.4 : 1.6), 0) + (os.length || n === 3 ? 0 : 5);
      f.quebra(h);
      const y0 = f.y;
      f.caixa(M, y0, LARG, h, null);
      f.fonte({ tam: 10.5, estilo: "bold" }); f.pdf.text(latin1(tit), M + 4, y0 + 6);
      f.fonte({ tam: 8, cor: COR.sub }); f.pdf.text(latin1(t(`Foco: ${foco}`, `Focus: ${foco}`)), M + 4, y0 + 10.2);
      let yy = y0 + 14;
      if (!os.length && n !== 3) { f.fonte({ tam: 8.5, cor: COR.sub }); f.pdf.text(latin1(t("Nada nesta onda.", "Nothing in this wave.")), M + 6, yy + 1); }
      for (const p of partes) { for (const l of p.ls) { f.fonte({ tam: p.b ? 9 : 8, estilo: p.b ? "bold" : "normal", cor: p.b ? COR.texto : COR.sub }); f.pdf.text(l, M + 6, yy + 1); yy += f.lh(p.b ? 9 : 8); } yy += p.b ? 0.4 : 1.6; }
      f.y = y0 + h + 4;
    }
    f.bloco(t("As ondas são uma sugestão pela ordem e pelo esforço; ajuste com os times donos de cada item.", "The waves are a suggestion by order and effort; adjust them with the teams that own each item."), { tam: 8, cor: COR.sub });
  }

  // iniciativas recomendadas
  f.nova();
  f.titulo(t("Iniciativas recomendadas", "Recommended initiatives"));
  {
    const nota = t("Catálogo editável de iniciativas: escopo, entregas e duração típica são sugestões; ajuste ao seu contexto.", "Editable catalog of initiatives: scope, deliverables and typical duration are suggestions; adjust them to your context.");
    const ls = f.partir(nota, LARG - 8, { tam: 8.5 }), h = ls.length * f.lh(8.5) + 5;
    f.caixa(M, f.y, LARG, h, COR.caixa, null);
    ls.forEach((l, j) => { f.fonte({ tam: 8.5, cor: COR.sub }); f.pdf.text(l, M + 4, f.y + 4.5 + j * f.lh(8.5)); });
    f.y += h + 4;
  }
  const cat = { ...catalogoIniciativasPadrao(), ...(d.catalogo ?? {}) };
  // em caixa: as ofertas dos tipos que aparecem (e observabilidade, se houver ajuste); as outras numa linha no fim
  const tipos = [...new Set([...itens.map((o) => o.tipo), ...(ajustes.length ? ["observabilidade" as TipoServico] : [])])];
  const outras = (Object.keys(cat) as TipoServico[]).filter((k) => !tipos.includes(k));
  const ofertas: { tipo: string; of: OfertaIniciativa; cobre: string }[] = tipos.map((k) => {
    const cobre = itens.filter((o) => o.tipo === k);
    return { tipo: textoTipo(k), of: cat[k], cobre: cobre.length ? t(`cobre neste relatório: ${cobre.map((o) => `${itens.indexOf(o) + 1}) ${m(o.titulo)}`).join("; ")}`, `covers in this report: ${cobre.map((o) => `${itens.indexOf(o) + 1}) ${m(o.titulo)}`).join("; ")}`) : k === "observabilidade" && ajustes.length ? t("cobre os ajustes de \"Para medir melhor\"", "covers the \"To measure better\" fixes") : t("não aparece neste período", "does not show in this timeframe") };
  });
  ofertas.push({ tipo: t("Transversal", "Cross-cutting"), of: acompanhamento(), cobre: "" });
  for (const o of ofertas) {
    const corpo = f.partir(`${o.of.entrega.charAt(0).toUpperCase()}${o.of.entrega.slice(1)}.`, LARG - 8, { tam: 8.8 });
    const pe = f.partir(t(`Formato: ${o.of.formato} · duração típica: ${o.of.duracao}${o.cobre ? ` · ${o.cobre}` : ""}`, `Format: ${o.of.formato} · typical duration: ${o.of.duracao}${o.cobre ? ` · ${o.cobre}` : ""}`), LARG - 8, { tam: 8 });
    const h = 13 + corpo.length * f.lh(8.8) + pe.length * f.lh(8) + 2;
    f.quebra(h);
    const y0 = f.y;
    f.caixa(M, y0, LARG, h, null);
    f.fonte({ tam: 7.5, cor: COR.sub }); f.pdf.text(latin1(o.tipo.toUpperCase()), M + 4, y0 + 4.8);
    f.fonte({ tam: 10.5, estilo: "bold" }); f.pdf.text(latin1(o.of.oferta), M + 4, y0 + 9.6);
    let yy = y0 + 14;
    for (const l of corpo) { f.fonte({ tam: 8.8 }); f.pdf.text(l, M + 4, yy); yy += f.lh(8.8); }
    for (const l of pe) { f.fonte({ tam: 8, cor: COR.sub }); f.pdf.text(l, M + 4, yy); yy += f.lh(8); }
    f.y = y0 + h + 3;
  }
  if (outras.length) f.bloco(t(`Também no catálogo, sem achado neste período: ${outras.map((k) => `${cat[k].oferta} (${textoTipo(k).toLowerCase()})`).join("; ")}.`,
                               `Also in the catalog, with no finding in this timeframe: ${outras.map((k) => `${cat[k].oferta} (${textoTipo(k).toLowerCase()})`).join("; ")}.`), { tam: 8.5, cor: COR.sub });

  // anexo A: dossiês
  f.nova();
  f.titulo(t("Anexo A · Dossiês de evidências de \"Analisar com LLM\"", "Appendix A · Evidence dossiers of \"Analyze with an LLM\""));
  f.bloco(t("Só quando alguém pede a análise por LLM e aceita, o Digital Experience Flow lê no ambiente, com a identidade de quem pediu, um dossiê de evidências para cada uma das oportunidades priorizadas (até 8): uma amostra de chamadas da cópia enxuta e os spans só desses traces, métricas (sem custo de leitura), problemas do Davis, eventos de deploy e no máximo 4 leituras curtas de user.events. A leitura tem orçamento e é medida (bytes do Grail e o custo pelo preço de consulta em uso). Cada dossiê é sanitizado e verificado no navegador e de novo na função do app antes de ir ao LLM.",
            "Only when someone requests the LLM analysis and accepts, Digital Experience Flow reads in the environment, with the identity of who asked, an evidence dossier for each prioritized opportunity (up to 8): a sample of calls from the lean copy and the spans of those traces only, metrics (no read cost), Davis problems, deployment events and at most 4 short user.events reads. The read has a budget and is measured (Grail bytes and the cost at the query price in use). Each dossier is sanitized and checked in the browser and again in the app function before going to the LLM."), { tam: 9 });
  const dos = d.dossie && typeof d.dossie === "object" ? (d.dossie as Record<string, unknown>) : null;
  tabela(f, [{ titulo: t("Campo", "Field"), larg: 38 }, { titulo: t("O que leva", "What it carries"), larg: 82 }, { titulo: t("Privacidade", "Privacy"), larg: 62 }], camposDossie().map(([x, y, z]) => [{ s: x, estilo: "bold" }, y, { s: z, cor: COR.sub }]));
  f.titulo(t("Nunca sai do ambiente", "Never leaves the environment"), 2);
  f.bloco(t("Id de sessão, usuários e tags de usuário, IP, e-mail, CPF ou CNPJ, token, parâmetros de URL, ids nos caminhos (viram {id}), IDs de trace e de span, ids de entidade e corpo de resposta do servidor. Mensagens de exceção e pilhas vão cortadas e mascaradas (números longos, e-mails, CPF e CNPJ).",
            "Session id, users and user tags, IP, e-mail, CPF or CNPJ, token, URL parameters, ids in paths (they become {id}), trace and span IDs, entity ids and server response bodies. Exception messages and stacks go cut and masked (long numbers, e-mails, CPF and CNPJ)."), { tam: 9 });
  if (dos) {
    f.titulo(t("Início de um dossiê deste ambiente", "Start of a dossier from this environment"), 2);
    const json = JSON.stringify(dos, null, 1).split("\n").slice(0, 30);
    for (const l of json) { const ls = f.partir(l.replace(/\t/g, " "), LARG - 4, { tam: 7, fam: "courier" }); for (const x of ls) { f.quebra(3); f.fonte({ tam: 7, fam: "courier", cor: COR.sub }); f.pdf.text(x, M + 2, f.y + 2.4); f.y += 3; } }
    f.bloco("...", { tam: 7, fam: "courier", cor: COR.sub });
  }

  // anexo B: regras
  f.nova();
  f.titulo(t("Anexo B · Regras avaliadas", "Appendix B · Rules checked"));
  f.bloco(t("As regras rodam no navegador sobre o que a Visão geral já leu (INI-A, INI-B, QUA-U, funis, métrica de Apdex). As de chamada lenta por estado, terceiros e falha por estado entram como grupos nas mesmas leituras: a cobrança do Grail é pelos bytes da janela, não pelas linhas. Só leem algo novo, e só sob demanda: \"Onde falha no backend?\" (spans em volta das falhas), os Web Vitals por página e as ações do app (user.events) e a análise por LLM (os dossiês do anexo A, com orçamento de leitura).",
            "The rules run in the browser over what the overview already read (INI-A, INI-B, QUA-U, funnels, Apdex metric). Slow calls by state, third parties and failures by state come as groups in the same reads: Grail bills the window's bytes, not the rows. Only these read something new, and only on demand: \"Where does it fail in the backend?\" (spans around the failures), Web Vitals per page, the app actions (user.events) and the LLM analysis (the dossiers of appendix A, with a read budget)."), { tam: 8.5, cor: COR.sub });
  const estado = (id: IdRegra) => { const v = r.verificacoes.find((x) => x.regra === id); return v ? `${v.estado === "achado" ? t("Achado", "Finding") : v.estado === "sem-achado" ? t("Sem achado", "No finding") : t("Sem dado", "No data")}: ${v.nota}` : "-"; };
  tabela(f, [{ titulo: t("Regra", "Rule"), larg: 38 }, { titulo: t("Detecção e limite", "Detection and threshold"), larg: 50 }, { titulo: t("Fonte no app", "Source in the app"), larg: 36 }, { titulo: t("Custo a mais", "Extra cost"), larg: 24 }, { titulo: t("Neste período", "In this timeframe"), larg: 34 }],
    catalogoRegras().map((g) => [{ s: `${g.id} ${g.nome}`, estilo: "bold", extra: { s: `${g.canal} · ${t("esforço", "effort")} ${letraEsforco(g.esforco)} · ${textoTipo(g.tipo)}` } }, g.deteccao, { s: g.fonte, cor: COR.sub }, { s: g.custo, cor: COR.sub }, { s: estado(g.id), estilo: r.verificacoes.find((x) => x.regra === g.id)?.estado === "achado" ? "bold" : "normal" }]), { tam: 7.6 });

  // rodapé (menos na capa)
  const n = f.pdf.getNumberOfPages();
  for (let p = 2; p <= n; p++) {
    f.pdf.setPage(p);
    f.preencher(COR.marca); f.pdf.rect(M, A4.a - 12.4, 6, 0.8, "F");
    f.tracar(COR.linha, 0.2); f.pdf.line(M + 7, A4.a - 12, M + LARG, A4.a - 12);
    f.fonte({ tam: 7.5, cor: COR.sub });
    f.pdf.text(latin1(t("Oportunidades de melhoria · gerado pelo Digital Experience Flow", "Improvement opportunities · generated by Digital Experience Flow")), M, A4.a - 8);
    f.pdf.text(latin1(t(`página ${p} de ${n}`, `page ${p} of ${n}`)), M + LARG, A4.a - 8, { align: "right" });
  }
  return f.pdf.bytes();
}

/** Matriz impacto x esforço: colunas P, M, G; altura pelo impacto bruto (pontuação x esforço), em escala log. */
function matriz(f: Folha, itens: Oportunidade[]) {
  const W = LARG, H = 78, x0 = M + 14, y0 = f.y + 2, w = W - 16, h = H - 14;
  f.quebra(H + 4);
  const imp = (o: Oportunidade) => Math.max(0.5, o.pontuacao * PESO_ESFORCO[o.esforco]);
  const vals = itens.map(imp), max = Math.max(...vals), min = Math.min(...vals) * 0.7;
  const yDe = (v: number) => y0 + 6 + (max === min ? 0.5 : 1 - Math.log(v / min) / Math.log(max / min)) * (h - 12);
  f.tracar(COR.linha, 0.3);
  f.pdf.line(x0, y0 + h, x0 + w, y0 + h); f.pdf.line(x0, y0, x0, y0 + h);
  (["P", "M", "G"] as const).forEach((e, i) => {
    if (i) { f.tracar(COR.linha, 0.2); f.pdf.line(x0 + (i * w) / 3, y0, x0 + (i * w) / 3, y0 + h); }
    f.centro(t(`Esforço ${letraEsforco(e)}`, `Effort ${letraEsforco(e)}`), x0 + ((i + 0.5) * w) / 3, y0 + h + 5, { tam: 8, cor: COR.sub });
  });
  f.fonte({ tam: 8, cor: COR.sub }); f.pdf.text(latin1(t("impacto", "impact")), M, y0 + 4);
  const porCol: Record<string, number> = {};
  itens.forEach((o, i) => {
    const col = { P: 0, M: 1, G: 2 }[o.esforco], k = (porCol[o.esforco] = (porCol[o.esforco] ?? 0) + 1);
    const cx = x0 + ((col + 0.5) * w) / 3 + (k % 2 ? 1 : -1) * Math.ceil((k - 1) / 2) * 9, cy = yDe(imp(o));
    f.preencher(o.tom === "grave" ? COR.erroF : COR.avisoF); f.pdf.circle(cx, cy, 3.6, "F");
    f.centro(String(i + 1), cx, cy + 1.2, { tam: 8.5, estilo: "bold", cor: o.tom === "grave" ? COR.erro : COR.aviso });
  });
  f.y = y0 + H + 2;
}

/** Campos do dossiê de evidências (lib/llmPacote.ts, lib/dossie.ts) e a regra de privacidade de cada um. */
const camposDossie = (): [string, string, string][] => [
  ["id, titulo, tipo, canal", t("a oportunidade como a tela mostra e o tipo (falha de backend, página lenta, JavaScript, mobile)", "the opportunity as shown on screen and its type (backend failure, slow page, JavaScript, mobile)"), t("sem dado pessoal", "no personal data")],
  ["o_que_a_tela_mostra", t("impacto, evidência, ação sugerida e os números do motor de regras", "impact, evidence, suggested action and the rules engine numbers"), t("os textos da tela, mascarados", "the screen texts, masked")],
  ["negocio", t("sessões por dia, passo do fluxo e conversão com e sem o erro, jornadas, novas tentativas por sessão", "sessions per day, flow step and conversion with and without the error, journeys, retries per session"), t("contagens agregadas", "aggregated counts")],
  ["backend", t("cadeia de serviços, serviço de origem, exceção e mensagem com arquivo e linha, tempo por salto, banco e chamadas externas", "service chain, origin service, exception and message with file and line, time per hop, database and external calls"), t("sem trace id; mensagem e pilha mascaradas", "no trace id; message and stack masked")],
  ["por_estado, saude_metricas", t("falha e lentidão por estado; CPU e memória dos hosts dos traces", "failure and slowness by state; CPU and memory of the trace hosts"), t("região só por estado; host pelo nome", "region only by state; host by name")],
  ["inicio_do_problema, mudancas, davis", t("48 h de chamadas e erros em blocos de 6 h; deploys e configuração; problemas do Davis com a causa apontada", "48 h of calls and errors in 6 h blocks; deployments and configuration; Davis problems with the root cause"), t("sem dado pessoal", "no personal data")],
  ["frontend, mobile", t("o que segura o LCP; erros de JavaScript com a pilha; falhas, crash e ANR do app por versão, rede e sistema", "what holds the LCP; JavaScript errors with the stack; app failures, crash and ANR by version, network and system"), t("pilha mascarada, sem URL completa", "masked stack, no full URL")],
];

/** Gera e baixa o relatório; se o navegador não deixar baixar daqui, abre numa aba nova (como lib/assistPdf.ts). */
export function baixarRelatorio(d: DadosRelatorio): void {
  const url = URL.createObjectURL(new Blob([gerarRelatorioPdf(d) as BlobPart], { type: "application/pdf" }));
  const nome = `oportunidades-${d.escopo.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "escopo"}-${new Date(d.geradoEm).toISOString().slice(0, 16).replace(/[-:T]/g, "")}.pdf`;
  try {
    const a = document.createElement("a");
    a.href = url; a.download = nome; a.rel = "noopener";
    document.body.appendChild(a); a.click(); a.remove();
  } catch { window.open(url, "_blank", "noopener"); }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/* ---- PDF da análise por LLM (janela "Analisar com LLM") ------------------------------------------------- */
export interface DadosAnalisePdf {
  resultado: ResultadoLlm;
  escopo: string;
  /** período dos dados da análise */
  periodo: string;
  geradoEm: number;
  geradoPor?: string | null;
}
const CONF_TXT = (c: Confianca) => ({ alta: t("alta", "high"), media: t("média", "medium"), baixa: t("baixa", "low") })[c];
const CONF_COR = (c: Confianca): Cor => (c === "alta" ? [27, 120, 60] : c === "media" ? COR.aviso : COR.erro);
const ESF_TXT = (e: Esforco) => `${letraEsforco(e)} (${textoEsforco(e)})`;
const nOp = (id: string) => /^o(\d+)$/.exec(id)?.[1] ?? id;
const rotOps = (ids: string[]) => `${ids.length === 1 ? t("oportunidade", "opportunity") : t("oportunidades", "opportunities")} ${ids.map(nOp).join(", ")}`;

/** O PDF da análise: resumo estrutural no topo (causas comuns, prioridade, ondas, iniciativas recomendadas) e cada
    oportunidade em Problema x Causa x Solução x Benefício, com a cadeia de evidências e as hipóteses. */
export function gerarAnaliseLlmPdf(d: DadosAnalisePdf): Uint8Array {
  const f = new Folha();
  const r = d.resultado, s = r.sintese, ops = r.oportunidades;
  f.pdf.setProperties({ title: latin1(t("Análise por LLM", "LLM analysis")), creator: "Digital Experience Flow" });
  const quando = new Date(d.geradoEm);
  // cabeçalho
  f.y = 20;
  f.bloco(t("ANÁLISE ESTRUTURAL · GERADA PELO DIGITAL EXPERIENCE FLOW", "STRUCTURAL ANALYSIS · GENERATED BY DIGITAL EXPERIENCE FLOW"), { tam: 8.5, cor: COR.sub, depois: 4 });
  const yT = f.y;
  f.bloco(t("Análise por LLM: causa raiz e plano", "LLM analysis: root cause and plan"), { tam: 20, estilo: "bold", x: M + 5, depois: 3 });
  f.preencher(COR.marca); f.pdf.rect(M, yT + 1, 1.4, f.y - yT - 4, "F");
  const col = r.contexto?.coleta;
  const mb = (b: number) => (b / 1024 ** 2).toLocaleString(loc(), { maximumFractionDigits: 1 });
  const reais = (v: number) => (v < 0.0001 ? t("menos de R$ 0,0001", "less than R$ 0.0001") : `R$ ${dec(v, v < 0.01 ? 4 : 2)}`);
  const linhas = [
    `${m(d.escopo)} · ${t("dados de", "data from")} ${m(d.periodo)}`,
    t(`${ops.length === 1 ? "1 oportunidade analisada" : `${ops.length} oportunidades analisadas`} (${r.estado.prontas === 1 ? "1 pronta" : `${r.estado.prontas} prontas`}${r.estado.falhas ? `, ${r.estado.falhas} com falha` : ""}) · ${m(r.motor.nome)}, modelo ${m(r.motor.modelo)}`,
      `${ops.length === 1 ? "1 opportunity analyzed" : `${ops.length} opportunities analyzed`} (${r.estado.prontas} ready${r.estado.falhas ? `, ${r.estado.falhas} failed` : ""}) · ${m(r.motor.nome)}, model ${m(r.motor.modelo)}`),
    ...(col ? [t(`Evidências lidas no ambiente: ${int(col.consultas)} consultas, ${mb(col.bytes)} MB no Grail (${reais(col.custoRs)} pelo preço de consulta em uso)`, `Evidence read in the environment: ${int(col.consultas)} queries, ${mb(col.bytes)} MB in Grail (${reais(col.custoRs)} at the query price in use)`)] : []),
    t(`Gerado${d.geradoPor ? ` para ${m(d.geradoPor)}` : ""} em ${quando.toLocaleString(loc())}`, `Generated${d.geradoPor ? ` for ${m(d.geradoPor)}` : ""} on ${quando.toLocaleString(loc())}`),
  ];
  for (const l of linhas) f.bloco(l, { tam: 9, cor: COR.sub, x: M + 5, depois: 0.8 });
  f.y += 4;

  // resumo estrutural
  f.titulo(t("Resumo estrutural", "Structural summary"));
  if (!s) f.bloco(t("A síntese ainda não está pronta: as oportunidades abaixo já valem.", "The synthesis is not ready yet: the opportunities below already stand."), { cor: COR.sub });
  else {
    const ls = f.partir(m(s.resumoExecutivo), LARG - 10, { tam: 9.5 }), h = ls.length * f.lh(9.5) + 6;
    f.quebra(h);
    f.caixa(M, f.y, LARG, h, COR.caixa, null); f.preencher(COR.marca); f.pdf.rect(M, f.y, 1, h, "F");
    ls.forEach((l, j) => { f.fonte({ tam: 9.5 }); f.pdf.text(l, M + 5, f.y + 4.5 + j * f.lh(9.5)); });
    f.y += h + 4;
    if (s.causasComuns.length) {
      f.titulo(t("Causas estruturais comuns", "Common structural causes"), 2);
      tabela(f, [{ titulo: t("Causa estrutural", "Structural cause"), larg: 52 }, { titulo: t("Oport.", "Opp."), larg: 14, centro: true }, { titulo: t("Mudança única que resolve", "Single change that solves it"), larg: 62 }, { titulo: t("Sessões por mês", "Sessions per month"), larg: 22, centro: true }, { titulo: t("Confiança", "Confidence"), larg: 32 }],
        s.causasComuns.map((c) => [{ s: m(c.causa), estilo: "bold", extra: c.evidencias.length ? { s: m(`${t("Liga", "Links")}: ${c.evidencias.join("; ")}`) } : undefined }, c.oportunidades.map(nOp).join(", "), { s: m(c.mudancaEstrutural), extra: c.oQueSepara ? { s: m(`${t("Separa", "Separates")}: ${c.oQueSepara}`) } : undefined },
          c.beneficioSessoesMes != null ? int(c.beneficioSessoesMes) : "-", { s: CONF_TXT(c.confianca), estilo: "bold", cor: CONF_COR(c.confianca) }]));
    }
    if (s.priorizacao.length) {
      f.titulo(t("Prioridade", "Priority"), 2);
      tabela(f, [{ titulo: "", larg: 7 }, { titulo: t("Oportunidade", "Opportunity"), larg: 58 }, { titulo: t("Esforço", "Effort"), larg: 16, centro: true }, { titulo: t("Sessões por mês", "Sessions per month"), larg: 22, centro: true }, { titulo: t("Por quê", "Why"), larg: 79 }],
        s.priorizacao.map((p) => { const o = ops.find((x) => x.id === p.id); const res = o?.resultado; return [{ s: String(p.ordem), estilo: "bold" }, { s: m(`${nOp(p.id)}. ${o?.titulo ?? p.id}`), estilo: "bold" }, res ? letraEsforco(res.esforco.nivel) : "-", res?.beneficio.sessoesRecuperadasMes != null ? int(res.beneficio.sessoesRecuperadasMes) : "-", { s: m(p.razao), cor: COR.sub }]; }));
    }
    if (s.ondas.length) {
      f.titulo(t("Plano em ondas", "Plan in waves"), 2);
      for (const onda of ["30", "60", "90"] as const) for (const w of s.ondas.filter((x) => x.onda === onda)) {
        const partes = [{ s: m(w.objetivo), b: true }, ...w.acoes.map((a) => ({ s: `- ${m(a)}`, b: false })), ...(w.indicadorDef ? [{ s: m(`${t("Prova no DEF", "Proof in DEF")}: ${w.indicadorDef}`), b: false }] : [])]
          .map((x) => ({ ...x, ls: f.partir(x.s, LARG - 10, { tam: x.b ? 9 : 8.5, estilo: x.b ? "bold" : "normal" }) }));
        const h = 9 + partes.reduce((acc, x) => acc + x.ls.length * f.lh(x.b ? 9 : 8.5) + 0.6, 0);
        f.quebra(h);
        const y0 = f.y;
        f.caixa(M, y0, LARG, h, null);
        f.fonte({ tam: 10, estilo: "bold" }); f.pdf.text(latin1(`${onda} ${t("dias", "days")}${w.oportunidades.length ? ` · ${rotOps(w.oportunidades)}` : ""}`), M + 4, y0 + 5.5);
        let yy = y0 + 9.5;
        for (const x of partes) { for (const l of x.ls) { f.fonte({ tam: x.b ? 9 : 8.5, estilo: x.b ? "bold" : "normal", cor: x.b ? COR.texto : COR.sub }); f.pdf.text(l, M + 5, yy); yy += f.lh(x.b ? 9 : 8.5); } yy += 0.6; }
        f.y = y0 + h + 3;
      }
    }
    if (s.iniciativasRecomendadas.length) {
      f.titulo(t("Iniciativas recomendadas", "Recommended initiatives"), 2);
      for (const a of s.iniciativasRecomendadas) f.bloco(m(`${a.nomeServico}${a.oportunidades.length ? ` (${rotOps(a.oportunidades)})` : ""}: ${a.comoAjuda}`), { tam: 9, x: M + 2, depois: 1.2 });
      f.bloco(t("Iniciativas sugeridas pela análise; ajuste ao seu contexto.", "Initiatives suggested by the analysis; adjust them to your context."), { tam: 8, cor: COR.sub });
    }
    if (s.oQueFaltaMedir.length) { f.titulo(t("O que falta medir", "What is still to be measured"), 2); for (const x of s.oQueFaltaMedir) f.bloco(m(`- ${x}`), { tam: 8.8, x: M + 2, depois: 0.8 }); }
  }

  // oportunidades
  for (const o of ops) {
    f.nova();
    f.titulo(m(`${nOp(o.id)}. ${o.titulo}`));
    if (o.estado !== "ok" || !o.resultado) { f.bloco(o.estado === "erro" ? m(t(`Não foi analisada: ${o.erro?.mensagem ?? "erro"}`, `Not analyzed: ${o.erro?.mensagem ?? "error"}`)) : t("Em análise.", "Being analyzed."), { cor: COR.sub }); continue; }
    const x = o.resultado, c = x.causaRaiz, b = x.beneficio;
    f.bloco(`${t("Confiança", "Confidence")} ${CONF_TXT(c.confianca)} · ${t("Esforço", "Effort")} ${ESF_TXT(x.esforco.nivel)} · ${m(o.aplicacoes.join(", "))}`, { tam: 8.5, cor: COR.sub, depois: 2 });
    const beneficio = [
      b.sessoesRecuperadasMes != null ? t(`${int(b.sessoesRecuperadasMes)} sessões recuperadas por mês`, `${int(b.sessoesRecuperadasMes)} sessions recovered per month`) : t("Sem medida para recuperar sessões.", "No measure to recover sessions."),
      b.sessoesAfetadasDia != null ? t(`${int(b.sessoesAfetadasDia)} sessões afetadas por dia`, `${int(b.sessoesAfetadasDia)} affected sessions per day`) : "",
      b.conversaoAtualPct != null && b.conversaoEsperadaPct != null ? t(`conversão de ${dec(b.conversaoAtualPct, 1)}% para ${dec(b.conversaoEsperadaPct, 1)}%`, `conversion from ${dec(b.conversaoAtualPct, 1)}% to ${dec(b.conversaoEsperadaPct, 1)}%`) : "",
    ].filter(Boolean).join(" · ");
    tabela(f, [{ titulo: "", larg: 30 }, { titulo: "", larg: LARG - 30 }], [
      [{ s: t("Problema", "Problem"), estilo: "bold" }, { s: m(x.problema.resumo), extra: x.problema.numerosChave.length ? { s: m(x.problema.numerosChave.join(" · ")) } : undefined }],
      [{ s: t("Causa raiz", "Root cause"), estilo: "bold", cor: COR.erro }, { s: m(c.afirmacao), estilo: "bold", extra: { s: m(`${t("Causa estrutural", "Structural cause")}: ${c.causaEstrutural}`), cor: COR.texto } }],
      [{ s: t("Solução", "Solution"), estilo: "bold" }, { s: m(`${t("Rápida", "Quick")}: ${x.solucao.rapida.map((a) => `${a.acao} (${a.onde}; ${a.prazo})`).join("; ") || "-"}`), extra: { s: m(`${t("Estrutural", "Structural")}: ${x.solucao.estrutural.map((a) => `${a.acao} [${a.camada}]: ${a.detalhe}`).join("; ") || "-"}`), cor: COR.texto } }],
      [{ s: t("Benefício", "Benefit"), estilo: "bold" }, { s: m(beneficio), estilo: "bold", extra: { s: m([b.conta, b.premissas.length ? `${t("Premissas", "Assumptions")}: ${b.premissas.join("; ")}` : "", b.naoMedido ? `${t("Não medido", "Not measured")}: ${b.naoMedido}` : ""].filter(Boolean).map((x) => x.replace(/[.\s]+$/, "")).join(". ") + ".") } }],
    ], { tam: 8.8 });
    if (c.cadeia.length) { f.titulo(t("Cadeia de evidências", "Evidence chain"), 2); c.cadeia.forEach((e, k) => f.bloco(m(`${k + 1}. ${e.evidencia}${e.prova ? `: ${e.prova}` : ""}${e.fonte ? ` (${e.fonte})` : ""}`), { tam: 8.6, x: M + 2, depois: 0.8 })); f.bloco(m(`${t("Por que essa confiança", "Why this confidence")}: ${c.justificativa}`), { tam: 8.2, cor: COR.sub }); }
    if (c.descartadas.length) { f.titulo(t("Hipóteses descartadas", "Ruled-out hypotheses"), 2); for (const h of c.descartadas) f.bloco(m(`- ${h.hipotese}: ${h.porQue}`), { tam: 8.6, x: M + 2, depois: 0.6 }); }
    if (c.emAberto.length) { f.titulo(t("Em aberto e como confirmar", "Open and how to confirm"), 2); for (const h of c.emAberto) f.bloco(m(`- ${h.hipotese}: ${h.comoConfirmar}`), { tam: 8.6, x: M + 2, depois: 0.6 }); }
    f.titulo(t("Como provar o ganho no DEF", "How to prove the gain in DEF"), 2);
    f.bloco(m(`${x.validacao.indicadorDef}. ${t("Hoje", "Today")}: ${x.validacao.linhaDeBase}. ${t("Meta", "Target")}: ${x.validacao.meta}. ${x.validacao.comoMedir}`), { tam: 8.6, x: M + 2 });
    f.bloco(m(`${t("Esforço", "Effort")} ${ESF_TXT(x.esforco.nivel)}: ${x.esforco.justificativa}${x.riscos.length ? ` ${t("Riscos", "Risks")}: ${x.riscos.join("; ")}` : ""}`), { tam: 8.4, cor: COR.sub });
  }

  // rodapé
  const n = f.pdf.getNumberOfPages();
  for (let p = 1; p <= n; p++) {
    f.pdf.setPage(p);
    f.preencher(COR.marca); f.pdf.rect(M, A4.a - 12.4, 6, 0.8, "F");
    f.tracar(COR.linha, 0.2); f.pdf.line(M + 7, A4.a - 12, M + LARG, A4.a - 12);
    f.fonte({ tam: 7.5, cor: COR.sub });
    f.pdf.text(latin1(t("Análise por LLM feita com IA a partir dos dossiês de evidências do DEF. Confira antes de agir.", "LLM analysis made with AI from DEF evidence dossiers. Verify before acting.")), M, A4.a - 8);
    f.pdf.text(latin1(t(`página ${p} de ${n}`, `page ${p} of ${n}`)), M + LARG, A4.a - 8, { align: "right" });
  }
  return f.pdf.bytes();
}
/** Gera e baixa o PDF da análise (ou abre numa aba nova, se o navegador não deixar baixar daqui). */
export function baixarAnaliseLlm(d: DadosAnalisePdf): void {
  const url = URL.createObjectURL(new Blob([gerarAnaliseLlmPdf(d) as BlobPart], { type: "application/pdf" }));
  const nome = `analise-llm-${new Date(d.geradoEm).toISOString().slice(0, 16).replace(/[-:T]/g, "")}.pdf`;
  try {
    const a = document.createElement("a");
    a.href = url; a.download = nome; a.rel = "noopener";
    document.body.appendChild(a); a.click(); a.remove();
  } catch { window.open(url, "_blank", "noopener"); }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
