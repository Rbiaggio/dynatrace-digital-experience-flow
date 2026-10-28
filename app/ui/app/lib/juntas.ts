/* Consultas juntadas (etapa 4 do plano de DPS): quando juntar (guarda de tamanho), o plano B por transbordo e os funis
   de todas as jornadas em lotes. Cada plano monta TODOS os textos na hora em que é criado (com o filtro de segmento, a
   cópia e os frames de agora, como a chave do cache compartilhado) e lê depois: a consulta juntada e, para a parte que
   transbordar, a consulta de hoje. A saída é a das consultas de hoje (as mesmas linhas, com os mesmos campos): as telas
   montam igual. Os textos e a separação ficam em queries.ts (qInicioA, separarInicioA...). */
import { dql, estimarVarreduraDe, type Contexto, type OpcoesDql,
         qInicioFins, qInicioPaginas, qInicioCaminhos, qInicioErros, LIMITE_LUGARES, qInicioA, separarInicioA, LIMITE_INI_A, qInicioB, separarInicioB, LIMITE_INI_B, LIMITE_INI_B_RETRATO,
         qQualidadeDado, qDominiosSemTrace, qQualidadeJunta, separarQualidade, LIMITE_QUA_U,
         qRequisicoes, qErros, qPainelJunto, separarPainel, LIMITE_PAG_U,
         qFluxoDoNo, qSessoesDoNo, qIsolarJunto, separarIsolar, LIMITE_ISO_U,
         qAbandonoCorrelacao, qAbandonoSessoes, qPorqueJunto, separarPorque, LIMITE_DRL_U,
         qAplicacoes, qArestas, qViews, qErrosPorView, qBaseJunta, separarBase, LIMITE_BAS_S,
         qFunil, qFunisJuntos, lotesFunis, linhasDosFunis, type PassoQ, type Linhas } from "./dql";
import type { LinhaChamadaEstado, LinhaTerceiro } from "./oportunidades";

export type Executor = (q: string, op: OpcoesDql) => Promise<Linhas>;

/** Guarda: junta só se uma varredura da cópia com a janela e os buckets DA CONSULTA juntada for de até 150 GiB (estimativa
    pelo que a aba já mediu, lib/dql.ts estimarVarreduraDe, pelo fetch do começo do texto). Acima disso a consulta juntada,
    mais lenta que cada uma das de hoje, pode passar do tempo máximo da consulta: ficam as de hoje. Sem estimativa nenhuma:
    junta. Decide consulta a consulta, na hora de ler: a qualidade (3 buckets) pode separar e a Visão geral (navegação +
    erro) juntar na mesma janela. */
export const LIMITE_JUNTAR_BYTES = 150 * 2 ** 30;
export const podeJuntar = (consulta: string) => { const e = estimarVarreduraDe(consulta); return e == null || e <= LIMITE_JUNTAR_BYTES; };

/** A consulta de hoje de uma parte (texto montado no plano, contexto e maxRecords de hoje). */
interface Hoje { q: string; contexto: Contexto; max?: number }
const ler = (ex: Executor, h: Hoje) => ex(h.q, { contexto: h.contexto, maxRecords: h.max });

/** INI-B (páginas + erros da Visão geral numa leitura), LIGADA: além de ler uma vez, corrige uma contagem dupla da
    qInicioErros antiga, que às vezes devolvia o mesmo erro em mais de uma linha (o Grail divide o grupo quando a mensagem é
    substring de "", o caso das chamadas ao servidor) e a Visão geral somava as sessões das linhas, contando duas vezes a
    sessão que aparecia nas duas. A INI-B devolve uma linha, com as sessões distintas. No LAB (17/10) o cartão do erro de
    servidor de um app mobile passou a contar as sessões afetadas certas. false volta às consultas separadas
    (INI-A + INI-02 + INI-04 + INI-05). */
export const JUNTAR_ERROS_INICIO = true;

