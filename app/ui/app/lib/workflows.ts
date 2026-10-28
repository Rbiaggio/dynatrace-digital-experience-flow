/* O workflow SIMPLES do DEF (uma tarefa, sem custo por hora; 1.44.5): roda a ação def-agregar do próprio app a cada 5 min
   com a tarefa "ciclo", que faz as três partes: as fatias em toda execução; as sessões da última hora e a análise de hora
   em hora, cada uma em uma de cada três execuções (a cada 15 min, como quando eram três workflows). Cada execução de função
   é cobrada por minuto começado: três workflows eram cerca de 480 execuções por dia; um só, 288, com o mesmo dado na mesma
   hora. App customizado não cria workflow (automation:workflows:write é só de apps da Dynatrace): a Configuração
   abre o app Workflows já preenchido (ou oferece o JSON para importar).
   Sem import de valor: os scripts em Node usam este arquivo. */

export interface DefinicaoWorkflow {
  title: string; description: string; type: "SIMPLE"; isPrivate: boolean;
  trigger: { schedule: { isActive: boolean; trigger: { type: "interval"; intervalMinutes: number }; timezone: string; inputs: Record<string, never>; filterParameters: Record<string, never> } };
  tasks: { agregar: { name: string; action: string; description: string; input: { tarefa: string }; position: { x: number; y: number }; predecessors: string[] } };
}
/** As três partes da ação (cada uma com a sua cadência e o seu registro de controle). Os títulos são os dos workflows
    separados de antes da 1.44.5 (o script de criação apaga os que ainda existirem). */
export interface TarefaWorkflow { tarefa: "fatias" | "sessoes" | "hora"; minutos: number; titulo: string; descricao: string; tarefaDescricao: string }
export const TAREFAS_WORKFLOW: TarefaWorkflow[] = [
  { tarefa: "fatias", minutos: 5, titulo: "DEF | Agregados por fatia de 5 min",
    descricao: "Digital Experience Flow: a cada 5 minutos grava os totais da ultima fatia da copia das sessoes (setas, entradas, erros, views, cliques, tempo de carga e Apdex) no bucket rum_flow_agregados e os erros com os 3 exemplos mais recentes no bucket rum_flow_erros. Substitui as metricas proprias do app. Workflow simples: sem custo por hora; paga so a leitura da fatia.",
    tarefaDescricao: "Le a fatia de 5 min da copia e grava os agregados" },
  { tarefa: "sessoes", minutos: 15, titulo: "DEF | Sessoes da ultima hora a cada 15 min",
    descricao: "Digital Experience Flow: a cada 15 minutos, se alguem esta com a Visao geral aberta (ultimos 20 minutos), le as sessoes da ultima hora da copia (indicadores de sessao por aplicacao, o mapa e as sessoes com erro mais recentes) e grava no App State do app. Sem uso, nao le nada. Workflow simples: sem custo por hora.",
    tarefaDescricao: "Le as sessoes da ultima hora e grava os indicadores, o mapa e as sessoes com erro" },
  { tarefa: "hora", minutos: 15, titulo: "DEF | Analise de hora em hora",
    descricao: "Digital Experience Flow: analisa cada hora uma vez (caminhos, onde as sessoes terminam, paginas, funis, qualidade do dado, chamadas por endpoint, as 3 requisicoes mais lentas de cada pagina, valores dos filtros e a ligacao pagina -> servico) e grava no bucket rum_flow_horas; a tela soma as ultimas 24 horas. Confere as ultimas 23 horas a cada 15 minutos e refaz o que falta. Workflow simples: sem custo por hora.",
    tarefaDescricao: "Analisa as horas que faltam e grava no bucket de horas (rum_flow_horas)" },
];
/** O workflow único (1.44.5). */
export const WORKFLOW_UNICO = { tarefa: "ciclo", minutos: 5, titulo: "DEF | Agregados, sessoes e horas a cada 5 min",
  descricao: "Digital Experience Flow: a cada 5 minutos grava os totais da ultima fatia da copia das sessoes (setas, entradas, erros, views, cliques, tempo de carga e Apdex) nos buckets rum_flow_agregados e rum_flow_erros; a cada 15 minutos, as sessoes da ultima hora no App State do app (so com a Visao geral aberta nos ultimos 20 minutos) e a analise de hora em hora no bucket rum_flow_horas. Um workflow simples: sem custo por hora; uma execucao de funcao a cada 5 minutos.",
  tarefaDescricao: "Fatia de 5 min; a cada 15 min, sessoes da ultima hora ou analise de hora em hora" } as const;
