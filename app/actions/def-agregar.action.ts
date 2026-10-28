/**
 * Ação de workflow "def-agregar" do DEF (arquitetura de 19/10/2026).
 *
 * Roda num workflow SIMPLES (uma tarefa, sem custo por hora) a cada 5 min e substitui as 10 métricas próprias: lê só a
 * fatia de 5 min que acabou de fechar na cópia (navegação, erro e experiência) e grava os totais dela como business
 * events no bucket rum_flow_agregados (lib/agregados.ts). Antes confere as últimas 12 fatias e refaz as que faltam (uma
 * execução que falhou é coberta pela seguinte), no máximo 4 por execução. Cada fatia termina com o registro de controle,
 * que diz que ela está completa e quanto a leitura custou (bytes lidos do Grail).
 *
 * Tarefa "sessoes" (a cada 15 min, no ciclo abaixo): as sessões da ÚLTIMA HORA (lib/horaria.ts, qUltimaHora): os
 * indicadores de sessão por aplicação, os lugares do mapa e as sessões com erro mais recentes, numa leitura, gravados no
 * App State do app (parte "ultimahora", lib/agendado.ts). Só lê se a Visão geral esteve aberta nos últimos 20 min.
 *
 * Tarefa "hora" (a cada 15 min, no ciclo abaixo): a análise de hora em hora (lib/horaria.ts): cada hora é analisada uma
 * vez, por partes (sessões, requisições, ligação página -> serviço e funis), e gravada no bucket rum_flow_horas; confere
 * as últimas 23 horas (a ingestão recusa evento com mais de 24 h) e refaz o que falta, até ORCAMENTO_HORA_MS por execução;
 * as horas analisadas vão também para o App State (parte "horas").
 *
 * Tarefa "ciclo" (1.44.5, o workflow único a cada 5 min): as fatias em toda execução e, pelo bloco de 5 min do horário
 * (parteDaRodada), as sessões da última hora em uma de cada três e a análise de hora em hora em outra (a cada 15 min, como
 * quando eram três workflows); o orçamento da hora conta desde o começo da execução, para a execução caber em 1 minuto
 * (cada minuto começado é uma execução cobrada). As tarefas "fatias", "sessoes" e "hora" continuam aceitas.
 *
 * Quem roda: o ator do workflow, com as permissões dele e os escopos do app (leitura de business events e ingestão).
 * O workflow é criado uma vez por ambiente (app customizado não cria workflow): pelo botão "Criar o workflow" da
 * Configuração, que abre o app Workflows preenchido, ou importando o JSON que ela oferece.
 */
import { queryExecutionClient } from "@dynatrace-sdk/client-query";
import { businessEventsClient, type CloudEvent } from "@dynatrace-sdk/client-classic-environment-v2";
import { stateClient } from "@dynatrace-sdk/client-state";
import { qFatia, qFatiasFeitas, fatiasPendentes, eventosDaFatia, controleDaFatia, controleDoRetrato, lotesDeIngestao, LIMITE_LINHAS_FATIA, FATIA_MIN, type EventoAgregado } from "../ui/app/lib/agregados";
import { usarCopia, usarSegmento, usarQuadros, usarComponentes, BUCKETS_COPIA, BUCKET_PASSOS_PADRAO, qFunisJuntos, lotesFunis, qContarSpans, qLigacaoAmostrada, razaoLigacao, LIMITE_LIGACAO_GLOBAL, type PassoQ } from "../ui/app/lib/queries";
import { gravarAgendado, idadeAgendado, USO_RECENTE_INICIO_MS } from "../ui/app/lib/agendado";
import { linhasQuadroDaHora, juntarHoraQuadros, componentesDe, type EstadoQuadros } from "../ui/app/lib/quadros";
import { lerQuadros, gravarQuadros } from "../ui/app/lib/quadrosEstado";
import { lerCopiaDesde } from "../ui/app/lib/copiaDesde";
import { parteDaRodada } from "../ui/app/lib/workflows";
import { qUltimaHora, ultimaHoraParaLinhas, qHorasFeitas, unidadesPendentes, chaveJornadas, qHoraSessoes, qHoraReq, qHoraFunis, eventosDaHora, controleDaHora, linhasSessoesParaGravar,
         K_SESSOES, K_REQ, LIMITE_LINHAS_HORA, LIMITE_REQ_LIGACAO, separarReqLigacao, separarQuadrosHora, unidadesFeitas, MS_HORA, execucaoDaHora, periodosDasUnidades, type HorasAnalisadas, type Unidade } from "../ui/app/lib/horaria";