/** Visão geral (fins, páginas e lugares, caminhos e erros): as linhas de INI-01 a INI-04. A série (INI-05) segue à parte. */
export function planoInicio(app: string, janela: string, robos: boolean, retrato = false) {
  const fins: Hoje = { q: qInicioFins(app, janela, robos), contexto: "inicio/INI-01", max: 4000 };
  const paginas: Hoje = { q: qInicioPaginas(app, janela, robos), contexto: "inicio/INI-02", max: 4000 + LIMITE_LUGARES };
  const caminhos: Hoje = { q: qInicioCaminhos(app, janela, robos), contexto: "inicio/INI-03", max: 2000 };
  const erros: Hoje = { q: qInicioErros(app, janela, robos), contexto: "inicio/INI-04", max: 300 };
  const a = qInicioA(app, janela, robos), b = JUNTAR_ERROS_INICIO ? qInicioB(app, janela, robos, retrato) : null;
  return async (ex: Executor = dql) => {
    const juntaA = podeJuntar(a), juntaB = !!b && podeJuntar(b);
    if (!juntaA && !juntaB) { const [f, p, c, e] = await Promise.all([ler(ex, fins), ler(ex, paginas), ler(ex, caminhos), ler(ex, erros)]); return { f, p, c, e }; }
    const [A, B] = await Promise.all([
      juntaA ? ex(a, { contexto: "inicio/INI-A", maxRecords: LIMITE_INI_A }).then(separarInicioA)
        : Promise.all([ler(ex, fins), ler(ex, caminhos)]).then(([f, c]) => ({ fins: f as Linhas | null, caminhos: c as Linhas | null })),
      b && juntaB ? ex(b, { contexto: "inicio/INI-B", maxRecords: retrato ? LIMITE_INI_B_RETRATO : LIMITE_INI_B }).then((ls) => separarInicioB(ls, retrato))
        : Promise.all([ler(ex, paginas), ler(ex, erros)]).then(([p, e]) => ({ paginas: p as Linhas | null, erros: e as Linhas | null })),
    ]);
    // transbordo (um grupo passou do limite da consulta de hoje): só aquela parte relê pela consulta de hoje
    const [f, c, p, e] = await Promise.all([A.fins ?? ler(ex, fins), A.caminhos ?? ler(ex, caminhos), B.paginas ?? ler(ex, paginas), B.erros ?? ler(ex, erros)]);
    return { f, p, c, e };
  };
}

/** Qualidade do dado: as linhas de QUA-01 e QUA-02 e, da mesma leitura (QUA-U), as entradas das Oportunidades de melhoria:
    chamadas por endpoint e estado (LinhaChamadaEstado) e terceiros (LinhaTerceiro). Sem a junção (acima da guarda) ou com
    o grupo cortado no limite, chamadas e terceiros vêm null: as regras que dependem deles ficam "sem dado"
    (lib/oportunidades.ts) e nada é lido a mais por elas. */
export type ResultadoQualidade = [Linhas, Linhas, LinhaChamadaEstado[] | null, LinhaTerceiro[] | null];
export function planoQualidade(app: string, janela: string, robos: boolean) {
  const h1: Hoje = { q: qQualidadeDado(app, janela, robos), contexto: "qualidade/QUA-01", max: 500 }, h2: Hoje = { q: qDominiosSemTrace(app, janela, robos), contexto: "qualidade/QUA-02", max: 500 };
  const j = qQualidadeJunta(app, janela, robos);
  return async (ex: Executor = dql): Promise<ResultadoQualidade> => {
    if (!podeJuntar(j)) { const [q, d] = await Promise.all([ler(ex, h1), ler(ex, h2)]); return [q, d, null, null]; }
    const s = separarQualidade(await ex(j, { contexto: "qualidade/QUA-U", maxRecords: LIMITE_QUA_U }));
    const [q, d] = await Promise.all([s.qualidade ?? ler(ex, h1), s.dominios ?? ler(ex, h2)]);
    return [q, d, s.chamadas, s.terceiros];
  };
}