/** A parte extra de cada execução do ciclo, pelo bloco de 5 min do horário: um de cada três faz as sessões da última hora,
    outro a análise de hora em hora, o terceiro só as fatias (cada execução fica com no máximo duas partes, dentro de 1 min). */
export function parteDaRodada(t: number): "sessoes" | "hora" | null {
  const r = Math.floor(t / 300_000) % 3;
  return r === 0 ? "sessoes" : r === 1 ? "hora" : null;
}
/** Títulos anteriores: o script de criação acha e atualiza pelo título antigo também (o workflow das fatias vira o único,
    com o mesmo id e o histórico). */
export const TITULOS_ANTERIORES: Record<string, string[]> = { ciclo: ["DEF | Agregados por fatia de 5 min"] };
/** Workflows que deixaram de existir (o script de criação apaga os deste app): a ligação de hora em hora (1.41) e, desde
    a 1.44.5, os das sessões da última hora e da análise de hora em hora (viraram partes do workflow único). */
export const TAREFAS_REMOVIDAS: { tarefa: string; titulo: string }[] = [{ tarefa: "ligacao", titulo: "DEF | Ligacao pagina-servico de hora em hora" },
  { tarefa: "sessoes", titulo: "DEF | Sessoes da ultima hora a cada 15 min" }, { tarefa: "hora", titulo: "DEF | Analise de hora em hora" }];
/** 1.44.8: o app não pode criar workflow pela API (automation:workflows:write é só de apps da Dynatrace), mas pode abrir o
    app Workflows já preenchido pelo intent "create-workflow" (dynatrace.automations): quem configura confere e salva, e
    passa a ser o dono e o ator do workflow. O conteúdo do intent é a mesma definição do JSON. */
export const INTENT_CRIAR_WORKFLOW = { app: "dynatrace.automations", intent: "create-workflow" } as const;
export const intentCriarWorkflow = (app: string) => {
  const d = definicoesWorkflows(app)[0];
  return { title: d.title, type: d.type, isPrivate: d.isPrivate, trigger: d.trigger, tasks: d.tasks };
};
/** O workflow do DEF neste ambiente (1.44.8), pela API de workflows com a permissão de quem abre a Configuração: pelo
    título (o de hoje ou os anteriores) e pela ação def-agregar deste app. null = não existe; "sem-permissao" = o usuário
    não pode ler workflows (a tela cai na situação pelos registros de controle). */
export interface WorkflowAchado { id: string; title: string; /** quando foi criado (ms; null = a API não disse) */ criado: number | null }
/** Workflow criado há menos disto e parte sem execução ainda: "aguardando a primeira execução", não ✗ (1.45.3; a análise de
    hora em hora roda a cada 15 min, então a primeira execução dela pode levar até 15 min). */