interface Entrada { tarefa?: string }
interface Lido { linhas: Record<string, unknown>[]; bytes: number | null; registros: number | null }

const espera = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
async function consultar(query: string, maxResultRecords: number): Promise<Lido> {
  const inicio = await queryExecutionClient.queryExecute({ body: { query, maxResultRecords, requestTimeoutMilliseconds: 20000 }, dtClientContext: "def/agregador" });
  let result = inicio.result, estado: string | undefined = inicio.state;
  while (!result && inicio.requestToken) {
    await espera(800);
    const p = await queryExecutionClient.queryPoll({ requestToken: inicio.requestToken, requestTimeoutMilliseconds: 20000, dtClientContext: "def/agregador" });
    estado = p.state; result = p.result;
    if (!result && estado !== "RUNNING" && estado !== "NOT_STARTED") throw new Error(`consulta terminou em ${estado}`);
  }
  const g = result?.metadata?.grail;
  return { linhas: ((result?.records ?? []) as unknown[]).filter(Boolean) as Record<string, unknown>[], bytes: g?.scannedBytes == null ? null : Number(g.scannedBytes), registros: g?.scannedRecords == null ? null : Number(g.scannedRecords) };
}

/** As jornadas salvas (a mesma chave do App State de lib/jornadas.ts), só as com passos, na ordem da lista. */
async function jornadasComPassos(): Promise<PassoQ[][]> {
  try {
    const lista = JSON.parse((await stateClient.getAppState({ key: "rum-flow.jornadas.v1" })).value || "[]") as { passos?: PassoQ[] }[];
    return (Array.isArray(lista) ? lista : []).map((j) => (Array.isArray(j?.passos) ? j.passos.map((p) => ({ app: String(p.app), view: String(p.view) })) : [])).filter((ps) => ps.length > 0);
  } catch { return []; }
}

/** Registro de controle de uma execução pulada (ninguém usou a tela): a Configuração vê que o workflow roda. */
const pular = async (tarefa: "sessoes", t: number, motivo: string) => {
  const ev = controleDoRetrato(t, { consultas: 0, bytes: 0, ms: 0, tamanhos: {}, jornadas: 0, pulado: motivo });
  await businessEventsClient.ingest({ body: [ev] as unknown as CloudEvent[], type: "application/cloudevent-batch+json" });
  return { tarefa, pulado: motivo };
};

/** Sessões da última hora (indicadores e mapa), no App State: a tela usa enquanto têm até 20 min. */
async function sessoes() {
  const t = Date.now();
  // preguiçoso: só lê se a Visão geral esteve aberta nos últimos 20 min
  const acesso = await idadeAgendado("acesso-inicio");
  if (acesso == null || t - acesso > USO_RECENTE_INICIO_MS) return pular("sessoes", t, "sem uso da Visão geral nos últimos 20 minutos");
  usarQuadros(false);
  usarComponentes(componentesDe(await lerQuadros(), t));   // 1.45.11: frames das 24 h (App State, grátis)
  const r = await consultar(qUltimaHora(t - MS_HORA, t), 30000);
  const tam = await gravarAgendado("ultimahora", ultimaHoraParaLinhas(r.linhas), t);
  console.log(`última hora de ${new Date(t).toISOString()}: ${r.linhas.length} linhas, ${r.bytes} bytes lidos; gravado ${tam}`);
  await businessEventsClient.ingest({ body: [controleDoRetrato(t, { consultas: 1, bytes: r.bytes ?? 0, ms: Date.now() - t, tamanhos: { ultimahora: tam }, jornadas: 0 })] as unknown as CloudEvent[], type: "application/cloudevent-batch+json" });
  return { tarefa: "sessoes", desde: new Date(t).toISOString(), linhas: r.linhas.length, bytes: r.bytes, tamanho: tam };
}

