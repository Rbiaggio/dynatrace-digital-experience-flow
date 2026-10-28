import React, { useEffect, useState } from "react";
import { InformationIcon, LogoutIcon, WarningIcon } from "@dynatrace/strato-icons";
import { Funil, Jornada } from "../lib/jornadas";
import { dql, num, qSaudeServicos } from "../lib/dql";
import { AppInfo, Grafo, idView, formatarInt, formatarMs, formatarPct, formatarPctFino } from "../lib/graph";
import { JourneyDrill } from "./JourneyDrill";
import { IconeJornada } from "./JourneyBar";
import { IconeTipo } from "./FlowGraph";
import { CabecalhoPainel, Carregando, Indicadores, RoscaPainel, Secao } from "./PainelBlocos";
import { t, localidade } from "../lib/i18n";

interface Props {
  jornada: Jornada;
  funil: Funil | null | undefined;      // undefined = calculando; null = erro
  erroFunil: string | null;
  grafo: Grafo;
  apps: AppInfo[];
  janela: string;
  robos: boolean;
  aoSelecionarNo: (id: string) => void;
  aoExcluir: () => void;
  aoFechar: () => void;
  aoAtualizarFunil?: () => void;       // ao abrir um "por quê" (sem aoFunilDoDrill): recalcula o funil, para funil e análise mostrarem o mesmo instante
  /** a linha do funil desta jornada na tela, se é de agora (até 30 s): o "Por quê?" usa a mesma em vez de ler de novo */
  funilRecente?: (qualquerIdade?: boolean) => { linha: Record<string, unknown> | undefined; desde: number } | null;
  /** o funil que o "Por quê?" leu, ou trouxe do cache junto com a análise: funil e análise mostram o mesmo instante */
  aoFunilDoDrill?: (linha: Record<string, unknown> | undefined, desde: number) => void;
  aoEditar?: () => void;               // reabre o compositor com as páginas desta jornada
  /** Flow esperando o backend do grafo: os serviços ainda não têm nome */
  backendPendente?: boolean;
  /** o backend carregou com falha (aviso no grafo): serviço fora do grafo fica sem nome e sem link */
  backendFalhou?: "ligacao" | "cadeia" | null;
}

/** Painel da jornada, no mesmo padrão do painel de detalhes e o mais simples possível:
    3 números (conversão, quem concluiu, quem se perdeu), o funil passo a passo com a perda ENTRE os passos e um "Why?"
    em cada perda, que abre a análise (erro explica? para onde foram? sessões). Vermelho só para perda depois de erro. */
