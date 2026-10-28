/* Respostas SIMULADAS do LLM para a prévia e o exemplo (servidor local): escritas à mão no formato dos esquemas, só para
   mostrar o resultado na tela e no PDF sem gastar o LLM. Não são uma análise de verdade: o texto vem do tipo da
   oportunidade (falha de backend, erro de JavaScript ou lentidão), com o título de cada uma; os números (1.47.7) mudam por
   oportunidade e fecham a conta (mês = dia x 30, e a causa comum soma as oportunidades que ela explica). 1.47.10: em
   inglês quando o pedido diz "Escreva em English" (a tela em inglês), como o LLM de verdade responderia; e a síntese liga
   cada causa às oportunidades do mesmo tipo, lidas do pedido (antes era fixa: a lentidão ia para a o3, que no LAB é um
   erro de JavaScript). */
type Corpo = Record<string, any>;
type Grupo = "falha" | "tela" | "lenta";
const conteudo = (corpo: Corpo) => String(corpo.messages?.[0]?.content ?? "");
const tituloDe = (corpo: Corpo) => /Oportunidade o\d+: (.*)/.exec(conteudo(corpo))?.[1]?.trim() ?? (emIngles(corpo) ? "opportunity" : "oportunidade");
const idDe = (corpo: Corpo) => /Oportunidade (o\d+):/.exec(conteudo(corpo))?.[1] ?? "o1";
/** As regras de texto vão no system do pedido ("Escreva em English" com a tela em inglês). */
const emIngles = (corpo: Corpo) => /Escreva em English/.test(JSON.stringify(corpo.system ?? "") + conteudo(corpo));
/** O JSON entre <marca> e </marca> no pedido: o dossiê da oportunidade ou as análises que vão à síntese. */
const jsonEntre = (corpo: Corpo, marca: string): any => {
  try { const m = new RegExp(`<${marca}>\\n([\\s\\S]*?)\\n</${marca}>`).exec(conteudo(corpo)); return m ? JSON.parse(m[1]) : null; } catch { return null; }
};
/** O grupo pelo tipo do dossiê: erro de JavaScript, lentidão (da página ou de uma chamada) e, o resto, falha de backend. */
const grupoDoTipo = (tipo: unknown): Grupo => (tipo === "erro-javascript" ? "tela" : tipo === "lentidao-pagina" || tipo === "chamada-lenta" ? "lenta" : "falha");
/** Números por oportunidade: sessões com erro por dia, a fração recuperável, a conversão de hoje e a esperada, o esforço. */
const NUMEROS: Record<string, { dia: number; pct: number; conv: [number, number]; esforco: "P" | "M" | "G"; base: [number, number] }> = {
  o1: { dia: 1200, pct: 90, conv: [62, 92], esforco: "M", base: [100, 10] },
  o2: { dia: 520, pct: 85, conv: [70, 90], esforco: "P", base: [43, 5] },
  o3: { dia: 900, pct: 20, conv: [80, 84], esforco: "G", base: [75, 60] },
  o4: { dia: 300, pct: 80, conv: [75, 85], esforco: "P", base: [25, 5] },
};
const numerosDe = (id: string) => NUMEROS[id] ?? { dia: 200, pct: 50, conv: [70, 80] as [number, number], esforco: "M" as const, base: [17, 8] as [number, number] };
const recuperadasDia = (id: string) => Math.round((numerosDe(id).dia * numerosDe(id).pct) / 100);