/** Até quanto tempo uma execução da tarefa "hora" começa unidades novas (a função tem limite de tempo); no ciclo, contado
    desde o começo da execução e menor, para a execução inteira caber em 1 minuto (uma execução cobrada). */
const ORCAMENTO_HORA_MS = 60_000;
const ORCAMENTO_HORA_CICLO_MS = 40_000;
const ingerir = async (eventos: EventoAgregado[]) => { for (const lote of lotesDeIngestao(eventos)) await businessEventsClient.ingest({ body: lote as unknown as CloudEvent[], type: "application/cloudevent-batch+json" }); };
/** Funis da hora para todas as jornadas: um lote por vez (limite de expressões do DQL), com o índice de cada jornada na
    lista inteira (j<i>_ do lote vira j<índice>_). A jornada grande demais sozinha fica de fora. */
async function funisDaHora(h: number, passos: PassoQ[][]) {
  const { lotes } = lotesFunis(passos, "60m", false);
  const linha: Record<string, unknown> = {};
  let bytes = 0;
  for (const ids of lotes) {
    const r = await consultar(qHoraFunis(h, qFunisJuntos(ids.map((i) => passos[i]), "60m", false)), 1);
    bytes += r.bytes ?? 0;
    for (const [c, v] of Object.entries(r.linhas[0] ?? {})) { const m = /^j(\d+)_(.*)$/.exec(c); if (m) linha[`j${ids[+m[1]]}_${m[2]}`] = v; }
  }
  return { linha, bytes };
}
async function hora(inicio?: number) {
  const t0 = Date.now(), exec = t0.toString(36);
  const desde = inicio ?? t0, orcamento = inicio == null ? ORCAMENTO_HORA_MS : ORCAMENTO_HORA_CICLO_MS;
  usarCopia({ buckets: { ...BUCKETS_COPIA }, antigo: BUCKET_PASSOS_PADRAO, novosAte: t0, antigoAte: null, desvio: 0 });
  usarSegmento({});
  usarQuadros(false);
  // 1.45.11: os frames das 24 h (App State, grátis) valem para as sessões e os funis desta execução
  let estadoQuadros: EstadoQuadros | null = await lerQuadros();
  usarComponentes(componentesDe(estadoQuadros, t0));
  const passos = await jornadasComPassos();
  const fj = passos.length ? chaveJornadas(passos) : null;
  const controles = (await consultar(qHorasFeitas(t0), 5000)).linhas;
  // pendentes: sem as sessões e os funis de antes da versão dos frames (refeitos uma vez); os períodos contam todas as
  // unidades com controle, porque a leitura usa a execução mais recente de cada uma (a de antes, até ser refeita)
  const feitas = unidadesFeitas(controles), comControle = new Set(controles.map((l) => String(l.unidade)));
  // 1.47.4: as horas que terminaram antes da cópia começar (instalação nova) ficam de fora: não há o que analisar
  const copiaDesde = await lerCopiaDesde();
  const pendentes = unidadesPendentes(t0, feitas, fj, copiaDesde);
  const feitasAgora: { unidade: string; linhas: number; bytes: number; ms: number }[] = [];
  const juntas = new Set<string>();   // ligações já gravadas pela leitura junta com as requisições da mesma hora
  for (const u of pendentes) {
    if (juntas.has(u.unidade)) continue;
    if (Date.now() - desde > orcamento) break;
    const r0 = Date.now();
    const de = new Date(u.hora).toISOString(), ate = new Date(u.hora + MS_HORA).toISOString();
    let eventos: EventoAgregado[] = [], bytes = 0, linhas = 0;
    const extra: Record<string, string | number | boolean> = {};
    if (u.parte === "sessoes") {
      const r = await consultar(qHoraSessoes(u.hora), LIMITE_LINHAS_HORA);
      const ls = linhasSessoesParaGravar(r.linhas);
      eventos = eventosDaHora(ls, (l) => K_SESSOES[String(l.grupo)] ?? null, u.hora, u.unidade, exec);
      bytes = r.bytes ?? 0; linhas = ls.length;
    } else if (u.parte === "req") {
      // 1.45.2: com a ligação da mesma hora também pendente, as duas numa leitura só da cópia (qHoraReq com a ligação);
      // se a leitura junta bater no limite de linhas, as duas como antes
      const ul = pendentes.find((x) => x.parte === "ligacao" && x.hora === u.hora && !juntas.has(x.unidade));
      let feito = false, quadrosHora: Record<string, unknown>[] = [];
      if (ul) {
        const c = await consultar(qContarSpans(de, ate), 1);
        const spans = Number(c.linhas[0]?.n ?? 0), razao = razaoLigacao(spans);
        const r = await consultar(qHoraReq(u.hora, { razao }), LIMITE_REQ_LIGACAO);
        const s = separarReqLigacao(r.linhas);
        if (s.completo) {
          const sq = separarQuadrosHora(s.req);
          eventos = eventosDaHora(sq.req, (l) => K_REQ[String(l.g)] ?? null, u.hora, u.unidade, exec);
          bytes = r.bytes ?? 0; linhas = sq.req.length; extra.junto = "ligacao"; quadrosHora = sq.quadros;
          await ingerir([...eventosDaHora(s.ligacao, () => "h_lig", ul.hora, ul.unidade, exec),
            controleDaHora(ul, exec, { linhas: s.ligacao.length, bytes: c.bytes ?? 0, ms: Date.now() - r0, extra: { razao, spans, junto: "req" } })]);
          juntas.add(ul.unidade);
          feitasAgora.push({ unidade: ul.unidade, linhas: s.ligacao.length, bytes: c.bytes ?? 0, ms: Date.now() - r0 });
          feito = true;
        }
      }
      if (!feito) {
        const r = await consultar(qHoraReq(u.hora), LIMITE_LINHAS_HORA);
        const sq = separarQuadrosHora(r.linhas);
        eventos = eventosDaHora(sq.req, (l) => K_REQ[String(l.g)] ?? null, u.hora, u.unidade, exec);
        bytes = r.bytes ?? 0; linhas = sq.req.length; quadrosHora = sq.quadros;
      }
      // 1.45.10: as páginas que carregaram como frame na hora, nas 24 h do App State (gravação grátis, a cada hora: a
      // execução pode parar no limite de tempo); sem permissão de gravar, a tela fica com a marca do RUM, como antes
      try {
        estadoQuadros = juntarHoraQuadros(estadoQuadros, u.hora, linhasQuadroDaHora(quadrosHora), Date.now());
        await gravarQuadros(estadoQuadros);
        extra.quadros = quadrosHora.length;
      } catch (e) { console.log(`frames da hora ${u.unidade}: não gravados (${e instanceof Error ? e.message : String(e)})`); }
    } else if (u.parte === "ligacao") {
      const c = await consultar(qContarSpans(de, ate), 1);
      const spans = Number(c.linhas[0]?.n ?? 0), razao = razaoLigacao(spans);
      const r = await consultar(qLigacaoAmostrada(de, ate, razao), LIMITE_LIGACAO_GLOBAL);
      eventos = eventosDaHora(r.linhas, () => "h_lig", u.hora, u.unidade, exec);
      bytes = (c.bytes ?? 0) + (r.bytes ?? 0); linhas = r.linhas.length; extra.razao = razao; extra.spans = spans;
    } else {
      const f = await funisDaHora(u.hora, passos);
      eventos = eventosDaHora([{ jornadas: fj, funil_j: JSON.stringify(f.linha) }], () => "h_fun", u.hora, u.unidade, exec);
      bytes = f.bytes; linhas = 1; extra.jornadas = fj ?? "";
    }
    await ingerir([...eventos, controleDaHora(u as Unidade, exec, { linhas, bytes, ms: Date.now() - r0, extra })]);
    feitasAgora.push({ unidade: u.unidade, linhas, bytes, ms: Date.now() - r0 });
    console.log(`hora ${u.unidade}: ${linhas} linhas, ${bytes} bytes lidos, ${Date.now() - r0} ms`);
  }
  // as horas analisadas de cada parte para a tela (App State; a tela não lê mais o bucket de horas para saber isso)
  await gravarAgendado("horas", { funis: fj, periodos: periodosDasUnidades([...comControle, ...feitasAgora.map((x) => x.unidade)], fj) } satisfies HorasAnalisadas, t0);
  // o registro da execução (com a hora em que rodou), mesmo sem hora pendente: a Configuração vê que o workflow roda
  await ingerir([execucaoDaHora(t0, { pendentes: pendentes.length, feitas: feitasAgora.length, bytes: feitasAgora.reduce((s, x) => s + x.bytes, 0), ms: Date.now() - t0 })]);
  return { tarefa: "hora", pendentes: pendentes.length, feitas: feitasAgora };
}

