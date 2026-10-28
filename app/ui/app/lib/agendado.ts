/* PARTES AGENDADAS NO APP STATE (chaves rum-flow.agendado.v1.<parte>, sem cobrança). Gravadas pela ação def-agregar no
   workflow único (tarefa "ciclo", a cada 5 min; lib/workflows.ts, parteDaRodada escolhe a parte de cada rodada) e pela tela:
     ultimahora    · as sessões da última hora (lib/horaria.ts, qUltimaHora): indicadores de sessão por aplicação, lugares
                     do mapa e as até 300 sessões com erro mais recentes; parte "sessoes" do ciclo, a cada 15 min. Servem
                     até 20 min (VALIDADE_ULTIMA_HORA_MS); depois, a tela lê sob demanda (lib/horas.ts, lerUltimaHora).
     horas         · as horas já analisadas de cada parte da análise de hora em hora (parte "hora" do ciclo, a cada 15 min):
                     a tela sabe o que somar no bucket rum_flow_horas sem ler o bucket para isso; valem até 40 min.
     acesso-inicio · a marca de acesso: a tela grava ao abrir a Visão geral e de 5 em 5 min enquanto ela está visível
                     (marcarAcesso); a ação só lê as sessões da última hora se houve acesso nos últimos 20 min
                     (USO_RECENTE_INICIO_MS): fora do horário de uso, o custo é zero.
   Legado: as partes "inicio", "qualidade", "valores" e "funis" do tipo ParteAgendada e as peças do antigo retrato da
   Visão geral (inicioDoRetrato, ehEscopoAgendado, ehEscopoQualidadeAgendada, qualidadeDaAplicacao, LinhasRetrato,
   FunisAgendados, JANELA_AGENDADA, VALIDADE_AGENDADO_MS) não são mais gravadas nem lidas. inicioDasLinhas continua em uso:
   a tela monta a Visão geral por ele. A ligação página -> serviço vem da análise de hora em hora (lib/horaria.ts). */
import { stateClient } from "@dynatrace-sdk/client-state";
import { montarInicio, type Inicio, type LinhaSerie } from "./inicio";
import type { ExemploErro } from "./agregados";
import { num, texto, SEPARADOR_CAMINHO, linhasDaSerieErros, type Linhas } from "./dql";
import type { ResultadoQualidade } from "./juntas";

export const JANELA_AGENDADA = "30m";
export const INTERVALO_AGENDADO_MIN = 5;
/** Até quando o retrato serve (o intervalo do workflow + a leitura + folga): passou disto, a tela lê sob demanda. */
export const VALIDADE_AGENDADO_MS = (INTERVALO_AGENDADO_MIN + 4) * 60000;
export type ParteAgendada = "inicio" | "qualidade" | "valores" | "funis" | "acesso-inicio" | "ultimahora" | "horas";
/** As horas analisadas (tarefa "hora", a cada 15 min): valem até 40 min; mais velhas, a tela lê no Grail (H-00). */
export const VALIDADE_HORAS_MS = 40 * 60000;
/** As sessões da última hora (tarefa "sessoes" desde a 1.43, lib/horaria.ts): fins por aplicação e lugares do mapa. */
export interface UltimaHora { fins: Record<string, unknown>[]; lugares: Record<string, unknown>[]; sessoes?: Record<string, unknown>[] }
/** A ação só lê as sessões da última hora se a Visão geral esteve aberta (marcarAcesso) há no máximo isto. */
export const USO_RECENTE_INICIO_MS = 20 * 60000;
/** A qualidade do dado no retrato é relida a cada 15 min (bloco que muda devagar). */
export const INTERVALO_QUALIDADE_MS = 15 * 60000;
/** As sessões da última hora (tarefa a cada 15 min) servem até 20 min; depois, a tela lê sob demanda. */
export const VALIDADE_ULTIMA_HORA_MS = 20 * 60000;
/** De quanto em quanto a tela marca que a Visão geral está aberta e visível. */
export const INTERVALO_ACESSO_MS = 5 * 60000;
const PREFIXO = "rum-flow.agendado.v1.";
/** Teto por valor no App State (10 MB por valor): acima disso a parte não é gravada e a tela lê sob demanda. */
const LIMITE_CHARS = 9_000_000;
export interface Agendado<T> { t: number; d: T }
/** As linhas da Visão geral no retrato (planoInicio na variante do retrato + a série), para montar qualquer aplicação. */
export interface LinhasRetrato { f: Linhas; p: Linhas; c: Linhas; e: Linhas; se: Linhas }
/** Funis: a lista de passos das jornadas que o retrato leu (a tela só usa se for a mesma) e a linha de cada uma. */
export interface FunisAgendados { chave: string; linhas: (Record<string, unknown> | null)[] }

