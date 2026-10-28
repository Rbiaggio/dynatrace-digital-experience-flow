import React, { useEffect, useMemo, useState } from "react";
import { dql, texto, num, passosEmUso, qPaginasPorAplicacao } from "../lib/dql";
import { clientePlataforma } from "../lib/plataforma";
import { BUCKETS_PASSOS, BUCKET_AGREGADOS, BUCKET_ERROS, BUCKET_HORAS, RETENCAO_PASSOS, RETENCAO_AGREGADOS, RETENCAO_ERROS, RETENCAO_HORAS, copiaDividida, EstadoPrereq, PassoResultado, aplicar, lerEstado } from "../lib/prerequisitos";
import { definicoesWorkflows, TAREFAS_WORKFLOW, ATRASO_ACEITO_MS, CONTROLE_DA_TAREFA, qControlesWorkflows, ultimasExecucoes, intentCriarWorkflow, INTENT_CRIAR_WORKFLOW, acharWorkflow, ESPERA_PRIMEIRA_EXECUCAO_MS, type WorkflowAchado } from "../lib/workflows";
import { getAppId } from "@dynatrace-sdk/app-environment";
import { sendIntent } from "@dynatrace-sdk/navigation";
import { formatarInt } from "../lib/graph";
import { salvarHabilitadas } from "../lib/habilitadas";
import { gravarCopiaDesde } from "../lib/copiaDesde";
import { ConsumoApp } from "./ConsumoApp";
import { lerIdsMobile, gravarIdsMobile } from "../lib/idsMobile";
import { lerModoAtualizacao, gravarModoAtualizacao, type ModoAtualizacao } from "../lib/atualizacao";
import { t } from "../lib/i18n";

/** id = valor de dt.rum.application.id (web: id da entidade em minúsculas; mobile: UUID; null = mobile sem eventos).
    avulsa = está no roteamento mas não foi achada entre as aplicações dos últimos 30 dias (aparece para poder desmarcar). */
interface AppRum { id: string | null; entidade: string; nome: string; tipo: "web" | "mobile"; avulsa?: boolean }

/** Tela de Configuração (admin), 1.44.0: a janela toda. No alto, a situação do tenant numa faixa; embaixo, em três colunas,
    as aplicações (busca, marcar e desmarcar), o Aplicar (só o que será criado ou configurado; onde ficam as regras o app
    decide) e os três workflows (estado pelo registro de controle; o JSON para importar só no que falta). O detalhe do que o app grava fica recolhido; a explicação completa
    está na aba Documentação › Pré-requisitos. Usa a permissão do usuário logado: quem não tem permissão de Settings e
    buckets vê a situação, mas o "Aplicar" devolve o erro do servidor. */
