import React, { useEffect, useRef, useState } from "react";
import { dql, num, texto, qAbandonoDestinos, qFunil, BUCKETS_COPIA, limitarJanelaFiltro } from "../lib/dql";
import { planoPorque } from "../lib/juntas";
import { lerCompartilhado, chaveBloco } from "../lib/compartilhado";
import { useDadoNaTela } from "./DadosDe";
import { PassoJornada } from "../lib/jornadas";
import { formatarInt, formatarMs } from "../lib/graph";
import type { AppInfo } from "../lib/graph";
import { t } from "../lib/i18n";
import { replayDaApp, useReplayApps } from "../lib/replay";
import { Acao, LinksSessao, hora, linkIntent } from "./Links";

type LinhaDql = Record<string, unknown>;
interface Props { passos: PassoJornada[]; k: number; janela: string; robos: boolean; apps?: AppInfo[];
  /** a linha do funil desta jornada na tela, se é de agora (até 30 s; `qualquerIdade` = a que estiver na tela): a análise usa a
      mesma em vez de ler o funil de novo */
  funilRecente?: (qualquerIdade?: boolean) => { linha: LinhaDql | undefined; desde: number } | null;
  /** o funil do mesmo instante da análise (lido junto, ou vindo do cache com ela), para o painel mostrar os dois juntos */
  aoFunil?: (linha: LinhaDql | undefined, desde: number) => void }
/** O que vai ao cache compartilhado: as linhas cruas das consultas (o texto da tela é montado depois, no idioma de quem vê)
    e a linha do funil do mesmo instante (funilDesde = início da leitura dela; null = sem funil). */
interface LeituraDrill { c: LinhaDql[]; d: LinhaDql[]; s: LinhaDql[]; funil: LinhaDql | null; funilDesde: number | null }

export interface Grupo { sessoes: number; comErro: number }
export interface Destino { proximo: string; sessoes: number; comErro: number }
export interface Sessao { id: string; tOrigem: string; ultimo: string; errosOrigem: number; hasReplay: boolean | null; sIni: string | null; sFim: string | null; durMs: number | null; errosSessao: number; endReason: string | null }
/** 1.46.3, período maior que 1 hora: `amostra` = janela de "Para onde foram" e das sessões (a última hora) e quem parou nela (o
    "saiu da aplicação" se calcula com ele); `vereditoDaAmostra` = o veredito também é da última hora (sem as horas analisadas). */
export interface DadosDrill { grupos: { seguiu: Grupo; naoSeguiu: Grupo }; destinos: Destino[]; sessoes: Sessao[]; amostra?: { janela: string; naoSeguiu: Grupo }; vereditoDaAmostra?: boolean }

/** Parte visual do "Why?" (sem consultas): usada pelo app e pela pré-visualização. Enxuta, em 3 partes:
    (1) veredito numa frase: o erro na página anterior explica a perda? (comparando com quem seguiu);
    (2) para onde foram; (3) as sessões (5 primeiras, erros primeiro) com Replay / Session / Errors. */
