import React, { useEffect, useState } from "react";
import { dql, texto, num } from "../lib/dql";
import { formatarInt } from "../lib/graph";
import { t } from "../lib/i18n";
import { CAMBIO_PADRAO, CONFIG_PRECOS_VAZIA, HORAS_PARA_PROJETAR, PARTES_CONSUMO, emReais, lerNumero, lerPrecos, partesNaLista, precoDeLista, precosEfetivos, qConsumoPorFuncionalidade,
         qConsumoPorHora, resumirConsumo, salvarPrecos, totalEmReais, type ConfigPrecos, type ParteConsumo, type Precos, type ResumoConsumo } from "../lib/consumo";

/** Cartão "Consumo do app" da Configuração (1.44.3): o que o app consumiu de verdade, pela cobrança da Dynatrace
    (lib/consumo.ts), hoje, nos últimos 7 dias e projetado para 30 dias, em quantidade e em reais pelos preços que o
    administrador digita (guardados no App State; o preço é do contrato de cada cliente) ou, sem eles, pelo preço de lista
    da Dynatrace convertido pelo câmbio (1.44.4). Ao lado, as consultas das
    últimas 24 horas por funcionalidade. Lê só ao abrir a Configuração (poucos MB de dt.system.events). */
const ROTULO_PARTE: Record<ParteConsumo, [string, string]> = {
  consulta: ["Consultas", "Queries"], gravacao: ["Gravação", "Ingest"], retencao: ["Retenção", "Retention"], funcao: ["Funções", "Functions"],
};
const UNIDADE_PRECO: Record<ParteConsumo, [string, string]> = {
  consulta: ["por GiB lido", "per GiB read"], gravacao: ["por GiB gravado", "per GiB ingested"], retencao: ["por GiB-dia guardado", "per GiB-day retained"], funcao: ["por mil execuções", "per thousand runs"],
};
/** Nome de cada funcionalidade (o contexto "def/<funcionalidade>/..." de cada consulta). */
const FUNCIONALIDADE: Record<string, [string, string]> = {
  base: ["Grafo e números ao vivo", "Graph and live numbers"], inicio: ["Visão geral", "Overview"], painel: ["Painel da página", "Page panel"],
  agregador: ["Workflow (fatias, sessões, hora em hora)", "Workflow (slices, sessions, hourly)"], prereq: ["Conferência dos pré-requisitos", "Prerequisite checks"],
  config: ["Configuração", "Configuration"], backend: ["Backend e ligação página → serviço", "Backend and page → service link"], funil: ["Jornadas (funis)", "Journeys (funnels)"],
  apdex: ["Apdex", "Apdex"], qualidade: ["Qualidade do dado", "Data quality"], porque: ["Por quê?", "Why?"], isolar: ["Isolar", "Isolate"],
  sessoes: ["Lista de sessões", "Session list"], ia: ["Dynatrace Assist", "Dynatrace Assist"], filtros: ["Valores dos filtros", "Filter values"],
  llm: ["Análise por LLM", "LLM analysis"], ondefalha: ["Onde falha no backend?", "Where does it fail in the backend?"], outras: ["Outras", "Other"],
};
/** Em reais; abaixo de 1 centavo, com 4 casas (o valor de verdade, não "menos de"). */
const reais = (v: number | null) => v == null ? "" : v > 0 && v < 0.00005 ? t("< R$ 0,0001", "< R$0.0001") : v.toLocaleString(t("pt-BR", "en-US"), { style: "currency", currency: "BRL", minimumFractionDigits: v > 0 && v < 0.01 ? 4 : 2, maximumFractionDigits: v > 0 && v < 0.01 ? 4 : 2 });
const dec = (n: number, casas: number) => n.toLocaleString(t("pt-BR", "en-US"), { minimumFractionDigits: casas, maximumFractionDigits: casas });
const bytes = (gib: number) => gib >= 1 ? `${dec(gib, gib >= 100 ? 0 : 2)} GiB` : gib * 1024 >= 1 ? `${dec(gib * 1024, 0)} MB` : gib > 0 ? `${dec(gib * 1024 * 1024, 0)} KB` : "0";
/** A quantidade de cada parte com a unidade dela. */
const quantidade = (p: ParteConsumo, q: number) => p === "funcao" ? t(`${formatarInt(Math.round(q * 1000))} execuções`, `${formatarInt(Math.round(q * 1000))} runs`)
  : p === "retencao" ? `${dec(q, q >= 10 ? 1 : 3)} GiB-${t("dia", "day")}` : bytes(q);
const horaDe = (ms: number) => new Date(ms).toLocaleTimeString(t("pt-BR", "en-US"), { hour: "2-digit", minute: "2-digit" });

