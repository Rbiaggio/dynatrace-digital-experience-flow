import React, { useEffect, useMemo, useState } from "react";
import { dql, num, texto, qInicioSessoes } from "../lib/dql";
import { lerCompartilhado, chaveBloco } from "../lib/compartilhado";
import { useDadoNaTela } from "./DadosDe";
import type { AppInfo } from "../lib/graph";
import { formatarInt, formatarMs } from "../lib/graph";
import { SEM_NOME, erroCurtoDe } from "../lib/inicio";
import { t } from "../lib/i18n";
import { LinksSessao, hora } from "./Links";
import { ChipApp } from "./ChipApp";
import type { AbaPagina } from "./DetailPanel";
import { replayDaApp, useReplayApps } from "../lib/replay";

/** Quais sessões tiveram erro (aberta pelos indicadores "Sessões com erro" e "Saíram após um erro" e pelo "Ver sessões"
    do o que melhorar): as mais recentes primeiro, com onde e qual foi o erro, onde a sessão terminou e os atalhos para o
    Replay, a sessão e os erros dela. No escopo padrão (1.43.6) as sessões vêm prontas da leitura da última hora (a mesma
    dos indicadores, sem leitura a mais) e, embaixo, as sessões das 3 requisições mais lentas das 24 horas analisadas; fora
    dele, lê a cópia do período escolhido, como antes. */
export interface SessaoLenta { app: string; pagina: string | null; d: number; t: string; s: string | null; c: string | null }

export interface FiltroSessoes { soSaiu: boolean; view?: string | null; appView?: string | null }
interface Linha { app: string; sessao: string; inicio: string; navs: number; erros: number; fim: string | null; saiu: boolean; erroView: string | null; erroCurto: string; erroTipo: string | null; hasReplay: boolean | null; fimSessao: string | null }

interface Props {
  app: string; todas: string; apps: AppInfo[]; janela: string; robos: boolean; versao: number;
  filtro: FiltroSessoes; totais: { comErro: number; saiu: number };
  aoMudar: (f: FiltroSessoes) => void; aoFechar: () => void;
  aoAbrirPagina: (app: string, view: string, aba?: AbaPagina) => void;
  /** 1.43.6: as sessões com erro mais recentes da última hora (formato de qInicioSessoes, com as páginas com erro) */
  linhasProntas?: Record<string, unknown>[];
  /** 1.43.6: as sessões das 3 requisições mais lentas das 24 horas analisadas */
  lerLentas?: () => Promise<SessaoLenta[]>;
}

const LIMITE = 50;
const nomePagina = (v: string | null) => (!v || v === SEM_NOME ? t("(sem nome)", "(no name)") : v);