export const DrillVisao: React.FC<{ passos: PassoJornada[]; k: number; janela: string; dados: DadosDrill; apps?: AppInfo[] }> = ({ passos, k, janela, dados, apps }) => {
  const [todas, setTodas] = useState(false);
  // as sessões listadas fizeram o passo k-1: o Session Replay delas depende da aplicação desse passo (lib/replay.ts)
  const mapaReplay = useReplayApps();
  const replayApp = replayDaApp(passos[Math.max(0, k - 1)]?.app ?? "", apps ?? [], mapaReplay);
  const origem = passos[k - 1];
  const ns = dados.grupos.naoSeguiu, sg = dados.grupos.seguiu;
  const semErro = Math.max(0, ns.sessoes - ns.comErro);
  const pctNs = ns.sessoes ? (100 * ns.comErro) / ns.sessoes : 0, pctSg = sg.sessoes ? (100 * sg.comErro) / sg.sessoes : 0;
  if (ns.sessoes === 0) return <div className="jf-drill"><p className="jf-veredito nenhuma"><i className="ponto" />{t("Ninguém parou aqui.", "Nobody stopped here.")}</p></div>;

  // o erro em origem.view explica a perda? forte / parcial / não
  const forca: "forte" | "parcial" | "nenhuma" = ns.comErro === 0 ? "nenhuma" : pctNs >= 50 && pctNs > 2 * pctSg ? "forte" : pctNs > pctSg ? "parcial" : "nenhuma";
  const veredito = forca === "forte" ? <>{t("Principalmente", "Mostly")} <b>{t(`o erro em ${origem.view}`, `the error on ${origem.view}`)}</b>: {t(`${formatarInt(ns.comErro)} de ${formatarInt(ns.sessoes)} tiveram.`, `${formatarInt(ns.comErro)} of ${formatarInt(ns.sessoes)} had it.`)}</>
    : forca === "parcial" ? <>{t("Em parte", "Partly")} <b>{t(`o erro em ${origem.view}`, `the error on ${origem.view}`)}</b>: {t(`${formatarInt(ns.comErro)} de ${formatarInt(ns.sessoes)} tiveram; ${formatarInt(semErro)} saíram por outro motivo.`, `${formatarInt(ns.comErro)} of ${formatarInt(ns.sessoes)} had it; ${formatarInt(semErro)} left for another reason.`)}</>
    : ns.comErro === 0 ? <>{t(`Não é erro: ninguém teve erro em ${origem.view}.`, `Not an error: none had an error on ${origem.view}.`)}</>
    : <>{t(`Não é o erro: quem seguiu teve erro em ${origem.view} na mesma proporção.`, `Not the error: those who continued had errors on ${origem.view} at the same rate.`)}</>;
  const comparacao = sg.sessoes > 0 ? t(`Quem seguiu: ${formatarInt(sg.comErro)} de ${formatarInt(sg.sessoes)} com erro em ${origem.view}.`, `Those who continued: ${formatarInt(sg.comErro)} of ${formatarInt(sg.sessoes)} with an error on ${origem.view}.`) : null;
  // 1.46.3: em período maior que 1 hora, destinos e sessões são da última hora (e o veredito também, sem as horas analisadas)
  const notaAmostra = dados.amostra ? t("na última hora", "in the last hour") : null;
  const nsAmostra = dados.amostra?.naoSeguiu ?? ns;

  // para onde foram depois de parar em origem.view
  const anteriores = new Set(passos.slice(0, k - 1).map((p) => p.view));
  const idoTotal = dados.destinos.reduce((t, d) => t + d.sessoes, 0), idoComErro = dados.destinos.reduce((t, d) => t + d.comErro, 0);
  const destinos = [
    ...dados.destinos.map((d) => ({ chave: d.proximo, total: d.sessoes, comErro: d.comErro, texto: <>{anteriores.has(d.proximo) ? t("voltou para ", "back to ") : ""}<b>{d.proximo}</b></> })),
    ...(nsAmostra.sessoes - idoTotal > 0 ? [{ chave: "__fim__", total: nsAmostra.sessoes - idoTotal, comErro: Math.max(0, nsAmostra.comErro - idoComErro), texto: <span className="jf-fim">{t("saiu da aplicação", "left the application")}</span> }] : []),
  ].sort((a, b) => b.total - a.total);

  const lista = todas ? dados.sessoes : dados.sessoes.slice(0, 5);
  const comErroLista = dados.sessoes.filter((s) => s.errosOrigem > 0);
  // pela cópia das sessões (business events), não pelo user.sessions (Digital Experience Monitoring - Query)
  const dqlTodas = `fetch bizevents, from: now()-${dados.amostra?.janela ?? janela}, bucket: {${Object.values(BUCKETS_COPIA).map((b) => `"${b}"`).join(", ")}}
| filter in(dt.rum.session.id, array(${comErroLista.map((s) => `"${s.id}"`).join(", ")}))
| sort start_time asc`;

  return (
    <div className="jf-drill">
      <p className={`jf-veredito ${forca}`}><i className="ponto" /><span>{veredito}</span></p>
      {comparacao && <p className="jf-meta">{comparacao}{dados.vereditoDaAmostra && notaAmostra ? ` (${notaAmostra})` : ""}</p>}

      <h4 className="jf-drill-titulo">{t("Para onde foram", "Where they went")}{notaAmostra && <> <span className="dp-bloco-nota">{notaAmostra}</span></>}</h4>
      <ul className="jf-destinos">
        {destinos.map((d) => <li key={d.chave}><span>{d.texto}</span><span className="jf-destino-n"><b>{formatarInt(d.total)}</b>{d.comErro > 0 && <span className="erro"> · {formatarInt(d.comErro)} {t("depois de um erro", "after an error")}</span>}</span></li>)}
      </ul>

      <h4 className="jf-drill-titulo">{t("Sessões", "Sessions")} <span className="dp-bloco-nota">{t("erros primeiro", "errors first")}{notaAmostra ? ` · ${notaAmostra}` : ""}</span></h4>
      {dados.sessoes.length === 0 ? <p className="painel-vazio">{t("Nenhuma sessão neste período.", "No sessions in this timeframe.")}</p> : (
        <ul className="jf-sessoes">
          {lista.map((s) => {
            const ini = s.sIni ?? s.tOrigem, fim = s.sFim ?? s.ultimo;
            return (
              <li key={s.id} title={`${s.id}${s.endReason ? ` · ${t("fim", "end")}: ${s.endReason}` : ""}`}>
                <span className={`dp-chip ${s.errosOrigem > 0 ? "falha" : "ok"}`}>{s.errosOrigem > 0 ? t("erro", "error") : t("sem erro", "no error")}</span>
                <span className="jf-sessao-hora">{hora(ini)}{s.durMs != null ? ` · ${formatarMs(s.durMs)}` : ""}</span>
                <LinksSessao id={s.id} inicio={ini} fim={fim} hasReplay={s.hasReplay} temErro={s.errosOrigem > 0 || s.errosSessao > 0} replayDaApp={replayApp} />
              </li>
            );
          })}
        </ul>
      )}
      <div className="jf-drill-rodape">
        {dados.sessoes.length > 5 && <button className="painel-link" onClick={() => setTodas((t) => !t)}>{todas ? t("Mostrar menos", "Show fewer") : t(`Mostrar as ${formatarInt(dados.sessoes.length)}`, `Show all ${formatarInt(dados.sessoes.length)}`)}</button>}
        {comErroLista.length > 0 && <Acao href={linkIntent({ "dt.query": dqlTodas })} rotulo={t("Abrir as com erro (DQL)", "Open the ones with errors (DQL)")} titulo={t("Abre as sessões com erro num Notebook ou em outro app que aceite DQL", "Opens the sessions with errors in a Notebook or another app that accepts DQL")} />}
      </div>
    </div>
  );
};