export const ConfigPanel: React.FC<{ aoFechar: () => void; aoAplicar?: (apps: string[]) => void }> = ({ aoFechar, aoAplicar }) => {
  const [estado, setEstado] = useState<EstadoPrereq | null>(null);
  const [apps, setApps] = useState<AppRum[] | null>(null);
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [paginas, setPaginas] = useState<Record<string, number>>({});
  const [resultado, setResultado] = useState<PassoResultado[] | null>(null);
  const [rodando, setRodando] = useState<"" | "validar" | "aplicar">("");
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  // 1.45.3: a aplicação mobile sem UUID conhecido tem o UUID buscado ao ser marcada (uma consulta, só dela)
  const [buscandoId, setBuscandoId] = useState<string | null>(null);
  const [semEventos, setSemEventos] = useState<Set<string>>(new Set());
  // onde ficam as regras do DEF (o app decide, sem perguntar): "" = pipeline próprio; objectId = dentro de um pipeline de
  // user.events que já existe
  const [destino, setDestino] = useState<string>("");
  // os workflows pelo registro de controle mais recente de cada tarefa no bucket de agregados (R$ 0,00...)
  const [controles, setControles] = useState<Record<string, { ultimo: number; execucoes: number; bytes: number }> | null>(null);
  // o workflow do DEF pela API de workflows (undefined = lendo; null = não existe; "sem-permissao" = sem leitura de workflows)
  const [workflow, setWorkflow] = useState<WorkflowAchado | null | "sem-permissao" | undefined>(undefined);
  const appId = useMemo(() => { try { return getAppId(); } catch { return "my.digital.experience.flow"; } }, []);
  // 1.46.0: como os números se atualizam (lib/atualizacao.ts), para todos os usuários
  const [modo, setModo] = useState<ModoAtualizacao | null>(null);
  const [avisoModo, setAvisoModo] = useState<{ ok: boolean; texto: string } | null>(null);
  useEffect(() => { let vivo = true; lerModoAtualizacao().then((m) => { if (vivo) setModo(m); }); return () => { vivo = false; }; }, []);
  const trocarModo = async (m: ModoAtualizacao) => {
    if (m === modo) return;
    const antes = modo;
    setModo(m); setAvisoModo(null);
    if (await gravarModoAtualizacao(m)) setAvisoModo({ ok: true, texto: t("Salvo. Vale para quem abrir o app a partir de agora.", "Saved. It applies to whoever opens the app from now on.") });
    else { setModo(antes); setAvisoModo({ ok: false, texto: t("Sem permissão para gravar o estado do app: nada mudou.", "No permission to write the app state: nothing changed.") }); }
  };

  const carregar = async () => {
    setErro(null);
    try {
      const [e, web, mobile] = await Promise.all([
        lerEstado(clientePlataforma),
        // 30 dias: sem janela, só vêm as aplicações com atividade nas últimas horas (mobile parado sumia da lista e
        // continuava ligado no roteamento sem como desmarcar)
        dql("fetch dt.entity.application, from: now()-30d | fields id, nome = entity.name | sort nome | limit 500", { contexto: "config/CFG-01", maxRecords: 500 }),
        dql("fetch dt.entity.mobile_application, from: now()-30d | fields id, nome = entity.name | sort nome | limit 500", { contexto: "config/CFG-02", maxRecords: 500 }),
      ]);
      // mobile: o RUM grava em dt.rum.application.id o applicationId (UUID), não o id da entidade como na web, e nenhuma
      // fonte grátis tem o par. 1.45.3: o UUID achado fica no App State (lib/idsMobile.ts, não muda); os que faltam saem
      // numa leitura só da cópia do DEF (as aplicações já habilitadas); o user.events (pago) só é lido quando o
      // administrador marca uma aplicação mobile sem UUID (marcarMobileSemId), só dela. Antes eram até duas consultas por
      // aplicação mobile a cada abertura (com muitas aplicações, dezenas de consultas por abertura).
      const idsMobile = await lerIdsMobile();
      const faltam = mobile.map((l) => texto(l.id)).filter((x): x is string => !!x && !idsMobile[x]);
      if (faltam.length) {
        try {
          const c = await dql(`fetch bizevents, from: now()-1d, bucket: {"${BUCKETS_PASSOS.nav}", "${BUCKETS_PASSOS.erro}"} | filter in(dt.rum.application.entity, array(${faltam.map((x) => `"${x}"`).join(", ")})) | summarize id = takeFirst(dt.rum.application.id), by:{entidade = dt.rum.application.entity}`, { contexto: "config/CFG-03C", maxRecords: 500 });
          let novos = 0;
          for (const l of c) { const ent = texto(l.entidade), id = texto(l.id); if (ent && id) { idsMobile[ent] = id; novos++; } }
          if (novos) void gravarIdsMobile(idsMobile);
        } catch { /* sem a cópia ainda: o UUID sai ao marcar a aplicação */ }
      }
      const lista: AppRum[] = [
        ...web.map((l) => ({ id: texto(l.id)!.replace(/^APPLICATION-/i, "").toLowerCase(), entidade: texto(l.id)!, nome: texto(l.nome) ?? texto(l.id)!, tipo: "web" as const })),
        ...mobile.map((l) => ({ id: idsMobile[texto(l.id)!] ?? null, entidade: texto(l.id)!, nome: texto(l.nome) ?? texto(l.id)!, tipo: "mobile" as const })),
      ];
      // habilitadas no roteamento que não estão na lista: entram como linha própria, para o administrador ver e desmarcar
      const conhecidas = new Set(lista.map((a) => a.id).filter(Boolean));
      for (const id of e.appsHabilitadas) if (!conhecidas.has(id)) lista.push({ id, entidade: "", nome: t("não encontrada nos últimos 30 dias", "not found in the last 30 days"), tipo: id.includes("-") ? "mobile" : "web", avulsa: true });
      setEstado(e); setApps(lista); setMarcadas(new Set(e.appsHabilitadas));
      acharWorkflow(clientePlataforma, appId).then(setWorkflow, () => setWorkflow("sem-permissao"));
      dql(qControlesWorkflows(), { contexto: "config/CFG-05", maxRecords: 10 })
        .then((ls) => setControles(ultimasExecucoes(ls.map((l) => ({ k: texto(l.k) ?? "", ultimo: texto(l.ultimo), exec_max: texto(l.exec_max), execucoes: num(l.execucoes), bytes: num(l.bytes_3h) })))))
        .catch(() => setControles({}));
      // padrão seguro: onde já estão as regras; senão, se o tenant já roteia user.events para outro pipeline, dentro dele
      setDestino(e.hospedeiro?.objectId ?? (e.pipelineEventos ? "" : e.rotasCliente[0]?.pipelineId ?? ""));
      // cardinalidade de páginas das aplicações já habilitadas (varre só as navegações da cópia enxuta): acima de 200, revisar
      // nomes de view
      if (e.appsHabilitadas.length && passosEmUso()) {
        const c = await dql(qPaginasPorAplicacao(), { contexto: "config/CFG-04", maxRecords: 500 });
        setPaginas(Object.fromEntries(c.map((l) => [texto(l["dt.rum.application.id"]) ?? "", num(l.paginas)])));
      }
    } catch (ex) { setErro(ex instanceof Error ? ex.message : String(ex)); }
  };
  useEffect(() => { carregar(); }, []);

  const executar = async (validarApenas: boolean) => {
    setRodando(validarApenas ? "validar" : "aplicar"); setResultado(null); setErro(null);
    try {
      // 1.47.4: instalação nova (o bucket da cópia ainda não existe): a hora em que a cópia começa vai para o App State, e a
      // análise de hora em hora não lê as horas de antes dela (lib/copiaDesde.ts)
      const t0 = Date.now(), copiaNova = !!estado && Object.values(BUCKETS_PASSOS).every((b) => !estado.buckets[b]);
      const r = await aplicar(clientePlataforma, { apps: [...marcadas], validarApenas, hospedeiroId: destino || null }, estado ?? undefined);
      setResultado(r);
      if (!validarApenas && copiaNova && r.some((x) => x.passo === `bucket ${BUCKETS_PASSOS.nav}` && x.ok)) await gravarCopiaDesde(t0);
      if (!validarApenas && r.every((x) => x.ok)) { await salvarHabilitadas([...marcadas]); aoAplicar?.([...marcadas]); }
      if (!validarApenas) await carregar();
    } catch (ex) { setErro(ex instanceof Error ? ex.message : String(ex)); }
    finally { setRodando(""); }
  };
  const alternar = (id: string) => setMarcadas((m) => { const n = new Set(m); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  /** Aplicação mobile ainda sem UUID: busca no user.events (7 dias, até 2 GB, 1 registro), guarda no App State e marca. */
  const marcarMobileSemId = async (a: AppRum) => {
    setBuscandoId(a.entidade);
    try {
      const r = await dql(`fetch user.events, from: now()-7d, scanLimitGBytes: 2 | filter dt.rum.application.entity == "${a.entidade}" | fields id = dt.rum.application.id | limit 1`, { contexto: "config/CFG-03", maxRecords: 1 });
      const id = texto(r[0]?.id);
      if (!id) { setSemEventos((x) => new Set(x).add(a.entidade)); return; }
      const guardados = await lerIdsMobile();
      void gravarIdsMobile({ ...guardados, [a.entidade]: id });
      setApps((xs) => (xs ?? []).map((x) => (x.entidade === a.entidade ? { ...x, id } : x)));
      setMarcadas((m) => new Set(m).add(id));
    } catch (ex) { setErro(t("Não foi possível buscar o id da aplicação mobile: ", "Could not look up the mobile application id: ") + (ex instanceof Error ? ex.message : String(ex))); }
    finally { setBuscandoId(null); }
  };
  const mudou = estado ? [...marcadas].sort().join() !== [...estado.appsHabilitadas].sort().join() : marcadas.size > 0;
  const nomeDestino = estado?.pipelinesEventosTodos.find((x) => x.objectId === destino)?.value?.displayName ?? estado?.rotasCliente.find((x) => x.pipelineId === destino)?.nome ?? destino;
  const integrado = !!destino;
  // no modo integrado, aplicar com nenhuma aplicação marcada = tirar as regras do DEF do pipeline do ambiente
  const podeAplicar = marcadas.size > 0 || (integrado && !!estado?.hospedeiro);

  // situação em quatro itens (✓ ou ✗)
  const copiaOk = !!estado && [...Object.values(BUCKETS_PASSOS), BUCKET_AGREGADOS, BUCKET_ERROS, BUCKET_HORAS].every((b) => !!estado.buckets[b]) && copiaDividida(estado.pipelinePassos) && !!estado.rotaPassos;
  const workflowOk = (tarefa: keyof typeof ATRASO_ACEITO_MS) => { const c = controles?.[CONTROLE_DA_TAREFA[tarefa]]; return !!c && Date.now() - c.ultimo <= ATRASO_ACEITO_MS[tarefa]; };
  // 1.45.3: workflow recém-criado e parte que ainda não rodou = aguardando a primeira execução (não ✗)
  const aguardando = (tarefa: keyof typeof ATRASO_ACEITO_MS) => !workflowOk(tarefa) && !!controles && !controles[CONTROLE_DA_TAREFA[tarefa]]
    && typeof workflow === "object" && !!workflow && workflow.criado != null && Date.now() - workflow.criado < ESPERA_PRIMEIRA_EXECUCAO_MS;
  const horaDe = (ms: number) => new Date(ms).toLocaleTimeString(t("pt-BR", "en-US"), { hour: "2-digit", minute: "2-digit" });
  /** Abre o app Workflows com o workflow do DEF já preenchido (intent "create-workflow"): quem configura confere e salva. */
  const criarWorkflow = () => {
    try { sendIntent(intentCriarWorkflow(appId) as unknown as Parameters<typeof sendIntent>[0], INTENT_CRIAR_WORKFLOW.app, INTENT_CRIAR_WORKFLOW.intent); }
    catch (ex) { setErro(t("Não foi possível abrir o app Workflows: ", "Could not open the Workflows app: ") + (ex instanceof Error ? ex.message : String(ex))); }
  };
  /** O JSON do workflow para importar no app Workflows (Upload), oferecido só quando alguma parte está parada. */
  const baixarWorkflow = () => {
    const def = definicoesWorkflows(appId)[0];
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(def, null, 2)], { type: "application/json" }));
    a.download = "def-workflow.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  const regrasOk = !!estado && (estado.modo === "integrado" ? !!estado.hospedeiro : !!estado.pipelineEventos);
  const workflowsOk = TAREFAS_WORKFLOW.every((w) => workflowOk(w.tarefa));
  // criar: quando a API diz que não existe; sem leitura de workflows, quando as partes estão paradas
  const faltaWorkflow = workflow === null || (workflow === "sem-permissao" && !!controles && !workflowsOk);
  const abrirWorkflow = (id: string) => { try { sendIntent({ "workflow.id": id } as unknown as Parameters<typeof sendIntent>[0], INTENT_CRIAR_WORKFLOW.app, "view-workflow-by-id"); } catch { /* fora da plataforma */ } };
  const semPermissao = !!estado && estado.erros.some((e) => e.includes("403"));
  const filtro = busca.trim().toLowerCase();
  const visiveis = useMemo(() => (apps ?? []).filter((a) => !filtro || a.nome.toLowerCase().includes(filtro) || a.entidade.toLowerCase().includes(filtro) || (a.id ?? "").includes(filtro)), [apps, filtro]);
  const Estado: React.FC<{ ok: boolean; espera?: boolean }> = ({ ok, espera }) => <span className={`config-estado ${ok ? "ok" : espera ? "espera" : "falta"}`} aria-hidden="true">{ok ? "✓" : espera ? "…" : "✗"}</span>;

  return (
    <div className="config cfg">
      <header className="cfg-topo">
        <div>
          <h2>{t("Configuração", "Configuration")}</h2>
          <p className="cfg-sub">{t("Marque as aplicações que entram no fluxo e aplique. O app grava só as próprias regras, sempre no mesmo padrão; nada do que já existe no tenant muda.", "Select the applications that enter the flow and apply. The app writes only its own rules, always in the same pattern; nothing that already exists in the tenant changes.")}</p>
        </div>
        <button className="painel-fechar" onClick={aoFechar} title={t("Voltar", "Back")} aria-label={t("Fechar", "Close")}>×</button>
      </header>
      {erro && <p className="painel-erro">{erro}</p>}
      {semPermissao && <p className="painel-erro config-permissao">{t("Sem permissão para ler Settings e buckets (HTTP 403). Peça a um administrador, ou, em desenvolvimento, reinicie o servidor e entre pelo link que ele imprime.", "No permission to read Settings and buckets (HTTP 403). Ask an administrator or, in development, restart the server and open the link it prints.")}</p>}
      {estado && !semPermissao && estado.erros.length > 0 && <ul className="config-lista">{estado.erros.map((e) => <li key={e} className="painel-erro">{e}</li>)}</ul>}

      {!estado ? <p className="painel-vazio cfg-situacao-vazia">{t("lendo a situação do tenant…", "reading the tenant status…")}</p> : (
        <ul className="cfg-situacao" aria-label={t("Situação", "Status")}>
          <li className={regrasOk ? "ok" : "falta"}><Estado ok={regrasOk} /><div><span>{t("Regras do app", "App rules")}</span><small>{estado.modo === "integrado" ? t(`dentro de "${estado.hospedeiro?.value?.displayName ?? estado.hospedeiro?.value?.customId ?? ""}"`, `inside "${estado.hospedeiro?.value?.displayName ?? estado.hospedeiro?.value?.customId ?? ""}"`) : t("pipeline próprio rum-flow", "own pipeline rum-flow")}</small></div></li>
          <li className={estado.appsHabilitadas.length > 0 ? "ok" : "falta"}><Estado ok={estado.appsHabilitadas.length > 0} /><div><span>{t("Aplicações habilitadas", "Enabled applications")}</span><small>{formatarInt(estado.appsHabilitadas.length)}</small></div></li>
          <li className={copiaOk ? "ok" : "falta"}><Estado ok={copiaOk} /><div><span>{t("Cópia e agregados", "Copy and aggregates")}</span><small>{t(`4 buckets de ${RETENCAO_PASSOS} dia + agregados de ${RETENCAO_AGREGADOS} dias`, `4 buckets of ${RETENCAO_PASSOS} day + aggregates of ${RETENCAO_AGREGADOS} days`)}</small></div></li>
          {(() => { const ok = !!controles && TAREFAS_WORKFLOW.every((w) => workflowOk(w.tarefa)); const espera = !ok && !!controles && TAREFAS_WORKFLOW.every((w) => workflowOk(w.tarefa) || aguardando(w.tarefa)); return (
            <li className={ok ? "ok" : espera ? "espera" : "falta"}><Estado ok={ok} espera={espera} /><div><span>{t("Workflow", "Workflow")}</span><small>{!controles ? t("lendo…", "reading…") : espera ? t("aguardando a primeira execução", "waiting for the first run") : t(`${TAREFAS_WORKFLOW.filter((w) => workflowOk(w.tarefa)).length} de ${TAREFAS_WORKFLOW.length} partes rodando`, `${TAREFAS_WORKFLOW.filter((w) => workflowOk(w.tarefa)).length} of ${TAREFAS_WORKFLOW.length} parts running`)}</small></div></li>); })()}
        </ul>
      )}

      <div className="cfg-grade">
        <section className="cfg-cartao cfg-apps">
          <div className="cfg-cartao-topo">
            <h3>{t("Aplicações", "Applications")}</h3>
            {apps && <span className="cfg-contagem">{t(`${formatarInt(marcadas.size)} de ${formatarInt(apps.length)} marcadas`, `${formatarInt(marcadas.size)} of ${formatarInt(apps.length)} selected`)}{mudou ? <b> · {t("alterado", "changed")}</b> : null}</span>}
          </div>
          {apps && apps.length > 8 && <input className="cfg-busca" type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder={t("buscar por nome ou id", "search by name or id")} aria-label={t("Buscar aplicação", "Search application")} />}
          {!apps ? <p className="painel-vazio">{t("lendo as aplicações do RUM…", "reading RUM applications…")}</p>
            : apps.length === 0 ? <p className="painel-vazio">{t("Nenhuma aplicação RUM no tenant.", "No RUM application in the tenant.")}</p>
            : visiveis.length === 0 ? <p className="painel-vazio">{t("Nenhuma aplicação com esse nome.", "No application with that name.")}</p>
            : (
              <ul className="cfg-lista-apps">
                {visiveis.map((a) => {
                  const id = a.id;
                  const p = id ? paginas[id] : undefined;
                  const marcada = !!id && marcadas.has(id);
                  const nota = a.avulsa ? t("só no roteamento · desmarque para tirar", "only in the routing · clear to remove")
                    : !id ? (buscandoId === a.entidade ? t("buscando o id da aplicação…", "looking up the application id…") : semEventos.has(a.entidade) ? t("sem eventos nos últimos 7 dias", "no events in the last 7 days") : t("o id é buscado ao marcar", "the id is looked up when selected"))
                    : p == null ? (marcada && estado?.appsHabilitadas.includes(id) ? t("sem navegação", "no navigation") : "")
                    : t(`${formatarInt(p)} páginas distintas (30 min)`, `${formatarInt(p)} distinct pages (30 min)`);
                  return (
                    <li key={a.entidade || id || a.nome} className={`${marcada ? "marcada" : ""}${!id && semEventos.has(a.entidade) ? " inativa" : ""}`}>
                      <label>
                        <input type="checkbox" disabled={(!id && (a.tipo !== "mobile" || semEventos.has(a.entidade))) || buscandoId === a.entidade} checked={marcada} onChange={() => (id ? alternar(id) : void marcarMobileSemId(a))} aria-label={t(`Habilitar ${a.nome}`, `Enable ${a.nome}`)} />
                        <span className="cfg-app-texto">
                          <span className="cfg-app-linha"><span className="cfg-app-nome">{a.nome}</span><span className={`cfg-chip ${a.tipo}`}>{a.tipo}</span></span>
                          {nota && <span className={`cfg-app-nota${a.avulsa || (p != null && p > 200) ? " alerta" : ""}`}>{nota}</span>}
                        </span>
                      </label>
                      <code className="cfg-app-id" title={a.entidade || id || ""}>{a.entidade || id}</code>
                    </li>
                  );
                })}
              </ul>
            )}
        </section>

        <section className="cfg-cartao cfg-acoes-cartao">
          <h3>{t("Aplicar", "Apply")}</h3>
          {!podeAplicar ? <p className="cfg-acao-nota">{t("Escolha pelo menos uma aplicação.", "Select at least one application.")}</p>
            : integrado && marcadas.size === 0 ? <p className="cfg-acao-nota">{t(`Nenhuma aplicação marcada: as regras do app saem do pipeline "${nomeDestino}".`, `No application selected: the app's rules leave the "${nomeDestino}" pipeline.`)}</p>
            : (
              <ul className="cfg-sera">
                <li><b>{regrasOk ? t("Configurar", "Configure") : t("Criar", "Create")}</b><span>{integrado ? t(`as regras do app no pipeline "${nomeDestino}", que já recebe os eventos destas aplicações`, `the app's rules in the "${nomeDestino}" pipeline, which already receives these applications' events`) : t("o pipeline e a rota do app", "the app's pipeline and route")}</span></li>
                <li><b>{copiaOk ? t("Configurar", "Configure") : t("Criar", "Create")}</b><span>{t("a cópia das sessões e os buckets do app", "the session copy and the app's buckets")}</span></li>
                {faltaWorkflow && <li><b>{t("Criar", "Create")}</b><span>{t("o workflow: o botão abaixo abre o app Workflows já preenchido; é só salvar", "the workflow: the button below opens the Workflows app already filled in; just save it")}</span></li>}
                <li><b>{t("Habilitar", "Enable")}</b><span>{marcadas.size === 1 ? t("1 aplicação", "1 application") : t(`${formatarInt(marcadas.size)} aplicações`, `${formatarInt(marcadas.size)} applications`)}</span></li>
              </ul>
            )}
          {estado && !integrado && estado.rotasCliente.length > 0 && <p className="painel-erro config-permissao">{t(`Este tenant já roteia user.events para ${estado.rotasCliente.map((x) => `"${x.nome}"`).join(", ")}. Com a rota própria do app na frente, esses pipelines deixam de receber os eventos das aplicações marcadas.`, `This tenant already routes user.events to ${estado.rotasCliente.map((x) => `"${x.nome}"`).join(", ")}. With the app's own route in front, those pipelines stop receiving the selected applications' events.`)}</p>}
          <div className="config-acoes">
            <button className="botao-leve" disabled={!!rodando || !estado || !podeAplicar} onClick={() => executar(true)} title={t("Confere tudo com o servidor sem gravar", "Checks everything with the server without writing")}>{rodando === "validar" ? t("conferindo…", "checking…") : t("Conferir", "Check")}</button>
            <button className="botao-primario" disabled={!!rodando || !estado || !podeAplicar} onClick={() => executar(false)}
                    title={!podeAplicar ? t("Escolha pelo menos uma aplicação", "Select at least one application") : t("Cria ou atualiza tudo no padrão do app", "Creates or updates everything in the app pattern")}>{rodando === "aplicar" ? t("configurando…", "configuring…") : t("Aplicar configuração", "Apply configuration")}</button>
          </div>
          {resultado && (
            <ul className="config-resultado">
              {resultado.map((r, i) => <li key={i} className={r.ok ? "ok" : "falta"}><b>{r.ok ? "✓" : "✗"}</b> {r.passo}: {r.detalhe}</li>)}
            </ul>
          )}
          {faltaWorkflow && (
            <div className="cfg-criar-wf">
                <button className={resultado && resultado.every((r) => r.ok) ? "botao-primario" : "botao-leve"} onClick={criarWorkflow}>{t("Criar o workflow", "Create the workflow")}</button>
                <small>{t("Abre o app Workflows com o workflow do Digital Experience Flow preenchido (a cada 5 minutos, uma tarefa). Confira e salve: você passa a ser o dono e as execuções rodam com a sua permissão.", "Opens the Workflows app with the Digital Experience Flow workflow filled in (every 5 minutes, one task). Check and save: you become the owner and runs use your permissions.")}</small>
              </div>
            )}
          <p className="cfg-rodape">{t("Os buckets só recebem eventos novos; os agregados aparecem em até 10 minutos.", "Buckets only receive new events; aggregates show up within 10 minutes.")}</p>
          <details className="cfg-detalhes">
            <summary>{t("O que o app grava", "What the app writes")}</summary>
            <ul>
              <li>{t(`Cópia enxuta das sessões (navegação, erro, chamada de API e experiência) em 4 buckets de ${RETENCAO_PASSOS} dia, extraída pelo OpenPipeline. Nenhuma métrica própria.`, `Lean session copy (navigation, error, API call and experience) in 4 buckets with ${RETENCAO_PASSOS}-day retention, extracted by OpenPipeline. No custom metrics.`)}</li>
              <li>{t(`Agregados por fatia de 5 minutos no bucket ${BUCKET_AGREGADOS} (${RETENCAO_AGREGADOS} dias), gravados pelo workflow.`, `Aggregates per 5-minute slice in the ${BUCKET_AGREGADOS} bucket (${RETENCAO_AGREGADOS} days), written by the workflow.`)}</li>
              <li>{t(`Erros com exemplos por fatia de 5 minutos no bucket ${BUCKET_ERROS} (${RETENCAO_ERROS} dias) e a análise de hora em hora no bucket ${BUCKET_HORAS} (${RETENCAO_HORAS} dias), gravados pelo workflow.`, `Errors with examples per 5-minute slice in the ${BUCKET_ERROS} bucket (${RETENCAO_ERROS} days) and the hourly analysis in the ${BUCKET_HORAS} bucket (${RETENCAO_HORAS} days), written by the workflow.`)}</li>
              <li>{t("As sessões da última hora no App State do app.", "The last-hour sessions in the app's App State.")}</li>
              <li>{t("O detalhe está na aba Documentação, em Pré-requisitos.", "Details are in the Documentation tab, under Prerequisites.")}</li>
            </ul>
          </details>
        </section>

        <div className="cfg-lado">
        <section className="cfg-cartao cfg-workflows">
          <h3>{t("Workflow", "Workflow")}</h3>
          <p className="cfg-acao-nota">{t("Um workflow simples (sem custo por hora) roda a ação do app a cada 5 minutos, em três partes. Ele é criado na instalação ou pelo botão \"Criar o workflow\"; as execuções rodam com a permissão de quem o criou.", "One simple workflow (no hourly cost) runs the app's action every 5 minutes, in three parts. It is created at installation or with the \"Create the workflow\" button; runs use the permissions of whoever created it.")}</p>
          <ul className="cfg-status">
            {TAREFAS_WORKFLOW.map((w) => {
              const c = controles?.[CONTROLE_DA_TAREFA[w.tarefa]];
              const ok = workflowOk(w.tarefa);
              return (
                <li key={w.tarefa}><Estado ok={ok} espera={aguardando(w.tarefa)} />
                  <span>{w.tarefa === "fatias" ? t("Agregados, a cada 5 min", "Aggregates, every 5 min") : w.tarefa === "sessoes" ? t("Sessões da última hora, a cada 15 min", "Last-hour sessions, every 15 min") : t("Análise de hora em hora, a cada 15 min", "Hourly analysis, every 15 min")}</span>
                  <small>{c ? t(`última execução: ${horaDe(c.ultimo)}`, `last run: ${horaDe(c.ultimo)}`) : aguardando(w.tarefa) ? (w.tarefa === "fatias" ? t("aguardando a primeira execução (até 5 min)", "waiting for the first run (up to 5 min)") : t("aguardando a primeira execução (até 15 min)", "waiting for the first run (up to 15 min)")) : controles ? t("sem execução nas últimas 3 h", "no run in the last 3 h") : ""}</small>
                </li>
              );
            })}
          </ul>
          {typeof workflow === "object" && workflow && <p className="cfg-acao-nota cfg-wf-falta"><button className="painel-link" onClick={() => abrirWorkflow(workflow.id)}>{t("Abrir no app Workflows", "Open in the Workflows app")}</button></p>}
          {faltaWorkflow && <p className="cfg-acao-nota cfg-wf-falta">{workflow === null ? t("O workflow não existe: ", "There is no workflow: ") : t("O workflow não está rodando? ", "Workflow not running? ")}<button className="painel-link" onClick={criarWorkflow}>{t("Criar o workflow", "Create the workflow")}</button>{t(" (abre o app Workflows preenchido) ou ", " (opens the Workflows app filled in) or ")}<button className="painel-link" onClick={baixarWorkflow}>{t("baixe o JSON", "download the JSON")}</button>{t(" para importar.", " to import.")}</p>}
        </section>

        <section className="cfg-cartao cfg-atualizacao">
          <h3>{t("Atualização dos números", "How numbers update")}</h3>
          {!modo ? <p className="painel-vazio">{t("lendo…", "reading…")}</p> : (
            <ul className="cfg-modos">
              {([
                ["tempo-real", t("Tempo real", "Real time"), t("Erros, Apdex e os números do grafo vão até agora. Cada abertura lê também os últimos minutos da cópia.", "Errors, Apdex and the graph numbers go up to now. Each opening also reads the last minutes of the copy.")],
                ["5min", t("A cada 5 minutos", "Every 5 minutes"), t("Os mesmos números vão até a última fatia gravada pelo workflow, de 5 a 10 minutos atrás. A abertura lê só o que já foi agregado.", "The same numbers go up to the last slice written by the workflow, 5 to 10 minutes ago. Opening reads only what was already aggregated.")],
              ] as [ModoAtualizacao, string, string][]).map(([m, rotulo, nota]) => (
                <li key={m}>
                  <label className={modo === m ? "marcada" : ""}>
                    <input type="radio" name="cfg-modo" checked={modo === m} onChange={() => void trocarModo(m)} />
                    <span>{rotulo}</span>
                    <small>{nota}</small>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {avisoModo ? <p className={avisoModo.ok ? "cfg-rodape" : "painel-erro config-permissao"}>{avisoModo.texto}</p>
            : <p className="cfg-rodape">{t("Vale para todos os usuários a partir da próxima abertura.", "It applies to all users from the next opening.")}</p>}
        </section>
        </div>

        <ConsumoApp appId={appId} />
      </div>
    </div>
  );
};