export default async (payload: Entrada) => {
  const tarefa = payload?.tarefa || "fatias";
  if (tarefa === "ciclo") {
    const inicio = Date.now();
    const f = await fatias();
    const parte = parteDaRodada(inicio);
    const extra = parte === "sessoes" ? await sessoes() : parte === "hora" ? await hora(inicio) : null;
    return { tarefa: "ciclo", parte, fatias: f, extra, ms: Date.now() - inicio };
  }
  if (tarefa === "sessoes") return sessoes();
  if (tarefa === "hora") return hora();
  if (tarefa !== "fatias") throw new Error(`tarefa desconhecida: ${tarefa}`);
  return fatias();
};

/** As fatias de 5 min que faltam (até 4 por execução), cada uma com o registro de controle. */
async function fatias() {
  const tarefa = "fatias";
  const agora = Date.now();
  const feitas = new Set((await consultar(qFatiasFeitas(agora), 1000)).linhas.map((l) => Date.parse(String(l.fatia))).filter((t) => !isNaN(t)));
  const pendentes = fatiasPendentes(agora, feitas);
  const exec = agora.toString(36);
  const gravadas: { fatia: string; linhas: number; bytes: number | null; ms: number }[] = [];
  for (const ini of pendentes) {
    const t0 = Date.now();
    const r = await consultar(qFatia(ini, ini + FATIA_MIN * 60000), LIMITE_LINHAS_FATIA);
    const medida = { linhas: r.linhas.length, bytes: r.bytes, registros: r.registros, ms: Date.now() - t0 };
    const eventos = [...eventosDaFatia(r.linhas, ini, exec), controleDaFatia(ini, exec, medida)];
    for (const lote of lotesDeIngestao(eventos)) await businessEventsClient.ingest({ body: lote as unknown as CloudEvent[], type: "application/cloudevent-batch+json" });
    gravadas.push({ fatia: new Date(ini).toISOString(), linhas: medida.linhas, bytes: medida.bytes, ms: medida.ms });
    console.log(`fatia ${new Date(ini).toISOString()}: ${medida.linhas} agregados, ${medida.bytes ?? "?"} bytes lidos, ${medida.ms} ms`);
  }
  return { tarefa, conferidas: feitas.size, pendentes: pendentes.length, gravadas };
};