/** O escopo do retrato da Visão geral e dos funis: qualquer aplicação (as linhas são por aplicação), 30 min, sem robôs,
    sem frames e sem filtro de segmento. */
export const ehEscopoAgendado = (_app: string, janela: string, robos: boolean, quadros: boolean, chaveSegmento: string) =>
  janela === JANELA_AGENDADA && !robos && !quadros && chaveSegmento === "-";
/** A Visão geral de uma aplicação (ou de todas) a partir das linhas do retrato: as linhas da aplicação e, no mapa, os
    lugares dela ("lugarapp", com as sessões e os tempos da aplicação). */
/** agora = quando o retrato foi lido (o período e as faixas da série contam dali). */
export function inicioDoRetrato(r: LinhasRetrato, app: string, janela: string, agora: number): Inicio {
  if (app === "*") return inicioDasLinhas({ f: r.f, p: r.p.filter((l) => texto(l.tipo) !== "lugarapp"), c: r.c, e: r.e }, r.se, janela, agora);
  const daApp = (ls: Linhas) => ls.filter((l) => texto(l.app) === app);
  const p = r.p.filter((l) => (texto(l.tipo) === "lugarapp" ? texto(l.app) === app : texto(l.tipo) !== "lugar" && texto(l.app) === app))
    .map((l) => (texto(l.tipo) === "lugarapp" ? { ...l, tipo: "lugar" } : l));
  return inicioDasLinhas({ f: daApp(r.f), p, c: daApp(r.c), e: daApp(r.e) }, daApp(r.se), janela, agora);
}
/** O escopo da qualidade do dado no retrato: qualquer aplicação (as linhas são por aplicação). */
export const ehEscopoQualidadeAgendada = (janela: string, robos: boolean, chaveSegmento: string) => janela === JANELA_AGENDADA && !robos && chaveSegmento === "-";
/** As linhas da qualidade só de uma aplicação (todas: como vieram). */
export function qualidadeDaAplicacao(r: ResultadoQualidade, app: string): ResultadoQualidade {
  if (app === "*") return r;
  const so = <T extends { app?: unknown }>(ls: T[] | null) => (ls ? ls.filter((l) => String(l.app ?? "") === app) : null);
  return [so(r[0]) ?? [], so(r[1]) ?? [], so(r[2]), so(r[3])];
}

/** O modelo da Visão geral a partir das linhas de planoInicio (f, p, c, e) e da série de erros (INI-05). A tela e a ação
    montam pelo mesmo caminho. */