export const opExemplo = (corpo: Corpo) => {
  const id = idDe(corpo), n = numerosDe(id), rd = recuperadasDia(id), en = emIngles(corpo);
  const g = grupoDoTipo(jsonEntre(corpo, "dossie")?.tipo);
  const L = (pt: string, ing: string) => (en ? ing : pt);
  const fmt = (x: number) => x.toLocaleString(en ? "en-US" : "pt-BR");
  const titulo = tituloDe(corpo);
  const porGrupo = {
    falha: {
      resumo: L(`Exemplo simulado para "${titulo}": a chamada falha para parte dos clientes e eles não concluem a etapa.`, `Simulated example for "${titulo}": the call fails for some customers and they do not complete the step.`),
      afirmacao: L("O serviço de origem rejeita a requisição em menos de 1 ms, antes de chamar o banco, e os canais só repassam o erro.", "The origin service rejects the request in under 1 ms, before calling the database, and the channels only pass the error on."),
      estrutural: L("Falha decidida dentro do serviço sem failover, sem contrato de erro e sem alerta na origem.", "A failure decided inside the service, with no failover, no error contract and no alert at the origin."),
      assinatura: L(`${id}: serviço de origem, endpoint do dossiê, exceção sem pilha na origem`, `${id}: origin service, dossier endpoint, exception with no stack at the origin`),
      cadeia: [
        { evidencia: L("20 de 20 traces com falha nascem no mesmo serviço", "20 of 20 failing traces start in the same service"), fonte: "backend.falha.traces.origem_da_falha", o_que_prova: L("os proxies só repassam", "the proxies only pass it on") },
        { evidencia: L("0 chamadas ao banco na falha contra 4 no sucesso", "0 database calls on failure versus 4 on success"), fonte: "backend.origem_quando_da_certo", o_que_prova: L("a decisão vem antes do processamento", "the decision comes before processing") },
        { evidencia: L("CPU 3% e memória 33% nos hosts", "CPU 3% and memory 33% on the hosts"), fonte: "saude_metricas", o_que_prova: L("não é saturação", "it is not saturation") },
      ],
      justificativa: L("A cadeia fecha da porta de entrada até a origem, com contraste entre falha e sucesso.", "The chain closes from the entry point to the origin, with a contrast between failure and success."),
      descartadas: [{ hipotese: L("Saturação de infraestrutura", "Infrastructure saturation"), por_que: L("CPU de 3% nos hosts dos traces", "3% CPU on the trace hosts") }, { hipotese: L("Deploy recente", "Recent deployment"), por_que: L("nenhum evento em 48 h", "no event in 48 h") }],
      aberto: [{ hipotese: L("Regra regional dentro do serviço", "Regional rule inside the service"), como_confirmar: L("Ler o handler e comparar os traces por estado", "Read the handler and compare the traces by state") }],
      rapida: [{ acao: L("Desligar a condição que devolve indisponível sem tentar o processamento", "Turn off the condition that returns unavailable without trying to process"), onde: L("serviço de origem", "origin service"), prazo: L("1 a 3 dias", "1 to 3 days") }],
      mudanca: [{ acao: L("Contrato de erro e nova tentativa idempotente no canal", "Error contract and idempotent retry in the channel"), camada: "resiliencia", detalhe: L("O cliente para de ver 500 genérico e a falha transitória some", "Customers stop seeing a generic 500 and the transient failure goes away") },
        { acao: L("Alerta e SLO na origem, por estado", "Alert and SLO at the origin, by state"), camada: "observabilidade", detalhe: L("A falha aparece onde nasce, não no proxy", "The failure shows where it starts, not at the proxy") }],
      riscos: [L("Nova tentativa sem idempotência pode duplicar a transação", "A retry without idempotency can duplicate the transaction")],
    },
    tela: {
      resumo: L(`Exemplo simulado para "${titulo}": um erro de JavaScript na página interrompe a etapa para parte dos clientes.`, `Simulated example for "${titulo}": a JavaScript error on the page interrupts the step for some customers.`),
      afirmacao: L("O script da página lança uma exceção não tratada ao montar o formulário, e o botão de seguir fica sem resposta.", "The page script throws an unhandled exception while building the form, and the continue button stops responding."),
      estrutural: L("Código do frontend sem tratamento de erro e sem teste da página antes de publicar.", "Frontend code with no error handling and no page test before release."),
      assinatura: L(`${id}: página do dossiê, exceção de JavaScript, sem falha de backend junto`, `${id}: dossier page, JavaScript exception, with no backend failure alongside`),
      cadeia: [
        { evidencia: L("a mesma exceção em todas as sessões com erro da página", "the same exception in every session with an error on the page"), fonte: "frontend.javascript", o_que_prova: L("o erro é do código da página", "the error is in the page code") },
        { evidencia: L("0 requisições com falha nessas sessões", "0 failed requests in those sessions"), fonte: "backend", o_que_prova: L("não é o backend", "it is not the backend") },
        { evidencia: L("quem vê o erro conclui menos a etapa", "those who see the error complete the step less often"), fonte: "negocio.paginas", o_que_prova: L("o erro tira clientes do fluxo", "the error takes customers out of the flow") },
      ],
      justificativa: L("O erro é da página e não há falha de backend nas mesmas sessões; falta a pilha para fechar a linha do código.", "The error belongs to the page and there is no backend failure in the same sessions; the stack is missing to close in on the code line."),
      descartadas: [{ hipotese: L("Falha de backend", "Backend failure"), por_que: L("nenhuma requisição com falha nas sessões do erro", "no failed request in the error sessions") }, { hipotese: L("Navegador antigo", "Old browser"), por_que: L("o erro aparece nos navegadores atuais", "the error shows up in current browsers") }],
      aberto: [{ hipotese: L("Valor inesperado em um campo do formulário", "Unexpected value in a form field"), como_confirmar: L("Abrir uma sessão com o erro e ler a pilha no navegador", "Open a session with the error and read the stack in the browser") }],
      rapida: [{ acao: L("Tratar a exceção e mostrar uma mensagem com saída para o cliente", "Handle the exception and show a message with a way out for the customer"), onde: L("script da página", "page script"), prazo: L("1 a 3 dias", "1 to 3 days") }],
      mudanca: [{ acao: L("Tratamento de erro padrão nas páginas", "Standard error handling on the pages"), camada: "codigo", detalhe: L("Um erro de script deixa de travar a etapa", "A script error no longer blocks the step") },
        { acao: L("Teste da página e alerta de erro de JavaScript por versão", "Page test and JavaScript error alert by release"), camada: "processo", detalhe: L("O erro aparece antes de chegar ao cliente", "The error shows up before it reaches the customer") }],
      riscos: [L("A mensagem nova precisa da mesma saída em todos os navegadores", "The new message needs the same way out in every browser")],
    },
    lenta: {
      resumo: L(`Exemplo simulado para "${titulo}": a página espera uma chamada lenta e parte dos clientes desiste antes de ver o conteúdo.`, `Simulated example for "${titulo}": the page waits for a slow call and some customers give up before seeing the content.`),
      afirmacao: L("A página só desenha o conteúdo principal depois da resposta da chamada, que passa de 3 s nos horários de pico.", "The page only draws its main content after the call responds, which takes over 3 s at peak times."),
      estrutural: L("Tela acoplada a uma chamada lenta, sem esqueleto da página nem carga tardia.", "A screen tied to a slow call, with no page skeleton and no lazy loading."),
      assinatura: L(`${id}: página do dossiê, chamada que segura o LCP`, `${id}: dossier page, call that holds the LCP`),
      cadeia: [
        { evidencia: L("o LCP termina logo depois da chamada", "the LCP ends right after the call"), fonte: "frontend.lcp", o_que_prova: L("a página espera a chamada", "the page waits for the call") },
        { evidencia: L("a chamada passa de 3 s no p75 dos horários de pico", "the call takes over 3 s at p75 at peak times"), fonte: "backend", o_que_prova: L("o tempo está na chamada", "the time is in the call") },
        { evidencia: L("quem espera mais sai mais da página", "those who wait longer leave the page more often"), fonte: "negocio.paginas", o_que_prova: L("a espera tira clientes do fluxo", "the wait takes customers out of the flow") },
      ],
      justificativa: L("O tempo da chamada explica o LCP; o efeito na conversão é inferido pela saída da página.", "The call time explains the LCP; the effect on conversion is inferred from page exits."),
      descartadas: [{ hipotese: L("Página pesada", "Heavy page"), por_que: L("os recursos carregam antes da chamada", "the resources load before the call") }, { hipotese: L("Rede do cliente", "Customer network"), por_que: L("o tempo alto está no servidor da chamada", "the high time is on the call server") }],
      aberto: [{ hipotese: L("Consulta lenta atrás da chamada", "Slow query behind the call"), como_confirmar: L("Abrir os traces lentos da chamada e ver o tempo por etapa", "Open the slow traces of the call and see the time per step") }],
      rapida: [{ acao: L("Desenhar a página antes da resposta da chamada", "Draw the page before the call responds"), onde: L("página", "page"), prazo: L("3 a 5 dias", "3 to 5 days") }],
      mudanca: [{ acao: L("Esqueleto da página e carga tardia", "Page skeleton and lazy loading"), camada: "arquitetura", detalhe: L("O cliente vê a página enquanto a chamada responde", "Customers see the page while the call responds") },
        { acao: L("Orçamento de desempenho e alerta no tempo da chamada", "Performance budget and alert on the call time"), camada: "observabilidade", detalhe: L("A lentidão aparece antes de virar perda", "Slowness shows up before it turns into loss") }],
      riscos: [L("A carga tardia pode mover os elementos na tela (CLS)", "Lazy loading can move elements on the screen (CLS)")],
    },
  }[g];
  return {
    problema: { resumo: porGrupo.resumo,
      numeros_chave: [L(`${fmt(n.dia)} sessões afetadas por dia (negocio.paginas)`, `${fmt(n.dia)} affected sessions per day (negocio.paginas)`), L(`${n.base[0]} não concluíram em 2 h (negocio.paginas)`, `${n.base[0]} did not complete in 2 h (negocio.paginas)`)] },
    causa_raiz: {
      afirmacao: porGrupo.afirmacao, causa_estrutural: porGrupo.estrutural, assinatura: porGrupo.assinatura, cadeia_de_evidencias: porGrupo.cadeia,
      confianca: g === "falha" ? "alta" : "media", justificativa_da_confianca: porGrupo.justificativa,
      hipoteses_descartadas: porGrupo.descartadas, hipoteses_em_aberto: porGrupo.aberto,
    },
    solucao: { correcao_rapida: porGrupo.rapida, mudanca_estrutural: porGrupo.mudanca },
    beneficio: { sessoes_afetadas_por_dia: n.dia, sessoes_recuperadas_por_dia: rd, sessoes_recuperadas_por_mes: rd * 30, conversao_atual_pct: n.conv[0], conversao_esperada_pct: n.conv[1],
      conta: L(`${fmt(n.dia)} sessões afetadas por dia; ${n.pct}% recuperáveis = ${fmt(rd)} por dia; x 30 = ${fmt(rd * 30)} por mês`, `${fmt(n.dia)} affected sessions per day; ${n.pct}% recoverable = ${fmt(rd)} per day; x 30 = ${fmt(rd * 30)} per month`),
      premissas: [L("mês = dia x 30", "month = day x 30"), L("a taxa sem o problema vale para quem hoje o tem", "the rate without the problem applies to those who have it today")], o_que_nao_da_para_medir: L("Valor das transações e clientes únicos", "Transaction value and unique customers") },
    esforco: { nivel: n.esforco, justificativa: n.esforco === "P" ? L("Um time, mudança no próprio serviço ou na própria página.", "One team, a change in the service or the page itself.") : n.esforco === "M" ? L("Dois times: o do serviço de origem e o do canal.", "Two teams: the origin service team and the channel team.") : L("Mudança de desenho da página e do serviço, com mais de um time.", "A design change to the page and the service, with more than one team.") },
    validacao: { indicador_def: L("Não concluíram na etapa da página", "Did not complete the page step"), linha_de_base: L(`${n.base[0]} em 2 h`, `${n.base[0]} in 2 h`), meta: L(`menos de ${n.base[1]} em 2 h`, `fewer than ${n.base[1]} in 2 h`), como_medir: L("Visão geral, 7 dias, mesma janela", "Overview, 7 days, same window") },
    riscos: porGrupo.riscos,
  };
};
export const sinteseExemplo = (corpo: Corpo) => {
  const L = (pt: string, ing: string) => (emIngles(corpo) ? ing : pt);
  // as oportunidades analisadas, do pedido; sem a lista (um teste chamando direto), as 4 do LAB
  const lidas = jsonEntre(corpo, "analises");
  const ops: { id: string; tipo?: string }[] = Array.isArray(lidas) && lidas.length ? lidas
    : [{ id: "o1", tipo: "falha-backend" }, { id: "o2", tipo: "erro-javascript" }, { id: "o3", tipo: "erro-javascript" }, { id: "o4", tipo: "chamada-lenta" }];
  const de = (g: Grupo) => ops.filter((o) => grupoDoTipo(o.tipo) === g).map((o) => o.id);
  const falha = de("falha"), tela = de("tela"), lenta = de("lenta");
  const mes = (ids: string[]) => ids.reduce((s, id) => s + recuperadasDia(id), 0) * 30;
  const num = (id: string) => id.replace(/^o/, "");
  const ordem = [...ops].sort((a, b) => recuperadasDia(b.id) - recuperadasDia(a.id));
  const grupoDe = (id: string) => grupoDoTipo(ops.find((o) => o.id === id)?.tipo);
  const comeco = grupoDe(ordem[0]?.id ?? "o1");
  const partes = [
    falha.length ? L("falhas de backend decididas dentro dos serviços tiram clientes do fluxo", "backend failures decided inside the services take customers out of the flow") : "",
    tela.length ? L("erros de JavaScript sem tratamento travam etapas", "unhandled JavaScript errors block steps") : "",
    lenta.length ? L("chamadas lentas seguram páginas", "slow calls hold pages") : "",
  ].filter(Boolean);
  const primeiro = { falha: L("desligar as condições de indisponibilidade e colocar alerta na origem", "turn off the unavailability conditions and put an alert at the origin"),
    tela: L("tratar o erro de JavaScript na página e testar antes de publicar", "handle the JavaScript error on the page and test before release"),
    lenta: L("desenhar a página sem esperar a chamada lenta", "draw the page without waiting for the slow call") }[comeco];
  const causas = [
    falha.length && { causa: L("Falha decidida no serviço sem failover nem contrato de erro", "Failure decided in the service with no failover or error contract"), oportunidades: falha, evidencias_que_ligam: [L("origem no serviço em menos de 1 ms", "origin in the service in under 1 ms"), L("nenhuma chamada ao banco na falha", "no database call on failure")], o_que_separa: L("serviços e times diferentes", "different services and teams"), mudanca_estrutural: L("Contrato de erro e failover padrão para as APIs de canal", "Standard error contract and failover for the channel APIs"), beneficio_sessoes_mes: mes(falha), confianca: "alta" },
    tela.length && { causa: L("Erro de JavaScript sem tratamento trava a etapa", "Unhandled JavaScript error blocks the step"), oportunidades: tela, evidencias_que_ligam: [L("o erro acontece na própria página, sem falha de backend junto", "the error happens on the page itself, with no backend failure alongside"), L("quem vê o erro conclui menos a etapa", "those who see the error complete the step less often")], o_que_separa: L("páginas diferentes, o mesmo jeito de não tratar o erro", "different pages, the same way of not handling the error"), mudanca_estrutural: L("Tratamento de erro padrão e teste da página antes de publicar", "Standard error handling and page tests before release"), beneficio_sessoes_mes: mes(tela), confianca: "media" },
    lenta.length && { causa: L("Tela desenhada só depois de uma chamada lenta", "Screen drawn only after a slow call"), oportunidades: lenta, evidencias_que_ligam: [L("LCP termina logo depois da chamada", "LCP ends right after the call")], o_que_separa: L("não é falha, é tempo", "it is not a failure, it is time"), mudanca_estrutural: L("Esqueleto da página e carga tardia", "Page skeleton and lazy loading"), beneficio_sessoes_mes: mes(lenta), confianca: "media" },
  ].filter(Boolean);
  const razao = (id: string, i: number) => {
    if (i === 0) return L("Mais sessões recuperáveis por mês", "Most recoverable sessions per month");
    const antes = ordem.slice(0, i).find((o) => grupoDe(o.id) === grupoDe(id));
    if (antes) return L(`Mesma causa da oportunidade ${num(antes.id)}`, `Same cause as opportunity ${num(antes.id)}`);
    return { falha: L("Falha na origem do serviço, mesma correção das outras falhas", "Failure at the service origin, the same fix as the other failures"),
      tela: L("Correção no frontend, sem depender do backend", "A frontend fix, with no backend dependency"),
      lenta: L("A tela espera a chamada: a correção é na página", "The screen waits for the call: the fix is on the page") }[grupoDe(id)];
  };
  const ondas = [
    falha.length && { onda: "30", objetivo: L("Estancar as falhas na origem", "Stop the failures at the origin"), acoes: [L("Desligar as condições de indisponibilidade", "Turn off the unavailability conditions"), L("Alerta na origem por estado", "Alert at the origin by state")], oportunidades: falha, indicador_def: L("Não concluíram abaixo de 10 em 2 h", "Fewer than 10 did not complete in 2 h") },
    (falha.length || tela.length) && { onda: "60", objetivo: L("Erros tratados nos canais e nas telas", "Errors handled in the channels and on the screens"),
      acoes: [falha.length ? L("Nova tentativa idempotente", "Idempotent retry") : "", tela.length ? L("Tratar os erros de JavaScript das páginas", "Handle the JavaScript errors on the pages") : "", L("Mensagem com saída para o cliente", "A message with a way out for the customer")].filter(Boolean),
      oportunidades: [...falha, ...tela], indicador_def: L("Saíram após um erro abaixo de 2%", "Left after an error below 2%") },
    lenta.length && { onda: "90", objetivo: L("Páginas sem esperar chamadas lentas", "Pages that do not wait for slow calls"), acoes: [L("Esqueleto e carga tardia", "Skeleton and lazy loading"), L("Orçamento de desempenho", "Performance budget")], oportunidades: lenta, indicador_def: L("LCP p75 abaixo de 2,5 s", "LCP p75 below 2.5 s") },
  ].filter(Boolean);
  const ajuda = [
    (falha.length || tela.length) && { servico: "correcao-aplicacoes", oportunidades: [...falha, ...tela], como_ajuda: L("Correção pela causa raiz, com testes.", "Root-cause fixes, with tests.") },
    lenta.length && { servico: "engenharia-performance", oportunidades: lenta, como_ajuda: L("Web Vitals e carga tardia.", "Web Vitals and lazy loading.") },
  ].filter(Boolean);
  return {
    resumo_executivo: L(`Exemplo simulado: ${partes.join("; ")}. ${partes.length === 1 ? "Uma causa estrutural aparece" : `${partes.length} causas estruturais aparecem`}. Primeiro, ${primeiro}.`,
      `Simulated example: ${partes.join("; ")}. ${partes.length === 1 ? "One structural cause shows up" : `${partes.length} structural causes show up`}. First, ${primeiro}.`),
    causas_estruturais_comuns: causas,
    priorizacao: ordem.map((o, i) => ({ id: o.id, ordem: i + 1, razao: razao(o.id, i) })),
    plano_em_ondas: ondas,
    iniciativas_recomendadas: ajuda,
    o_que_falta_medir: [L("Clientes únicos por jornada (user tag)", "Unique customers per journey (user tag)")],
  };
};
export const RESPOSTAS_EXEMPLO = { oportunidade: opExemplo, sintese: sinteseExemplo };