export const ConsumoApp: React.FC<{ appId: string }> = ({ appId }) => {
  const [resumo, setResumo] = useState<ResumoConsumo | null>(null);
  const [funcs, setFuncs] = useState<{ f: string; gib: number; consultas: number }[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [config, setConfig] = useState<ConfigPrecos>(CONFIG_PRECOS_VAZIA);
  const [rascunho, setRascunho] = useState<Record<ParteConsumo | "cambio", string>>({ consulta: "", gravacao: "", retencao: "", funcao: "", cambio: "" });
  const [editando, setEditando] = useState(false);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    let vivo = true;
    const agora = Date.now(), meiaNoite = new Date(new Date(agora).setHours(0, 0, 0, 0)).getTime();
    Promise.all([
      dql(qConsumoPorHora(appId, agora - 7 * 86400_000), { contexto: "config/CFG-06", maxRecords: 5000 }),
      dql(qConsumoPorFuncionalidade(appId, agora - 86400_000), { contexto: "config/CFG-07", maxRecords: 100 }),
    ]).then(([h, f]) => {
      if (!vivo) return;
      setResumo(resumirConsumo(h.map((l) => ({ parte: texto(l.parte) ?? "", hora: texto(l.hora) ?? "", bytes: num(l.bytes), execucoes: num(l.execucoes), primeiro: texto(l.primeiro), ultimo: texto(l.ultimo) })), agora, meiaNoite));
      setFuncs(f.map((l) => ({ f: texto(l.funcionalidade) ?? "outras", gib: num(l.bytes) / 1024 ** 3, consultas: num(l.consultas) })));
    }).catch((ex) => { if (vivo) setErro(ex instanceof Error ? ex.message : String(ex)); });
    lerPrecos().then((c) => {
      if (!vivo) return;
      setConfig(c);
      const txt = (n: number | null) => (n == null ? "" : String(n).replace(".", t(",", ".")));
      setRascunho({ ...Object.fromEntries(PARTES_CONSUMO.map((x) => [x, txt(c.contrato[x])])), cambio: txt(c.cambio) } as Record<ParteConsumo | "cambio", string>);
    });
    return () => { vivo = false; };
  }, [appId]);

  const precos = precosEfetivos(config);
  const naLista = partesNaLista(config);
  const cambio = config.cambio ?? CAMBIO_PADRAO;
  const salvar = async () => {
    const novo: ConfigPrecos = { contrato: Object.fromEntries(PARTES_CONSUMO.map((p) => [p, lerNumero(rascunho[p])])) as Precos, cambio: lerNumero(rascunho.cambio) };
    setSalvando(true);
    try { await salvarPrecos(novo); setConfig(novo); setEditando(false); }
    catch (ex) { setErro(ex instanceof Error ? ex.message : String(ex)); }
    finally { setSalvando(false); }
  };
  const semPermissao = !!erro && /403|permission|PERMISSION|not allowed|forbidden/i.test(erro);
  const celula = (p: ParteConsumo, q: Record<ParteConsumo, number | null>) => {
    const v = q[p];
    if (v == null) return <td><span className="cs-nota">{t(`aguarda ${HORAS_PARA_PROJETAR} h de dados (há ${formatarInt(Math.floor(resumo?.horas[p] ?? 0))} h)`, `needs ${HORAS_PARA_PROJETAR} h of data (${formatarInt(Math.floor(resumo?.horas[p] ?? 0))} h so far)`)}</span></td>;
    return <td><span className="cs-valor">{reais(emReais(v, precos[p]))}</span><small>{quantidade(p, v)}</small></td>;
  };

  return (
    <section className="cfg-cartao cfg-consumo">
      <div className="cfg-cartao-topo">
        <h3>{t("Consumo do app", "App consumption")}</h3>
        {resumo?.ultimo != null && <span className="cfg-contagem">{t(`cobrança da Dynatrace até ${horaDe(resumo.ultimo)}`, `Dynatrace billing up to ${horaDe(resumo.ultimo)}`)}</span>}
      </div>
      {semPermissao ? <p className="painel-erro config-permissao">{t("Sem permissão para ler a cobrança da Dynatrace (storage:system:read). Peça a um administrador.", "No permission to read Dynatrace billing (storage:system:read). Ask an administrator.")}</p>
        : erro ? <p className="painel-erro">{t("Erro ao ler o consumo", "Error reading consumption")}: {erro}</p>
        : !resumo ? <p className="painel-vazio">{t("lendo a cobrança…", "reading billing…")}</p>
        : (
          <div className="cs-grade">
            <div className="cs-tabela-area">
              <table className="cs-tabela">
                <thead><tr><th></th><th>{t("Hoje", "Today")}</th><th>{t("Últimos 7 dias", "Last 7 days")}</th><th>{t("Projeção de 30 dias", "30-day projection")}</th></tr></thead>
                <tbody>
                  {PARTES_CONSUMO.map((p) => (
                    <tr key={p}><th>{t(...ROTULO_PARTE[p])}</th>{celula(p, resumo.hoje)}{celula(p, resumo.periodo)}{celula(p, resumo.mes)}</tr>
                  ))}
                  <tr><th>{t("Workflow", "Workflow")}</th><td colSpan={3}><span className="cs-nota">{t("sem cobrança por hora: é um workflow simples (as execuções estão em Funções)", "no hourly charge: it is a simple workflow (its runs are under Functions)")}</span></td></tr>
                  <tr className="cs-total"><th>{t("Total", "Total")}</th><td>{reais(totalEmReais(resumo.hoje, precos))}</td><td>{reais(totalEmReais(resumo.periodo, precos))}</td><td>{totalEmReais(resumo.mes, precos) == null ? <span className="cs-nota">{t("com todas as partes projetadas", "once every part is projected")}</span> : reais(totalEmReais(resumo.mes, precos))}</td></tr>
                </tbody>
              </table>
              <p className="cfg-rodape">{t(`A projeção segue o ritmo de cada parte nos últimos até 7 dias, a partir de ${HORAS_PARA_PROJETAR} h de dados; a retenção é o volume guardado nos buckets do app.`,
                `The projection follows each part's pace over up to the last 7 days, from ${HORAS_PARA_PROJETAR} h of data on; retention is the volume kept in the app's buckets.`)}</p>
              {editando ? (
                <div className="cs-precos">
                  <p className="cfg-acao-nota">{t("Preços do seu contrato em reais, na unidade de cada linha; em branco, vale o preço de lista. Ficam guardados no app.", "Your contract prices in BRL, in each line's unit; left blank, the list price applies. They are kept in the app.")}</p>
                  {PARTES_CONSUMO.map((p) => (
                    <label key={p}><span>{t(...ROTULO_PARTE[p])}</span>
                      <input inputMode="decimal" value={rascunho[p]} onChange={(e) => setRascunho((r) => ({ ...r, [p]: e.target.value }))} placeholder={dec(precoDeLista(p, lerNumero(rascunho.cambio)), 4)} aria-label={`${t(...ROTULO_PARTE[p])} ${t(...UNIDADE_PRECO[p])}`} />
                      <small>{t("R$ ", "R$ ")}{t(...UNIDADE_PRECO[p])}{t(" · lista: ", " · list: ")}{reais(precoDeLista(p, lerNumero(rascunho.cambio)))}</small></label>
                  ))}
                  <label><span>{t("Câmbio", "Exchange rate")}</span>
                    <input inputMode="decimal" value={rascunho.cambio} onChange={(e) => setRascunho((r) => ({ ...r, cambio: e.target.value }))} placeholder={dec(CAMBIO_PADRAO, 2)} aria-label={t("Câmbio, reais por dólar", "Exchange rate, BRL per USD")} />
                    <small>{t("R$ por US$, só para o preço de lista", "BRL per USD, only for the list price")}</small></label>
                  <div className="config-acoes">
                    <button className="botao-primario" disabled={salvando} onClick={salvar}>{salvando ? t("salvando…", "saving…") : t("Salvar preços", "Save prices")}</button>
                    <button className="botao-leve" onClick={() => setEditando(false)}>{t("Cancelar", "Cancel")}</button>
                  </div>
                </div>
              ) : (
                <p className="cs-aviso-preco">
                  {naLista.length === PARTES_CONSUMO.length ? t(`Preço de lista da Dynatrace (US$ × R$ ${dec(cambio, 2)}). Atualize para o preço do seu contrato.`, `Dynatrace list price (USD × R$ ${dec(cambio, 2)}). Update it to your contract pricing.`)
                    : naLista.length ? t(`${naLista.length} de ${PARTES_CONSUMO.length} linhas no preço de lista da Dynatrace (US$ × R$ ${dec(cambio, 2)}); as outras, no do contrato.`, `${naLista.length} of ${PARTES_CONSUMO.length} lines at the Dynatrace list price (USD × R$ ${dec(cambio, 2)}); the others at contract pricing.`)
                    : t("Preços do contrato.", "Contract pricing.")}
                  {" "}<button className="painel-link" onClick={() => setEditando(true)}>{t("Editar preços", "Edit prices")}</button>
                </p>
              )}
            </div>
            <div className="cs-func">
              <h4>{t("Consultas por funcionalidade, últimas 24 h", "Queries by feature, last 24 h")}</h4>
              {!funcs?.length ? <p className="painel-vazio">{t("Nenhuma consulta nas últimas 24 h.", "No query in the last 24 h.")}</p> : (
                <ul>
                  {funcs.map((x) => {
                    const total = funcs.reduce((s, y) => s + y.gib, 0) || 1;
                    return (
                      <li key={x.f}>
                        <span className="cs-func-nome">{FUNCIONALIDADE[x.f] ? t(...FUNCIONALIDADE[x.f]) : x.f}</span>
                        <span className="cs-func-barra"><i style={{ width: `${Math.max(2, (x.gib / total) * 100)}%` }} /></span>
                        <span className="cs-func-valor">{reais(emReais(x.gib, precos.consulta)) || bytes(x.gib)}<small>{x.consultas === 1 ? t("1 consulta", "1 query") : t(`${formatarInt(x.consultas)} consultas`, `${formatarInt(x.consultas)} queries`)}</small></span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        )}
    </section>
  );
};