export const ListaSessoes: React.FC<Props> = ({ app, todas, apps, janela, robos, versao, filtro, totais, aoMudar, aoFechar, aoAbrirPagina, linhasProntas, lerLentas }) => {
  const [linhas, setLinhas] = useState<Linha[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [desdeCache, setDesdeCache] = useState<number | null>(null);
  useDadoNaTela(desdeCache);
  const escopo = filtro.view && filtro.appView ? filtro.appView : app;
  const multi = escopo === todas;
  // Session Replay por aplicação (Settings): decide a dica do botão Replay de cada sessão e o subtítulo da lista
  const mapaReplay = useReplayApps();
  const appsEscopo = multi ? apps.map((a) => a.id) : [escopo];
  const replayDesligado = !!mapaReplay && appsEscopo.length > 0 && appsEscopo.every((a) => replayDaApp(a, apps, mapaReplay) === "desligado");

  const [lentas, setLentas] = useState<SessaoLenta[] | null>(null);
  useEffect(() => {
    let vivo = true;
    setLentas(null);
    if (lerLentas) lerLentas().then((x) => { if (vivo) setLentas(x); }, () => { if (vivo) setLentas([]); });
    return () => { vivo = false; };
  }, [lerLentas]);
  // da última hora: o filtro (saíram após o erro, página, aplicação) sobre as sessões prontas, as 50 mais recentes
  const prontas = useMemo<Linha[] | null>(() => {
    if (!linhasProntas) return null;
    return linhasProntas
      .filter((x) => (escopo === todas || x.app === escopo) && (!filtro.soSaiu || x.saiu_erro === true || x.saiu_erro === "true")
        && (!filtro.view || (Array.isArray(x.verro) && (x.verro as unknown[]).map(String).includes(filtro.view))))
      .slice(0, LIMITE)
      .map((x) => ({ app: texto(x.app) ?? "", sessao: texto(x.sessao) ?? "", inicio: texto(x.inicio) ?? "", navs: num(x.navs), erros: num(x.erros), fim: texto(x.fim),
                     saiu: x.saiu_erro === true || x.saiu_erro === "true", erroView: texto(x.erro_view),
                     erroCurto: erroCurtoDe(texto(x.erro_tipo), texto(x.erro_status), texto(x.erro_caminho), texto(x.erro_msg)), erroTipo: texto(x.erro_tipo),
                     hasReplay: null, fimSessao: texto(x.ultimo) }));
  }, [linhasProntas, escopo, todas, filtro.soSaiu, filtro.view]);
  useEffect(() => {
    let vivo = true;
    setLinhas(null); setErro(null); setDesdeCache(null);
    if (linhasProntas) return () => { vivo = false; };
    // cache compartilhado de 5 min (lib/compartilhado.ts): texto e chave montados agora, com o filtro de agora; guarda as
    // linhas cruas (o texto da tela sai no idioma de quem vê)
    const q = qInicioSessoes(escopo, janela, robos, { soSaiu: filtro.soSaiu, view: filtro.view ?? null }, LIMITE);
    (async () => {
      try {
        const b = await lerCompartilhado("sessoes", chaveBloco(escopo, janela, robos, filtro.soSaiu, filtro.view ?? null, LIMITE), async (ctx) => {
          // desde a 1.41 sem user.sessions: o fim é o último registro da sessão na cópia e o Replay segue a aplicação
          return { r: await dql(q, { contexto: "sessoes/SES-01", maxRecords: LIMITE }) };
        }, { desistir: () => !vivo, aceitar: (x) => !!x && Array.isArray(x.r) });
        if (!vivo || !b) return;
        const { r } = b.dados;
        setDesdeCache(b.deCache ? b.desde : null);
        setLinhas(r.map((x) => {
          return { app: texto(x.app) ?? "", sessao: texto(x.sessao) ?? "", inicio: texto(x.inicio) ?? "", navs: num(x.navs), erros: num(x.erros), fim: texto(x.fim),
                   saiu: x.saiu_erro === true || x.saiu_erro === "true", erroView: texto(x.erro_view),
                   erroCurto: erroCurtoDe(texto(x.erro_tipo), texto(x.erro_status), texto(x.erro_caminho), texto(x.erro_msg)), erroTipo: texto(x.erro_tipo),
                   hasReplay: null, fimSessao: texto(x.ultimo) };
        }));
      } catch (e) { if (vivo) setErro(e instanceof Error ? e.message : String(e)); }
    })();
    return () => { vivo = false; };
    // o filtro de segmento fica fora de propósito: trocá-lo faz a visão geral reler e mostrar "Lendo as sessões…", o que
    // desmonta esta lista, e ela lê de novo com o filtro novo ao voltar. A chave do cache leva o filtro de agora
    // (chaveBloco): a entrada nunca é de outro filtro
  }, [escopo, janela, robos, filtro.soSaiu, filtro.view, versao, !!linhasProntas]);   // eslint-disable-line react-hooks/exhaustive-deps
  const vistas = prontas ?? linhas;

  return (
    <section className="in-cartao in-sessoes">
      <div className="in-sessoes-topo">
        <h3>{t("Sessões com erro", "Sessions with errors")}<span>{`${linhasProntas ? t(`as ${LIMITE} mais recentes da última hora`, `the ${LIMITE} most recent of the last hour`) : t(`as ${LIMITE} mais recentes`, `the ${LIMITE} most recent`)} · ${replayDesligado
          ? t(`Session Replay desligado ${multi ? "nestas aplicações" : "nesta aplicação"}: o botão Replay fica inativo`, `Session Replay is off ${multi ? "for these applications" : "for this application"}: the Replay button stays inactive`)
          : t("abra o Replay para ver o que o cliente viu", "open the Replay to see what the customer saw")}`}</span></h3>
        <button className="painel-fechar" onClick={aoFechar} title={t("Fechar a lista", "Close the list")} aria-label={t("Fechar", "Close")}>×</button>
      </div>
      <div className="in-sessoes-filtros">
        <div className="segmentado in-segmentado" role="tablist">
          <button role="tab" aria-selected={!filtro.soSaiu} className={!filtro.soSaiu ? "ativo" : ""} onClick={() => aoMudar({ ...filtro, soSaiu: false })}>
            {t("Todas com erro", "All with errors")}{!filtro.view ? ` (${formatarInt(totais.comErro)})` : ""}</button>
          <button role="tab" aria-selected={filtro.soSaiu} className={filtro.soSaiu ? "ativo" : ""} onClick={() => aoMudar({ ...filtro, soSaiu: true })}>
            {t("Saíram após o erro", "Left after the error")}{!filtro.view ? ` (${formatarInt(totais.saiu)})` : ""}</button>
        </div>
        {filtro.view && (
          <span className="in-filtro-chip">{t("Erro na página", "Error on page")} <b>{nomePagina(filtro.view)}</b>
            <button onClick={() => aoMudar({ soSaiu: filtro.soSaiu })} title={t("Tirar o filtro de página", "Remove the page filter")} aria-label={t("Tirar o filtro", "Remove filter")}>×</button></span>
        )}
      </div>
      {erro && !prontas ? <p className="painel-erro">{t("Erro na consulta", "Query error")}: {erro}</p>
        : !vistas ? <p className="painel-vazio">{t("Lendo as sessões…", "Reading the sessions…")}</p>
        : vistas.length === 0 ? <p className="painel-vazio">{linhasProntas ? t("Nenhuma sessão com erro na última hora.", "No session with errors in the last hour.") : t("Nenhuma sessão neste período.", "No sessions in this timeframe.")}</p>
        : (
          <ul className="in-lista-sessoes">
            {vistas.map((s) => (
              <li key={`${s.app}|${s.sessao}`} title={s.sessao}>
                <span className="in-sessao-hora">{hora(s.inicio)}</span>
                <span className="in-sessao-texto">
                  <span>{t("Erro em", "Error on")} <button className="painel-link erro" onClick={() => s.erroView && aoAbrirPagina(s.app, s.erroView, "erros")} title={t("Ver os erros desta página no Flow", "See this page's errors in the Flow")}>{nomePagina(s.erroView)}</button>: <span className="in-sessao-erro">{s.erroCurto}</span></span>
                  <span className="in-sub">
                    {multi ? <ChipApp apps={apps} id={s.app} /> : null}
                    {s.saiu ? <span className="in-motivo erro">{t("Saiu após o erro", "Left after the error")}</span> : null}
                    {s.saiu ? " " : ""}{t("Terminou em", "Ended on")} {nomePagina(s.fim)} · {s.navs === 1 ? t("1 página", "1 page") : t(`${formatarInt(s.navs)} páginas`, `${formatarInt(s.navs)} pages`)} · {s.erros === 1 ? t("1 erro", "1 error") : t(`${formatarInt(s.erros)} erros`, `${formatarInt(s.erros)} errors`)}
                  </span>
                </span>
                <LinksSessao id={s.sessao} inicio={s.inicio} fim={s.fimSessao} hasReplay={s.hasReplay} temErro temCrash={s.erroTipo === "crash"} replayDaApp={replayDaApp(s.app, apps, mapaReplay)} />
              </li>
            ))}
          </ul>
        )}
      {lerLentas && <>
        <h4 className="in-exemplos-sub">{t("Mais lentas", "Slowest")}<span>{t("as sessões das 3 requisições mais lentas · últimas 24 h", "the sessions of the 3 slowest requests · last 24 h")}</span></h4>
        {(() => {
          const ls = (lentas ?? []).filter((x) => x.s && (!filtro.view || x.pagina === filtro.view)).slice(0, 3);
          return lentas == null ? <p className="painel-vazio">{t("Lendo…", "Reading…")}</p>
            : ls.length === 0 ? <p className="painel-vazio">{t("Nenhuma requisição com trace nas últimas 24 h.", "No request with a trace in the last 24 h.")}</p> : (
            <ul className="in-lista-sessoes">
              {ls.map((x) => (
                <li key={x.t} className="in-exemplo">
                  <span className="in-sessao-texto">
                    <span><b>{formatarMs(x.d)}</b> · <code>{x.c ?? "?"}</code></span>
                    <span className="in-sub">{multi ? <ChipApp apps={apps} id={x.app} /> : null}{x.pagina ? <button className="painel-link" onClick={() => aoAbrirPagina(x.app, x.pagina!, "traces")}>{nomePagina(x.pagina)}</button> : null}</span>
                  </span>
                  {x.s && <LinksSessao id={x.s} inicio={null} fim={null} hasReplay={null} temErro={false} replayDaApp={replayDaApp(x.app, apps, mapaReplay)} />}
                </li>
              ))}
            </ul>
          );
        })()}
      </>}
    </section>
  );
};
