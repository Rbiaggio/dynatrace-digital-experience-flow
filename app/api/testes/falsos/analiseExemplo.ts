/* Respostas SIMULADAS do LLM para a prévia e o exemplo (servidor local): escritas à mão no formato dos esquemas, só para
   mostrar o resultado na tela e no PDF sem gastar o LLM. Não são uma análise de verdade: a oportunidade repete o mesmo
   texto com o título de cada uma. */
const tituloDe = (corpo: Record<string, any>) => /Oportunidade o\d+: (.*)/.exec(String(corpo.messages?.[0]?.content ?? ""))?.[1]?.trim() ?? "oportunidade";
const idDe = (corpo: Record<string, any>) => /Oportunidade (o\d+):/.exec(String(corpo.messages?.[0]?.content ?? ""))?.[1] ?? "o1";

export const opExemplo = (corpo: Record<string, any>) => ({
  problema: { resumo: `Exemplo simulado para "${tituloDe(corpo)}": a chamada falha para parte dos clientes e eles não concluem a etapa.`, numeros_chave: ["150 clientes com erro em 2 h (negocio.paginas)", "62% de falha no RJ contra 9% em SP (por_estado)"] },
  causa_raiz: {
    afirmacao: "O serviço de origem rejeita a requisição em menos de 1 ms, antes de chamar o banco, e os canais só repassam o erro.",
    causa_estrutural: "Falha decidida dentro do serviço sem failover, sem contrato de erro e sem alerta na origem.",
    assinatura: `${idDe(corpo)}: serviço de origem, endpoint do dossiê, exceção sem pilha na origem`,
    cadeia_de_evidencias: [
      { evidencia: "20 de 20 traces com falha nascem no mesmo serviço", fonte: "backend.falha.traces.origem_da_falha", o_que_prova: "os proxies só repassam" },
      { evidencia: "0 chamadas ao banco na falha contra 4 no sucesso", fonte: "backend.origem_quando_da_certo", o_que_prova: "a decisão vem antes do processamento" },
      { evidencia: "CPU 3% e memória 33% nos hosts", fonte: "saude_metricas", o_que_prova: "não é saturação" },
    ],
    confianca: "alta", justificativa_da_confianca: "A cadeia fecha da porta de entrada até a origem, com contraste entre falha e sucesso.",
    hipoteses_descartadas: [{ hipotese: "Saturação de infraestrutura", por_que: "CPU de 3% nos hosts dos traces" }, { hipotese: "Deploy recente", por_que: "nenhum evento em 48 h" }],
    hipoteses_em_aberto: [{ hipotese: "Regra regional dentro do serviço", como_confirmar: "Ler o handler e comparar os traces por estado" }],
  },
  solucao: {
    correcao_rapida: [{ acao: "Desligar a condição que devolve indisponível sem tentar o processamento", onde: "serviço de origem", prazo: "1 a 3 dias" }],
    mudanca_estrutural: [{ acao: "Contrato de erro e nova tentativa idempotente no canal", camada: "resiliencia", detalhe: "O cliente para de ver 500 genérico e a falha transitória some" }, { acao: "Alerta e SLO na origem, por estado", camada: "observabilidade", detalhe: "A falha aparece onde nasce, não no proxy" }],
  },
  beneficio: { sessoes_afetadas_por_dia: 1200, sessoes_recuperadas_por_dia: 1080, sessoes_recuperadas_por_mes: 32400, conversao_atual_pct: 0, conversao_esperada_pct: 100, conta: "136 não concluíram em 2 h x 12 = 1.632 por dia; 90% recuperáveis x 30", premissas: ["mês = dia x 30", "a taxa sem erro vale para quem hoje tem erro"], o_que_nao_da_para_medir: "Valor das transações e clientes únicos" },
  esforco: { nivel: "M", justificativa: "Dois times: o do serviço de origem e o do canal." },
  validacao: { indicador_def: "Não concluíram na etapa da página", linha_de_base: "136 em 2 h", meta: "menos de 10 em 2 h", como_medir: "Visão geral, 7 dias, mesma janela" },
  riscos: ["Nova tentativa sem idempotência pode duplicar a transação"],
});
export const SINTESE_EXEMPLO = {
  resumo_executivo: "Exemplo simulado: as falhas de backend decididas dentro dos serviços tiram mais clientes do fluxo que a lentidão. Duas causas estruturais aparecem: falha sem contrato de erro e sem failover, e telas acopladas a chamadas lentas. Primeiro, desligar as condições de indisponibilidade e colocar alerta na origem.",
  causas_estruturais_comuns: [
    { causa: "Falha decidida no serviço sem failover nem contrato de erro", oportunidades: ["o1", "o2"], evidencias_que_ligam: ["origem no serviço em menos de 1 ms", "nenhuma chamada ao banco na falha"], o_que_separa: "serviços e times diferentes", mudanca_estrutural: "Contrato de erro e failover padrão para as APIs de canal", beneficio_sessoes_mes: 40000, confianca: "alta" },
    { causa: "Tela desenhada só depois de uma chamada lenta", oportunidades: ["o3"], evidencias_que_ligam: ["LCP termina logo depois da chamada"], o_que_separa: "não é falha, é tempo", mudanca_estrutural: "Esqueleto da página e carga tardia", beneficio_sessoes_mes: null, confianca: "media" },
  ],
  priorizacao: [{ id: "o1", ordem: 1, razao: "Maior benefício medido com esforço médio" }, { id: "o2", ordem: 2, razao: "Mesma causa da oportunidade 1" }, { id: "o3", ordem: 3, razao: "Sem perda de conversão medida" }],
  plano_em_ondas: [
    { onda: "30", objetivo: "Estancar as falhas na origem", acoes: ["Desligar as condições de indisponibilidade", "Alerta na origem por estado"], oportunidades: ["o1", "o2"], indicador_def: "Não concluíram abaixo de 10 em 2 h" },
    { onda: "60", objetivo: "Contrato de erro nos canais", acoes: ["Nova tentativa idempotente", "Mensagem com saída para o cliente"], oportunidades: ["o1", "o2"], indicador_def: "Saíram após um erro abaixo de 2%" },
    { onda: "90", objetivo: "Páginas sem esperar chamadas lentas", acoes: ["Esqueleto e carga tardia", "Orçamento de desempenho"], oportunidades: ["o3"], indicador_def: "LCP p75 abaixo de 2,5 s" },
  ],
  iniciativas_recomendadas: [{ servico: "correcao-aplicacoes", oportunidades: ["o1", "o2"], como_ajuda: "Correção com causa raiz e testes." }, { servico: "engenharia-performance", oportunidades: ["o3"], como_ajuda: "Web Vitals e carga tardia." }],
  o_que_falta_medir: ["Clientes únicos por jornada (user tag)"],
};
export const RESPOSTAS_EXEMPLO = { oportunidade: opExemplo, sintese: SINTESE_EXEMPLO };