/** "Quem não chegou": sessões que fizeram o passo k-1 e não chegaram ao passo k. Consulta o Grail (bucket) e entrega à DrillVisao.
    Cache compartilhado de 5 min (lib/compartilhado.ts), com o funil do mesmo instante: ao abrir, o funil da jornada é o
    que veio com a análise (antes o funil era recalculado ao abrir, para os dois mostrarem o mesmo instante). */
export const JourneyDrill: React.FC<Props> = ({ passos, k, janela, robos, apps, funilRecente, aoFunil }) => {
  const [dados, setDados] = useState<DadosDrill | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [desdeCache, setDesdeCache] = useState<number | null>(null);
  useDadoNaTela(desdeCache);
  const props = useRef({ funilRecente, aoFunil });
  props.current = { funilRecente, aoFunil };

  useEffect(() => {
    let vivo = true;
    setDados(null); setErro(null); setDesdeCache(null);
    // texto das consultas e chave montados agora, com o filtro e a cópia de agora. Quem seguiu x quem não e as sessões
    // numa leitura (DRL-U, lib/juntas.ts); para onde foram (com join) continua à parte. 1.46.3: em período maior que 1 hora,
    // essas leituras da cópia vão só até a última hora (24 h liam bem mais por uso) e o veredito sai do funil da tela
    // (horas analisadas, com "seguiu com erro"); sem ele, o veredito também é da última hora
    const janelaAmostra = limitarJanelaFiltro(janela, true), longo = janelaAmostra !== janela;
    const correlacaoSessoes = planoPorque(passos, k, janelaAmostra, robos), qd = qAbandonoDestinos(passos, k, janelaAmostra, robos);
    const qf = qFunil(passos, janela, robos);
    const comFunil = !!props.current.aoFunil;
    const recente = comFunil ? props.current.funilRecente?.(longo) ?? null : null;
    (async () => {
      try {
        const b = await lerCompartilhado<LeituraDrill>("porque", chaveBloco(JSON.stringify(passos), k, janela, robos), async (ctx) => {
          const desde = Date.now();
          const [[c, s], d, f] = await Promise.all([
            correlacaoSessoes(),
            dql(qd, { contexto: "porque/DRL-02", maxRecords: 50 }),
            // o funil do mesmo instante: o da tela, se é de agora; senão, lido junto (era o recálculo ao abrir). Em período
            // longo, o da tela (as horas analisadas), qualquer que seja a idade: reler o funil do período custaria o que se evita
            comFunil && !recente && !longo ? dql(qf, { contexto: "funil/FUN-01", maxRecords: 10 }) : Promise.resolve(null),
          ]);
          // desde a 1.41 sem o detalhe do user.sessions (replay, duração, fim): início e fim vêm da cópia (t_origem e
          // último registro) e o Replay segue a configuração da aplicação
          return { c, d, s, funil: f ? f[0] ?? null : recente?.linha ?? null, funilDesde: f ? desde : recente?.desde ?? null };
        }, { desistir: () => !vivo, aceitar: (x) => !!x && Array.isArray(x.c) && Array.isArray(x.d) && Array.isArray(x.s) });
        if (!vivo || !b) return;
        const { c, d, s } = b.dados;
        if (b.dados.funilDesde != null) props.current.aoFunil?.(b.dados.funil ?? undefined, b.dados.funilDesde);
        const g = (v: boolean): Grupo => { const l = c.find((x) => x.seguiu === v || String(x.seguiu) === String(v)); return { sessoes: num(l?.sessoes), comErro: num(l?.com_erro) }; };
        // 1.46.3: veredito do período pelo funil das horas analisadas (p, q = parou com erro, c = seguiu com erro)
        const fl = longo ? (b.dados.funil ?? props.current.funilRecente?.(true)?.linha ?? null) : null;
        const doFunil = fl && fl.c_ok === true && fl[`p${k}`] != null && fl[`c${k}`] != null
          ? { seguiu: { sessoes: num(fl[`p${k}`]), comErro: num(fl[`c${k}`]) }, naoSeguiu: { sessoes: Math.max(0, num(fl[`p${k - 1}`]) - num(fl[`p${k}`])), comErro: num(fl[`q${k}`]) } }
          : null;
        setDados({
          grupos: doFunil ?? { seguiu: g(true), naoSeguiu: g(false) },
          ...(longo ? { amostra: { janela: janelaAmostra, naoSeguiu: g(false) }, vereditoDaAmostra: !doFunil } : {}),
          destinos: d.map((x) => ({ proximo: texto(x.proximo) ?? "", sessoes: num(x.sessoes), comErro: num(x.com_erro) })),
          sessoes: s.map((x) => ({ id: texto(x.sessao) ?? "", tOrigem: texto(x.t_origem) ?? "", ultimo: texto(x.ultimo) ?? "", errosOrigem: num(x.erros_origem),
                                   hasReplay: x.has_replay == null ? null : x.has_replay === true || x.has_replay === "true", sIni: texto(x.s_ini), sFim: texto(x.s_fim),
                                   durMs: x.dur_ms == null ? null : num(x.dur_ms), errosSessao: num(x.erros_sessao), endReason: texto(x.end_reason) })),
        });
        setDesdeCache(b.deCache ? b.desde : null);
      } catch (e) { if (vivo) setErro(e instanceof Error ? e.message : String(e)); }
    })();
    return () => { vivo = false; };
    // o filtro de segmento fica fora de propósito: trocá-lo recalcula o funil, que some enquanto calcula ("Calculando o
    // funil…") e desmonta este drill; ele lê de novo com o filtro novo quando o funil volta (e usa o funil que acabou de
    // chegar). Com ele aqui, leria antes de o funil voltar e leria o funil de novo. A chave do cache leva o filtro de
    // agora (chaveBloco): a entrada nunca é de outro filtro
  }, [passos, k, janela, robos]);

  if (erro) return <div className="jf-drill"><p className="painel-erro">{t("Erro na consulta", "Query error")}: {erro}</p></div>;
  if (!dados) return <div className="jf-drill"><p className="painel-vazio">{t("Analisando as sessões…", "Analyzing the sessions…")}</p></div>;
  return <DrillVisao passos={passos} k={k} janela={janela} dados={dados} apps={apps} />;
};