/** Painel da página: as linhas de PAG-02 (requisições) e PAG-03 (erros). */
export function planoPainel(app: string, janela: string, robos: boolean, view: string) {
  const h1: Hoje = { q: qRequisicoes(app, janela, robos, view), contexto: "painel/PAG-02" }, h2: Hoje = { q: qErros(app, janela, robos, view), contexto: "painel/PAG-03" };
  const j = qPainelJunto(app, janela, robos, view);
  return async (ex: Executor = dql): Promise<[Linhas, Linhas]> => {
    if (!podeJuntar(j)) return Promise.all([ler(ex, h1), ler(ex, h2)]);
    const s = separarPainel(await ex(j, { contexto: "painel/PAG-U", maxRecords: LIMITE_PAG_U }));
    return Promise.all([s.requisicoes ?? ler(ex, h1), s.erros ?? ler(ex, h2)]);
  };
}

/** Isolar: as linhas de ISO-01 (ligações das sessões que passaram pela página) e ISO-02 (quantas passaram). */
export function planoIsolar(app: string, view: string, janela: string, robos: boolean) {
  const h1: Hoje = { q: qFluxoDoNo(app, view, janela, robos), contexto: "isolar/ISO-01", max: 4000 }, h2: Hoje = { q: qSessoesDoNo(app, view, janela, robos), contexto: "isolar/ISO-02", max: 5 };
  const j = qIsolarJunto(app, view, janela, robos);
  return async (ex: Executor = dql): Promise<[Linhas, Linhas]> => {
    if (!podeJuntar(j)) return Promise.all([ler(ex, h1), ler(ex, h2)]);
    const s = separarIsolar(await ex(j, { contexto: "isolar/ISO-U", maxRecords: LIMITE_ISO_U }));
    return Promise.all([s.arestas ?? ler(ex, h1), s.sessoes ?? ler(ex, h2)]);
  };
}

/** "Por quê?": as linhas de DRL-01 (quem seguiu e quem não) e DRL-03 (as sessões que não seguiram). */
export function planoPorque(passos: PassoQ[], k: number, janela: string, robos: boolean) {
  const h1: Hoje = { q: qAbandonoCorrelacao(passos, k, janela, robos), contexto: "porque/DRL-01", max: 10 }, h2: Hoje = { q: qAbandonoSessoes(passos, k, janela, robos), contexto: "porque/DRL-03", max: 50 };
  const j = qPorqueJunto(passos, k, janela, robos);
  return async (ex: Executor = dql): Promise<[Linhas, Linhas]> => {
    if (!podeJuntar(j)) return Promise.all([ler(ex, h1), ler(ex, h2)]);
    const s = separarPorque(await ex(j, { contexto: "porque/DRL-U", maxRecords: LIMITE_DRL_U }));
    return Promise.all([s.correlacao ?? ler(ex, h1), s.sessoes ?? ler(ex, h2)]);
  };
}

/** Base do grafo pela cópia (com filtro de segmento): as linhas de BAS-05 a BAS-08. Chamar só com a cópia e o filtro ligados
    (é quando base() e qViews leem a cópia); sem eles a base lê as métricas ou o user.events, como hoje. */
export function planoBaseCopia(app: string, janela: string, robos: boolean) {
  const hA: Hoje = { q: qAplicacoes(janela), contexto: "base/BAS-05" }, hR: Hoje = { q: qArestas(app, janela, robos), contexto: "base/BAS-06", max: 4000 };
  const hV: Hoje = { q: qViews(app, janela, robos), contexto: "base/BAS-07", max: 4000 }, hE: Hoje = { q: qErrosPorView(app, janela, robos), contexto: "base/BAS-08", max: 4000 };
  const j = qBaseJunta(app, janela, robos);
  return async (ex: Executor = dql): Promise<[Linhas, Linhas, Linhas, Linhas]> => {
    if (!podeJuntar(j)) return Promise.all([ler(ex, hA), ler(ex, hR), ler(ex, hV), ler(ex, hE)]);
    const s = separarBase(await ex(j, { contexto: "base/BAS-S", maxRecords: LIMITE_BAS_S }));
    return Promise.all([s.aplicacoes ?? ler(ex, hA), s.arestas ?? ler(ex, hR), s.views ?? ler(ex, hV), s.erros ?? ler(ex, hE)]);
  };
}