export const JourneyPanel: React.FC<Props> = ({ jornada, funil, erroFunil, grafo, apps, janela, robos, aoSelecionarNo, aoExcluir, aoFechar, aoAtualizarFunil, funilRecente, aoFunilDoDrill, aoEditar, backendPendente, backendFalhou }) => {
  const [perdaAberta, setPerdaAberta] = useState<number | null>(null);
  const [saude, setSaude] = useState<Map<string, { n: number; falhas: number; rtMs: number | null }> | null>(null);
  const nomeApp = (id: string) => apps.find((a) => a.id === id)?.nome ?? id;
  const multiApp = new Set(jornada.passos.map((p) => p.app)).size > 1;
  const noDe = (app: string, view: string) => grafo.nos.find((n) => n.id === idView(app, view));
  const noGrafo = new Set(grafo.nos.map((n) => n.id));
  const servicos = jornada.servicos.map((id) => grafo.nos.find((n) => n.id === id) ?? { id, nome: id, tipo: "servico" as const, chamadas: 0 });
  const foraDoGrafo = servicos.some((s) => !noGrafo.has(s.id));
  const chaveServicos = jornada.servicos.filter((i) => i.startsWith("SERVICE-")).sort().join(",");
  const abrir = (k: number) => { const novo = perdaAberta === k ? null : k; setPerdaAberta(novo); if (novo != null && !aoFunilDoDrill) aoAtualizarFunil?.(); };

  useEffect(() => { setPerdaAberta(null); }, [jornada.id]);
  useEffect(() => {
    setSaude(null);
    if (!chaveServicos) return;
    let vivo = true;
    dql(qSaudeServicos(chaveServicos.split(","), janela), { contexto: "funil/JPN-01" }).then((l) => {
      if (vivo) setSaude(new Map(l.map((x) => [String(x.servico), { n: num(x.n), falhas: num(x.falhas), rtMs: x.rt_us == null ? null : num(x.rt_us) / 1000 }])));
    }).catch(() => { if (vivo) setSaude(new Map()); });
    return () => { vivo = false; };
  }, [chaveServicos, janela]);

  const perdidos = funil ? Math.max(0, funil.entraram - funil.concluiram) : 0;
  const perdidosComErro = funil ? funil.passos.slice(1).reduce((t, p) => t + p.dropOffComErro, 0) : 0;
  const maiorPerda = funil && funil.passos.length > 1 ? funil.passos.slice(1).reduce((a, b) => (b.dropOff > a.dropOff ? b : a)) : null;

  return (
    <aside className="painel dp painel-jornada">
      <CabecalhoPainel icone={<IconeJornada />} tipo={t("JORNADA", "JOURNEY")} titulo={jornada.nome}
        sub={<span className="jf-trilha">{jornada.passos.map((p, i) => <React.Fragment key={`${p.app}|${p.view}`}>{i > 0 && " → "}<b>{i + 1}</b> {p.view}</React.Fragment>)}</span>}
        acoes={<>{aoEditar && <button className="botao-leve" onClick={aoEditar} title={t("Incluir, tirar ou reordenar páginas e renomear", "Add, remove or reorder pages and rename")}>{t("Editar passos", "Edit steps")}</button>}<button className="botao-leve" onClick={aoExcluir}>{t("Excluir", "Delete")}</button></>}
        aoFechar={aoFechar} tituloFechar={t("Voltar ao painel de detalhes", "Back to the details panel")} />

      {funil === undefined ? <p className="painel-vazio" style={{ marginTop: 12 }}>{t("Calculando o funil…", "Calculating the funnel…")}</p>
        : funil === null ? <p className="painel-erro" style={{ marginTop: 12 }}>{t("Não deu para calcular o funil", "Could not calculate the funnel")}{erroFunil ? `: ${erroFunil}` : ""}</p>
        : <Indicadores
            rosca={<RoscaPainel pct={funil.conversao} tom="fluxo" rotulo={formatarPct(funil.conversao)} titulo={t(`Conversão: ${formatarPct(funil.conversao)} chegaram ao último passo`, `Conversion: ${formatarPct(funil.conversao)} reached the last step`)} />}
            numero={formatarInt(funil.concluiram)} rotulo={t("concluíram a jornada", "completed the journey")} sub={t(`de ${formatarInt(funil.entraram)} que começaram`, `of ${formatarInt(funil.entraram)} that started`)}
            linhas={[
              { icone: <LogoutIcon size={16} />, valor: formatarInt(perdidos), texto: t("se perderam no caminho", "were lost along the way") },
              { icone: <WarningIcon size={16} />, valor: formatarInt(perdidosComErro), texto: perdidosComErro > 0 ? t("se perderam depois de um erro", "were lost after an error") : t("se perderam depois de um erro (nenhum)", "were lost after an error (none)"), critico: perdidosComErro > 0 },
            ]} />}

      <Secao titulo={<span className="jf-titulo-info">{t("Funil", "Funnel")} <span title={t("Uma sessão só conta num passo se fez os passos anteriores, em ordem. Clique em Por quê? numa perda para ver se um erro explica, para onde esses clientes foram e as sessões.", "A session counts in a step only if it did the previous steps, in order. Click Why? on a loss to see if an error explains it, where those users went and their sessions.")} aria-label={t("Como o funil é calculado", "How the funnel is calculated")}><InformationIcon size={13} /></span></span>}>
        <ol className="jf-passos">
          {jornada.passos.map((p, i) => {
            const f = funil?.passos[i];
            const n = noDe(p.app, p.view);
            const prox = funil?.passos[i + 1];
            const k = i + 1;
            const aberta = perdaAberta === k;
            return (
              <React.Fragment key={`${p.app}|${p.view}`}>
                <li className="jf-passo">
                  <div className="jf-passo-topo">
                    <span className="jf-num">{i + 1}</span>
                    <span className="jf-tela">{n ? <button className="painel-link" onClick={() => aoSelecionarNo(n.id)} title={p.view}>{p.view}</button> : p.view}
                      {multiApp && <span className="jf-app"> · {nomeApp(p.app)}</span>}</span>
                    <span className="jf-valor">{f ? <><b>{formatarInt(f.sessoes)}</b>{i > 0 && <span>{formatarPct(f.pctInicio)}</span>}</> : "…"}</span>
                  </div>
                  <div className="dp-barra-trilho"><span style={{ width: `${f ? Math.max(1.5, f.pctInicio) : 0}%` }} /></div>
                  {f && f.erros > 0 && <span className="jf-meta">{formatarInt(f.erros)} {f.erros === 1 ? t("erro nesta página", "error on this page") : t("erros nesta página", "errors on this page")}</span>}
                </li>
                {prox && i < jornada.passos.length - 1 && (
                  prox.dropOff === 0
                    ? <li className="jf-perda zero"><span className="jf-seta">↓</span>{t("todos seguiram", "everyone continued")}</li>
                    : <li className={`jf-perda${aberta ? " aberta" : ""}`}>
                        <button className="jf-perda-linha" onClick={() => abrir(k)} aria-expanded={aberta}>
                          <span className="jf-seta">↓</span>
                          <span><b>{formatarInt(prox.dropOff)}</b> {t("saíram", "left")} ({formatarPct(f && f.sessoes ? (100 * prox.dropOff) / f.sessoes : 0)})
                            {prox.dropOffComErro > 0 && <span className="erro"> · {formatarInt(prox.dropOffComErro)} {t("depois de um erro", "after an error")}</span>}</span>
                          {maiorPerda && maiorPerda.view === prox.view && maiorPerda.app === prox.app && jornada.passos.length > 2 && <span className="jf-pior">{t("maior perda", "biggest loss")}</span>}
                          <span className="jf-porque">{aberta ? t("Ocultar", "Hide") : t("Por quê?", "Why?")}</span>
                        </button>
                        {aberta && <JourneyDrill passos={jornada.passos} k={k} janela={janela} robos={robos} apps={apps} funilRecente={funilRecente} aoFunil={aoFunilDoDrill} />}
                      </li>
                )}
              </React.Fragment>
            );
          })}
        </ol>
      </Secao>

      <Secao titulo={t("Backend relacionado", "Related backend")} recolhivel fechada extra={servicos.length > 0 ? <span className="dp-aba-contagem">{servicos.length}</span> : undefined}>
        {servicos.length > 0 && backendPendente ? <Carregando texto={t("Ligando as páginas aos serviços do backend…", "Linking pages to backend services…")} />
          : servicos.length === 0 ? <p className="painel-vazio">{t("Nenhum serviço escolhido nesta jornada.", "No service selected in this journey.")}</p> : (<>
          {backendFalhou === "cadeia" && foraDoGrafo && <p className="painel-vazio">{t("O backend não carregou neste período: os nomes dos serviços não vieram (veja o aviso no grafo).", "The backend did not load for this timeframe: the service names are missing (see the notice on the graph).")}</p>}
          <ul className="dp-vizinhos">
            {servicos.map((s) => {
              const sv = saude?.get(s.id), pf = sv && sv.n > 0 ? (100 * sv.falhas) / sv.n : null;
              return (
                <li key={s.id} className="dp-vizinho">
                  <span className="dp-vizinho-icone"><IconeTipo no={s as never} tamanho={16} /></span>
                  <span className="dp-vizinho-nome">{noGrafo.has(s.id) ? <button className="painel-link" onClick={() => aoSelecionarNo(s.id)}>{s.nome}</button>
                    : <span title={t("Fora do grafo agora", "Not in the graph right now")}>{s.nome}</span>}</span>
                  <span className="dp-vizinho-meta">{sv ? <>{formatarInt(sv.n)} req · <span className={pf && pf > 0 ? "erro" : ""}>{formatarPctFino(pf)} {t("com falha", "failed")}</span>{sv.rtMs != null ? ` · ${formatarMs(sv.rtMs)}` : ""}</> : `${formatarInt(s.chamadas)} req`}</span>
                </li>
              );
            })}
          </ul>
        </>)}
      </Secao>

      <p className="dp-nota">{t("Criada em", "Created on")} {new Date(jornada.criadaEm).toLocaleString(localidade())}.</p>
    </aside>
  );
};