export const ESPERA_PRIMEIRA_EXECUCAO_MS = 20 * 60000;
type Chamador = { chamar(metodo: string, url: string, corpo?: unknown, params?: Record<string, string>): Promise<{ status: number; dados: any }> };
export async function acharWorkflow(c: Chamador, app: string): Promise<WorkflowAchado | null | "sem-permissao"> {
  const API = "/platform/automation/v1/workflows";
  const titulos = [WORKFLOW_UNICO.titulo, ...(TITULOS_ANTERIORES.ciclo ?? [])].flatMap((x) => [x, `${x} (Preview)`]);
  const l = await c.chamar("GET", API, undefined, { search: "DEF |", limit: "100" });
  if (l.status === 401 || l.status === 403) return "sem-permissao";
  if (l.status !== 200) throw new Error(`workflows: HTTP ${l.status}`);
  for (const w of ((l.dados?.results ?? []) as { id: string; title: string }[]).filter((x) => titulos.includes(x.title))) {
    const d = await c.chamar("GET", `${API}/${w.id}`);
    const tarefas = Object.values((d.dados?.tasks ?? {}) as Record<string, { action?: string }>);
    const criado = Date.parse(String(d.dados?.modificationInfo?.createdTime ?? ""));
    if (d.status === 200 && tarefas.some((x) => x.action === `${app}:def-agregar`)) return { id: w.id, title: w.title, criado: isNaN(criado) ? null : criado };
  }
  return null;
}
/** A definição do workflow para o app (o id do manifesto, ou o de testes .preview, que ganha o sufixo no título). */
export const definicoesWorkflows = (app: string): DefinicaoWorkflow[] => [{
  title: `${WORKFLOW_UNICO.titulo}${app.endsWith(".preview") ? " (Preview)" : ""}`,
  description: WORKFLOW_UNICO.descricao,
  type: "SIMPLE",
  isPrivate: false,
  trigger: { schedule: { isActive: true, trigger: { type: "interval", intervalMinutes: WORKFLOW_UNICO.minutos }, timezone: "UTC", inputs: {}, filterParameters: {} } },
  tasks: { agregar: { name: "agregar", action: `${app}:def-agregar`, description: WORKFLOW_UNICO.tarefaDescricao, input: { tarefa: WORKFLOW_UNICO.tarefa }, position: { x: 0, y: 1 }, predecessors: [] } },
}];
/** Até quando cada tarefa conta como "rodando" (o intervalo dela, com folga), pelo registro de controle mais recente. */
export const ATRASO_ACEITO_MS: Record<TarefaWorkflow["tarefa"], number> = { fatias: 30 * 60000, sessoes: 40 * 60000, hora: 40 * 60000 };   // execução pulada (sem uso) também grava o controle
/** O registro de controle de cada tarefa: "fatia" e "retrato" no bucket de agregados; "hora_exec" (1.44.1, um por execução,
    com a hora em que rodou) no de horas. O "hora" de cada unidade leva a hora analisada, sempre mais de 1 hora atrás. */
export const CONTROLE_DA_TAREFA: Record<TarefaWorkflow["tarefa"], string> = { fatias: "fatia", sessoes: "retrato", hora: "hora_exec" };
export const qControlesWorkflows = () => `fetch bizevents, from: now()-3h, bucket: {"rum_flow_agregados", "rum_flow_horas"}
| filter in(k, array("fatia", "retrato", "hora", "hora_exec"))
| summarize ultimo = max(timestamp), exec_max = max(exec), bytes_3h = sum(bytes), execucoes = count(), by:{k}`;
/** A hora em que cada tarefa rodou pela última vez, das linhas de qControlesWorkflows. O exec é o Date.now() da execução em
    base 36 (mesmo tamanho, então o max do texto é o mais recente): é a hora real. As unidades "hora" levam a hora analisada
    no timestamp (sempre mais de 1 hora atrás), então delas só vale o exec, e elas contam como execução da tarefa "hora". */
export function ultimasExecucoes(linhas: { k: string; ultimo: string | null; exec_max: string | null; execucoes: number; bytes: number }[]) {
  const m: Record<string, { ultimo: number; execucoes: number; bytes: number }> = {};
  for (const l of linhas) {
    const porExec = l.exec_max ? parseInt(l.exec_max, 36) : NaN;
    const porTempo = l.k === "hora" ? NaN : Date.parse(String(l.ultimo));
    const ultimo = Math.max(isNaN(porExec) ? 0 : porExec, isNaN(porTempo) ? 0 : porTempo);
    const chave = l.k === "hora" ? "hora_exec" : l.k;
    const a = m[chave];
    m[chave] = { ultimo: Math.max(a?.ultimo ?? 0, ultimo), execucoes: (a?.execucoes ?? 0) + l.execucoes, bytes: (a?.bytes ?? 0) + l.bytes };
  }
  return m;
}
