import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import { formatarInt, formatarMs } from "../lib/graph";
import { t } from "../lib/i18n";
import { apdexDasFaixas, montarMapa, nomeLugar, resumoLugar, REGRA_APDEX_LUGAR, type LinhaApdexLugar, type LinhaLugar, type Lugar, type Mapa, type Saude } from "../lib/lugares";
import { MapaSvg, type BolhaMapa } from "./MapaSvg";

/** Visão geral: "Onde estão os clientes" (sessões) e "Onde acontecem os erros" (sessões com erro ou erros), por estado
    no Brasil e por país fora dele. Os números são as linhas "lugar" de qInicioPaginas (a mesma varredura das páginas,
    sem leitura a mais); a cor segue lib/lugares.ts (saudeDe): anel no mapa de sessões, preenchimento no de erros. Ação:
    clicar numa bolha ou numa linha aplica o filtro de país/região da aplicação inteira (clicar de novo, ou no "x" do
    filtro, tira); com o filtro, os mapas continuam com todos os lugares (lidos sem o filtro) e o escolhido marcado. */

export type FiltroLugar = { pais: string; regiao?: string };
interface Props {
  lugares: LinhaLugar[];
  /** filtro de segmento em uso (país e região), para marcar o lugar escolhido */
  filtro: { pais?: string; regiao?: string };
  /** aplica o filtro do lugar; o mesmo lugar de novo, ou null, tira o filtro de país e região */
  aoFiltrar: (f: FiltroLugar | null) => void;
  /** modo inicial do mapa de erros (a prévia abre direto em "erros") */
  modoErros?: ModoErros;
  /** Apdex por lugar (qApdexLugares): a cor do mapa de sessões; vazio = sem medição (sem cor) */
  apdexLugares?: LinhaApdexLugar[] | null;
  /** 1.43: os lugares são da última hora (escopo padrão da Visão geral); senão, do período escolhido */
  ultimaHora?: boolean;
}
type ModoErros = "sessoes" | "erros";
/** linhas da lista curta: 5 com o mapa em cima da lista, 8 com o mapa ao lado (cartão largo) */
const linhasCurta = (largo: boolean) => (largo ? 8 : 5);

const pctTexto = (p: number) => (p > 0 && p < 1 ? "<1%" : `${Math.round(p)}%`);
const pct = (a: number, b: number) => (b > 0 ? (100 * a) / b : 0);
const mesmoFiltro = (l: Lugar, f: { pais?: string; regiao?: string }) =>
  !!l.filtro && !!f.pais && f.pais === l.filtro.pais && (f.regiao ?? undefined) === (l.filtro.regiao ?? undefined);