export function inicioDasLinhas(r: { f: Linhas; p: Linhas; c: Linhas; e: Linhas }, se: Linhas, janela: string, agora = Date.now(), serieExtra: LinhaSerie[] = []): Inicio {
  const lista = (v: unknown) => (Array.isArray(v) ? v.filter((x) => x != null && x !== "").map(String) : []);
  // qInicioPaginas traz, na mesma varredura, as páginas (tipo "pagina") e os lugares do mapa (tipo "lugar")
  const pag = r.p.filter((l) => texto(l.tipo) !== "lugar"), lug = r.p.filter((l) => texto(l.tipo) === "lugar");
  return montarInicio({
    fins: r.f.map((l) => ({ app: texto(l.app) ?? "", fim: texto(l.fim), fins: num(l.fins), finsErro: num(l.fins_erro), uma: num(l.uma), comErro: num(l.com_erro), navs: num(l.navs) })),
    paginas: pag.map((l) => ({ app: texto(l.app) ?? "", view: texto(l.view), visitas: num(l.visitas), erros: num(l.erros), sessoes: num(l.sessoes), sessoesErro: num(l.sessoes_erro), mediaMs: l.media_ms == null ? null : num(l.media_ms), p75Ms: l.p75_ms == null ? null : num(l.p75_ms) })),
    caminhos: r.c.map((l) => ({ app: texto(l.app) ?? "", caminho: texto(l.caminho) ?? "", n: num(l.n), fimErro: num(l.fim_erro), erros: Array.isArray(l.erros) ? l.erros.map((x) => String(x ?? "")) : [] })),
    erros: r.e.map((l) => ({ app: texto(l.app) ?? "", tipo: texto(l.tipo) ?? "", status: texto(l.status), caminho: texto(l.caminho), dominio: texto(l.dominio), msg: texto(l.msg), n: num(l.n), sessoes: num(l.sessoes), paginas: Array.isArray(l.paginas) ? l.paginas.map((x) => String(x)) : [],
                             amostrasTrace: lista(l.amostra_t), amostrasSessao: lista(l.amostra_s), ultimo: texto(l.ultimo), exemplos: Array.isArray(l.exemplos) ? (l.exemplos as ExemploErro[]) : [] })),
    serie: [...linhasDaSerieErros(se), ...serieExtra],
    lugares: lug.map((l) => ({ pais: texto(l.pais) ?? "", regiao: texto(l.regiao) ?? "", visitas: num(l.visitas), erros: num(l.erros), sessoes: num(l.sessoes), sessoesErro: num(l.sessoes_erro),
                               mediaMs: l.media_ms == null ? null : num(l.media_ms), p75Ms: l.p75_ms == null ? null : num(l.p75_ms) })),
  }, SEPARADOR_CAMINHO, janela, agora);
}

/** A parte, se ainda vale (horas: VALIDADE_HORAS_MS; ultimahora: VALIDADE_ULTIMA_HORA_MS; null = não existe, venceu ou o
    App State falhou). */
export async function lerAgendado<T>(parte: ParteAgendada, agora = Date.now()): Promise<Agendado<T> | null> {
  try {
    const v = (await stateClient.getAppState({ key: PREFIXO + parte })).value;
    if (!v) return null;
    const e = JSON.parse(v) as { t?: unknown; d?: T };
    const validade = parte === "horas" ? VALIDADE_HORAS_MS : parte === "ultimahora" ? VALIDADE_ULTIMA_HORA_MS : parte === "qualidade" ? INTERVALO_QUALIDADE_MS + VALIDADE_AGENDADO_MS - INTERVALO_AGENDADO_MIN * 60000 : VALIDADE_AGENDADO_MS;
    return typeof e?.t === "number" && agora - e.t <= validade && e.d !== undefined ? { t: e.t, d: e.d } : null;
  } catch { return null; }
}
/** Quando a parte foi gravada (ms), sem conferir a validade (null = não existe). A ação decide por aqui se relê. */
export async function idadeAgendado(parte: ParteAgendada): Promise<number | null> {
  try {
    const v = (await stateClient.getAppState({ key: PREFIXO + parte })).value;
    const t = v ? (JSON.parse(v) as { t?: unknown }).t : null;
    return typeof t === "number" ? t : null;
  } catch { return null; }
}
let ultimoAcesso = 0;
/** A tela marca que a Visão geral está aberta: no máximo uma gravação a cada INTERVALO_ACESSO_MS por aba, sem esperar
    (App.tsx chama ao abrir e de 5 em 5 min enquanto ela está visível). */
export function marcarAcesso(agora = Date.now()) {
  if (agora - ultimoAcesso < INTERVALO_ACESSO_MS - 5000) return;
  ultimoAcesso = agora;
  void stateClient.setAppState({ key: `${PREFIXO}acesso-inicio`, body: { value: JSON.stringify({ v: 1, t: agora, d: null }), validUntilTime: "now+1d" } }).catch(() => { /* sem App State */ });
}
/** Grava a parte (na ação). t = quando a leitura começou. Devolve o tamanho gravado (-1 = grande demais, não gravou). */
export async function gravarAgendado<T>(parte: ParteAgendada, dados: T, t: number): Promise<number> {
  const valor = JSON.stringify({ v: 1, t, d: dados });
  if (valor.length > LIMITE_CHARS) return -1;
  const vale = Math.max(INTERVALO_QUALIDADE_MS / 60000, INTERVALO_AGENDADO_MIN) * 2 + 10;
  await stateClient.setAppState({ key: PREFIXO + parte, body: { value: valor, validUntilTime: `now+${vale}m` } });
  return valor.length;
}