/** O DQL recusou o texto pelo tamanho (limite de expressões): não leu nada, então o lote se divide sem custo. */
export const recusadaPeloTamanho = (e: unknown) => /TOO_MANY_EXPRESSIONS|EXPRESSION_TOO_|DQL-LIMIT-REACHED/.test(e instanceof Error ? e.message : String(e));

export interface ResultadoFunis {
  /** a linha de cada jornada no formato de qFunil (null = a leitura dela falhou ou não foi feita) */
  linhas: (Record<string, unknown> | null)[];
  falhas: (string | null)[];
  /** acima da guarda, quem pediu saiu do escopo no meio: o pacote ficou incompleto (não vai ao cache compartilhado) */
  parou?: boolean;
}
/** Funis de todas as jornadas: FUN-T em lotes (lotesFunis); abaixo da guarda, a jornada que sozinha não cabe num FUN-T e
    o lote que o DQL recusar pelo tamanho leem pela qFunil, uma jornada por vez, como hoje. aoParcial entrega cada funil
    quando chega (lote a lote, ou um a um). Acima da guarda (uma jornada por vez, que num ambiente grande pode levar muitos minutos
    nas janelas de 6 h, 24 h e 7 d), o pacote para quando quem pediu sai do escopo (op.desistir: outro período, outro
    filtro, outra lista de jornadas): não começa a próxima jornada e marca parou, para o pacote incompleto não ir ao
    cache. A guarda decide pelo texto do FUN-T (os buckets dele). */
export function planoFunis(jornadas: PassoQ[][], janela: string, robos: boolean) {
  const unico = jornadas.map((ps) => qFunil(ps, janela, robos));
  const { lotes, fora } = lotesFunis(jornadas, janela, robos);
  const textos = lotes.map((l) => qFunisJuntos(l.map((i) => jornadas[i]), janela, robos));
  return async (op: { aoParcial?: (i: number, linha: Record<string, unknown>, desde: number) => void; aoFalhar?: (i: number, msg: string) => void; desistir?: () => boolean } = {}, ex: Executor = dql): Promise<ResultadoFunis> => {
    const r: ResultadoFunis = { linhas: jornadas.map(() => null), falhas: jornadas.map(() => null) };
    const falhou = (i: number, e: unknown) => { const msg = e instanceof Error ? e.message : String(e); r.falhas[i] = msg; op.aoFalhar?.(i, msg); };
    const umaAUma = async (ids: number[], paraAoSair = false) => {
      for (const i of ids) {
        if (paraAoSair && op.desistir?.()) { r.parou = true; return; }
        const desde = Date.now();
        try { const l = await ex(unico[i], { contexto: "funil/FUN-01", maxRecords: 10 }); r.linhas[i] = l[0] ?? {}; op.aoParcial?.(i, r.linhas[i]!, desde); }
        catch (e) { falhou(i, e); }
      }
    };
    if (textos.length && !podeJuntar(textos[0])) { await umaAUma(jornadas.map((_, i) => i), true); return r; }
    for (const [n, lote] of lotes.entries()) {
      const desde = Date.now();
      try {
        const l = await ex(textos[n], { contexto: "funil/FUN-T", maxRecords: 10 });
        const ls = linhasDosFunis(l[0], lote.map((i) => jornadas[i]));
        lote.forEach((i, x) => { r.linhas[i] = ls[x]; op.aoParcial?.(i, ls[x], desde); });
      } catch (e) {
        if (recusadaPeloTamanho(e)) await umaAUma(lote);
        else for (const i of lote) falhou(i, e);
      }
    }
    await umaAUma(fora);
    return r;
  };
}