/** Cor que vale em cada mapa: sessões = Apdex do lugar (desde 18/10/2026); erros = taxa de sessões com erro. */
const saudeNoMapa = (l: Lugar, erros: boolean): Saude => (erros ? l.saude : l.saudeApdex);
const anelDe = (l: Lugar, erros: boolean): BolhaMapa["anel"] => { const s = saudeNoMapa(l, erros); return s === "erro" ? "erro" : s === "atencao" ? "atencao" : null; };
/** Tom (cor de preenchimento) da bolha, do ponto da lista e da legenda: o mesmo nos dois mapas. */
const tomDe = (s: Saude): NonNullable<BolhaMapa["tom"]> => (s === "erro" ? "erro" : s === "atencao" ? "atencao" : s === "poucas" ? "sem" : "bom");
const siglaDe = (l: Lugar) => l.uf ?? l.pais;
const nota = (v: number) => v.toLocaleString(t("pt-BR", "en-US"), { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Os dois cartões dos mapas (cada um ocupa uma coluna da linha da Visão geral). */
export const CartoesMapas: React.FC<Props> = ({ lugares, filtro, aoFiltrar, modoErros = "sessoes", apdexLugares, ultimaHora = false }) => {
  const mapa = useMemo(() => montarMapa(lugares, apdexLugares ?? []), [lugares, apdexLugares]);
  if (mapa.total.sessoes === 0) return null;
  const filtroAtivo = filtro.pais ? (mapa.lugares.concat(mapa.porPais, mapa.semPosicao).find((l) => mesmoFiltro(l, filtro)) ?? null) : null;
  const nomeFiltro = filtro.pais ? (filtroAtivo ? nomeLugar(filtroAtivo) : filtro.regiao ?? filtro.pais) : null;
  return (
    <>
      <CartaoMapa tipo="sessoes" mapa={mapa} filtro={filtro} nomeFiltro={nomeFiltro} aoFiltrar={aoFiltrar} modoInicial="sessoes" apdexEscopo={apdexDasFaixas(apdexLugares ?? [])} />
      <CartaoMapa tipo="erros" mapa={mapa} filtro={filtro} nomeFiltro={nomeFiltro} aoFiltrar={aoFiltrar} modoInicial={modoErros} ultimaHora={ultimaHora} />
    </>
  );
};

const CartaoMapa: React.FC<{ tipo: "sessoes" | "erros"; mapa: Mapa; filtro: Props["filtro"]; nomeFiltro: string | null; aoFiltrar: Props["aoFiltrar"]; modoInicial: ModoErros; apdexEscopo?: { apdex: number | null; medicoes: number }; ultimaHora?: boolean }> = ({ tipo, mapa, filtro, nomeFiltro, aoFiltrar, modoInicial, apdexEscopo, ultimaHora = false }) => {
  const [modo, setModo] = useState<ModoErros>(modoInicial);
  const [todos, setTodos] = useState(false);
  // cartão largo (o mesmo corte do @container em styles.css): mapa ao lado da lista, mais alto; estreito: mapa em cima, mais baixo
  const ref = useRef<HTMLElement>(null);
  const [largo, setLargo] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const medir = (w: number) => setLargo(w >= 700);
    medir(el.clientWidth - 32);
    const ro = new ResizeObserver(([e]) => medir(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const erros = tipo === "erros";
  const valorDe = (l: Lugar) => (!erros ? l.sessoes : modo === "erros" ? l.erros : l.sessoesErro);
  // no Brasil por estado; com 5% ou mais das sessões fora do Brasil, por país (o Brasil numa bolha só)
  const base = mapa.escopo === "brasil" ? mapa.lugares : mapa.porPais;
  const ordem = [...base].filter((l) => valorDe(l) > 0).sort((a, b) => valorDe(b) - valorDe(a) || b.sessoes - a.sessoes);
  const semPosicao = mapa.semPosicao.filter((l) => valorDe(l) > 0);
  // app nativo não mede carga (duração 0): sem nenhum p75, a coluna "Carga" sai
  const comCarga = ordem.some((l) => l.p75Ms != null && l.p75Ms > 0);
  const totalValor = ordem.concat(semPosicao).reduce((s, l) => s + valorDe(l), 0);
  const selecionado = ordem.concat(semPosicao).find((l) => mesmoFiltro(l, filtro))?.chave ?? null;
  const clicar = (l: Lugar) => { if (l.filtro) aoFiltrar(l.filtro); };

  const bolhas: BolhaMapa[] = ordem.map((l) => ({
    chave: l.chave, forma: l.forma, centro: l.latitude != null && l.longitude != null ? [l.latitude, l.longitude] : null,
    rotulo: nomeLugar(l), sigla: siglaDe(l), valor: valorDe(l), cor: erros ? "erros" : "sessoes", anel: anelDe(l, erros), tom: tomDe(saudeNoMapa(l, erros)), lenta: !erros && l.lenta,
    detalhe: [erros ? (modo === "erros" ? t(`${formatarInt(l.erros)} erros`, `${formatarInt(l.erros)} errors`) : t(`${formatarInt(l.sessoesErro)} sessões com erro`, `${formatarInt(l.sessoesErro)} sessions with errors`)) : "", ...resumoLugar(l).split(" · ")].filter(Boolean),
    clicavel: !!l.filtro,
  }));
  // sem localização (o Dynatrace não recebeu IP público: acesso pela rede interna) entra na lista curta também; antes só
  // aparecia em "Ver todos". Caso comum: um ambiente de teste acessado só pela rede interna tem 0 sessões geolocalizadas,
  // embora a aplicação seja pública em produção.
  const visiveis = todos ? ordem.concat(semPosicao) : ordem.concat(semPosicao).slice(0, linhasCurta(largo));
  const resto = ordem.length + semPosicao.length - linhasCurta(largo);
  const sessoesSemLocal = semPosicao.reduce((s, l) => s + valorDe(l), 0);
  const qtdUfs = ordem.filter((l) => l.nivel === "uf").length, qtdPaises = new Set(ordem.filter((l) => l.nivel === "pais").map((l) => l.pais)).size;
  const contagem = [qtdUfs > 0 ? (qtdUfs === 1 ? t("1 estado", "1 state") : t(`${qtdUfs} estados`, `${qtdUfs} states`)) : null,
                    qtdPaises > 0 ? (qtdPaises === 1 ? t("1 país", "1 country") : t(`${qtdPaises} países`, `${qtdPaises} countries`)) : null,
                    sessoesSemLocal > 0 ? t(`${formatarInt(sessoesSemLocal)} sem localização`, `${formatarInt(sessoesSemLocal)} without location`) : null].filter(Boolean).join(" · ");

  return (
    <section ref={ref} className={`in-cartao ex-cartao ex-mapa${erros ? " ex-mapa-erros" : ""}`}>
      <div className="ex-cabecalho">
        <h3>{erros ? t("Onde acontecem os erros", "Where errors happen") : t("Onde estão os clientes", "Where customers are")}
          <span>{erros ? t("por estado e país · clique para filtrar", "by state and country · click to filter") : t("sessões por estado e país · clique para filtrar", "sessions by state and country · click to filter")}</span></h3>
        {nomeFiltro
          ? <span className="in-filtro-chip ex-filtro">{nomeFiltro}<button onClick={() => aoFiltrar(null)} aria-label={t("Tirar o filtro de lugar", "Clear the place filter")} title={t("Tirar o filtro de lugar", "Clear the place filter")}>×</button></span>
          : erros
            ? <div className="ex-modo" role="tablist" aria-label={t("O que o mapa de erros mostra", "What the error map shows")}>
                <button role="tab" aria-selected={modo === "sessoes"} className={modo === "sessoes" ? "ativo" : ""} onClick={() => setModo("sessoes")}>{t("Sessões com erro", "Sessions with errors")}</button>
                <button role="tab" aria-selected={modo === "erros"} className={modo === "erros" ? "ativo" : ""} onClick={() => setModo("erros")}>{t("Erros", "Errors")}</button>
              </div>
            : <span className="in-resumo">{contagem}</span>}
      </div>
      {erros && totalValor === 0
        ? <p className="painel-vazio ex-vazio">{ultimaHora ? t("Nenhuma sessão com erro na última hora.", "No session with errors in the last hour.") : t("Nenhuma sessão com erro neste período.", "No session with errors in this timeframe.")}</p>
        : <div className="ex-mapa-corpo">
            <div className="ex-mapa-area">
              <MapaSvg bolhas={bolhas} fator={largo ? 0.8 : 0.52} alturaMax={largo ? 360 : 260} selecionado={selecionado} enquadramento={mapa.escopo === "brasil" ? "brasil" : "dados"} aoClicar={(chave) => { const l = ordem.find((x) => x.chave === chave); if (l) clicar(l); }}
                       rotuloAria={erros ? t("Mapa das sessões com erro por estado e país", "Map of sessions with errors by state and country") : t("Mapa das sessões por estado e país", "Map of sessions by state and country")} />
              {bolhas.length === 0 && sessoesSemLocal > 0 && <p className="ex-sem-local">{t(`Nenhuma sessão com localização: o Dynatrace não recebeu um IP público destas sessões (acesso pela rede interna, como num ambiente de teste). As ${formatarInt(sessoesSemLocal)} sessões aparecem na lista como "Sem localização".`, `No session with a location: Dynatrace received no public IP for these sessions (access from the internal network, as in a test environment). The ${formatarInt(sessoesSemLocal)} sessions are listed as "No location".`)}</p>}
              <div className="ex-legenda">
                <span>{erros ? (modo === "erros" ? t("Tamanho: erros", "Size: errors") : t("Tamanho: sessões com erro", "Size: sessions with errors")) : t("Tamanho: sessões · cor: Apdex do lugar", "Size: sessions · color: place Apdex")}</span>
                {erros
                  ? <><span className="ex-leg tom-erro"><i />{t("25% ou mais das sessões com erro, ou 1,5x a média", "25% or more of sessions with errors, or 1.5x the average")}</span>
                      <span className="ex-leg tom-atencao"><i />{t("10% ou mais, ou 1,15x a média", "10% or more, or 1.15x the average")}</span>
                      <span className="ex-leg tom-bom"><i />{t("abaixo disso", "below that")}</span></>
                  : <><span className="ex-leg tom-bom"><i />{t(`Apdex ${nota(REGRA_APDEX_LUGAR.bom)} ou mais`, `Apdex ${nota(REGRA_APDEX_LUGAR.bom)} or more`)}</span>
                      <span className="ex-leg tom-atencao"><i />{t(`${nota(REGRA_APDEX_LUGAR.ruim)} a ${nota(REGRA_APDEX_LUGAR.bom - 0.01)}`, `${nota(REGRA_APDEX_LUGAR.ruim)} to ${nota(REGRA_APDEX_LUGAR.bom - 0.01)}`)}</span>
                      <span className="ex-leg tom-erro"><i />{t(`abaixo de ${nota(REGRA_APDEX_LUGAR.ruim)}`, `below ${nota(REGRA_APDEX_LUGAR.ruim)}`)}</span>
                      {ordem.concat(semPosicao).some((l) => l.apdex == null) && <span className="ex-leg tom-sem"><i />{t("sem medição de Apdex", "no Apdex measurement")}</span>}</>}
                {!erros && mapa.lugares.some((l) => l.lenta) && <span className="ex-leg lenta"><i />{t("carga p75 de 3 s ou mais", "load p75 of 3 s or more")}</span>}
              </div>
            </div>
            <div className="ex-lista">
              <table className="in-tabela compacta">
                <thead>{erros
                  ? <tr><th>{t("Lugar", "Place")}</th><th title={modo === "erros" ? t("Erros no lugar", "Errors in the place") : t("Sessões do lugar que tiveram pelo menos um erro", "Sessions in the place that had at least one error")}>{modo === "erros" ? t("Erros", "Errors") : t("Com erro", "With errors")}</th><th title={t("Fatia das sessões do lugar que tiveram erro", "Share of the place's sessions that had errors")}>{t("% do lugar", "% of place")}</th><th title={modo === "erros" ? t("Fatia de todos os erros do período", "Share of all errors in the timeframe") : t("Fatia de todas as sessões com erro do período", "Share of all sessions with errors in the timeframe")}>{t("% do total", "% of total")}</th></tr>
                  : <tr><th>{t("Lugar", "Place")}</th><th>{t("Sessões", "Sessions")}</th><th title={t("Apdex do lugar: Web Vitals das cargas web e ações, abertura, telas e crash do app (a mesma régua do cartão Experiência)", "Place Apdex: Web Vitals of web loads and actions, app start, screens and crashes of the app (the same scale as the Experience card)")}>Apdex</th>{comCarga && <th title={t("Tempo de carga (p75)", "Load time (p75)")}>{t("Carga", "Load")}</th>}</tr>}</thead>
                <tbody>
                  {visiveis.map((l) => {
                    const sel = l.chave === selecionado;
                    const s = saudeNoMapa(l, erros);
                    return (
                      <tr key={l.chave} className={`${sel ? "ex-sel" : ""}${l.filtro ? "" : " ex-sem-acao"}`} onClick={() => clicar(l)} tabIndex={l.filtro ? 0 : undefined}
                          onKeyDown={(e) => { if (e.key === "Enter") clicar(l); }}
                          title={l.filtro ? `${resumoLugar(l)} · ${sel ? t("clique para tirar o filtro", "click to clear the filter") : t("clique para filtrar a visão geral", "click to filter the overview")}` : resumoLugar(l)}>
                        <td><span className={`ex-ponto tom-${tomDe(s)}`} aria-hidden="true" />
                          <span className="ex-lugar">{nomeLugar(l)}</span>{l.nivel === "pais" && <span className="ex-sigla">{l.pais}</span>}</td>
                        {erros
                          ? <><td>{formatarInt(valorDe(l))}</td>
                              <td className={`ex-pct tom-${tomDe(s)}`} title={t(`${l.sessoes} sessões no lugar`, `${l.sessoes} sessions in the place`)}>{pctTexto(l.pctErro)}</td>
                              <td><span className="ex-parte"><span className="ex-parte-trilho" aria-hidden="true"><span style={{ width: `${Math.max(3, pct(valorDe(l), totalValor))}%` }} /></span><b>{pctTexto(pct(valorDe(l), totalValor))}</b></span></td></>
                          : <><td>{formatarInt(l.sessoes)}</td>
                              <td className={`ex-pct tom-${tomDe(s)}`} title={l.apdex != null ? t(`${formatarInt(l.medicoesApdex)} medições · ${pctTexto(l.pctErro)} das sessões com erro`, `${formatarInt(l.medicoesApdex)} measurements · ${pctTexto(l.pctErro)} of sessions with errors`) : t("sem medição de Apdex no período", "no Apdex measurement in the period")}>{l.apdex != null ? nota(l.apdex) : t("sem medição", "no measurement")}</td>
                              {comCarga && <td className={l.lenta ? "ex-lenta" : ""}>{l.p75Ms != null && l.p75Ms > 0 ? formatarMs(l.p75Ms) : ""}</td>}</>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {resto > 0 && <button className="pb-mais ex-mais" onClick={() => setTodos((v) => !v)}>{todos ? t("Mostrar só os principais", "Show only the top places") : t(`Ver todos os ${formatarInt(ordem.length + semPosicao.length)} lugares`, `See all ${formatarInt(ordem.length + semPosicao.length)} places`)}</button>}
              <p className="ex-media">{erros || !apdexEscopo || apdexEscopo.apdex == null
                ? t(`Média do escopo: ${pctTexto(mapa.mediaPctErro)} das sessões com erro`, `Scope average: ${pctTexto(mapa.mediaPctErro)} of sessions with errors`)
                : t(`Apdex do escopo: ${nota(apdexEscopo.apdex)} (${formatarInt(apdexEscopo.medicoes)} medições) · ${pctTexto(mapa.mediaPctErro)} das sessões com erro`, `Scope Apdex: ${nota(apdexEscopo.apdex)} (${formatarInt(apdexEscopo.medicoes)} measurements) · ${pctTexto(mapa.mediaPctErro)} of sessions with errors`)}</p>
            </div>
          </div>}
    </section>
  );
};
