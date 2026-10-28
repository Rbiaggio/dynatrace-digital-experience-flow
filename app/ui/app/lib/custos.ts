/* Modelo de custo por volumetria do Digital Experience Flow (aba Documentação, sub-aba Custos): função pura, sem rede e
   sem dependência de outro módulo, usada pela calculadora (components/docs/DocCustos.tsx) e pelo teste
   (ui/testes/validar_custos.tsx). Arquitetura da 1.43 (modelo por feature: cada dado é coletado do jeito que precisa):
   - cópia enxuta das sessões (navegação, erro e chamada de API) e cópia de experiência (resumos de tela e de página,
     cliques, ações e aberturas do app), extraídas pelo OpenPipeline, com 1 dia de retenção;
   - workflow de fatias a cada 5 min: lê cada fatia da cópia (navegação, erro e experiência) uma vez e grava os totais
     (grafo, Apdex, mapas, cliques) num bucket de agregados e os erros com 3 exemplos num bucket de erros (8 dias);
   - workflow de hora em hora (confere a cada 15 min): cada hora analisada uma vez. Sessões (e funis, se houver jornada
     salva) leem 2 h da navegação e do erro (30 min antes, a hora, 30 min depois: a sessão entra na hora em que terminou);
     requisições e ligação página -> serviço leem a hora da cópia numa leitura só (1.45.2; a ligação junta os spans
     amostrados pelo volume);
     o resultado vai para um bucket de horas (3 dias), que a tela soma nas últimas 24 h;
   - workflow da última hora a cada 15 min, só com a Visão geral aberta: 1 h da navegação e do erro (indicadores de sessão
     e o mapa);
   - em cada carga de tela, a leitura ao vivo: o começo e o fim do período saem da cópia (até 13 min, numa leitura só por
     aba a cada 5 min), o meio das fatias; e as leituras pequenas dos buckets de agregados, de erros e de horas;
   - leituras sob demanda: filtro de segmento, robôs ou frames (a Visão geral lê a cópia do período), "Isolar" e "Por quê?",
     e "Onde falha no backend?" (spans).
   Calibrado no laboratório (3 aplicações, cerca de 15 mil sessões por dia, 40 páginas distintas): registros por sessão,
   bytes lidos por registro e linhas de agregado por página e fatia medidos lá em 20/10/2026; a leitura de cada peça
   conferida contra o volume dos buckets no mesmo intervalo (cada peça lê a própria janela uma vez).
   É um TETO: conta a leitura ao vivo em toda carga de tela e não desconta o cache compartilhado de 5 min.
   Regras de cobrança que o modelo segue:
   - consulta no Grail é cobrada pelos GiB lidos (o filtro num campo não reduz a leitura: o modelo não conta com isso);
   - retenção é cobrada pelo volume guardado (GiB-dia);
   - a cópia extraída pelo OpenPipeline não apareceu na cobrança de gravação no laboratório: sai à parte ("se cobrada");
     o que os workflows gravam pela API de business events entra como gravação;
   - cada execução de workflow é uma invocação da função da ação (AppEngine Functions); workflow simples não paga hora;
   - consulta de métrica nativa, de entidades e o App State: sem custo (não entram).
   Tarifas de referência: preço de lista público da Dynatrace convertido a R$ (lib/precos.ts); quem usa troca pelas do contrato. */

import { precoDeLista } from "./precos";

/** Volumetria do ambiente e uso do app (por dia, salvo onde indicado). */
export interface Volumetria {
  /** sessões das aplicações habilitadas por dia */
  sessoesDia: number;
  /** navegações (cargas e trocas de página ou tela) por sessão */
  navegacoesPorSessao: number;
  /** chamadas de API (requisições ao servidor) por sessão */
  chamadasPorSessao: number;
  /** erros por sessão */
  errosPorSessao: number;
  /** registros de experiência por sessão: resumos de tela e de página, cliques, ações e aberturas do app */
  experienciaPorSessao: number;
  /** páginas e telas distintas monitoradas, somando as aplicações habilitadas (linhas dos agregados) */
  paginasDistintas: number;
  /** GiB de spans por hora no ambiente inteiro */
  spansGibHora: number;
  /** horas do dia com alguém na Visão geral (as sessões da última hora só são lidas nelas) */
  horasUsoDia: number;
  /** jornadas salvas (com alguma, a análise de hora em hora também lê os funis) */
  jornadasSalvas: number;
  /** cargas de tela por dia que vão ao Grail (abrir a Visão geral ou o Flow, trocar de aplicação ou período, Atualizar):
      cada uma lê o começo e o fim do período na cópia e as leituras pequenas dos agregados, dos erros e das horas */
  cargasDia: number;
  /** 1.46.0: false = Configuração em "A cada 5 minutos": a carga não lê o começo e o fim do período na cópia (sem leitura ao
      vivo). Ausente = tempo real, como antes */
  tempoReal?: boolean;
  /** aberturas do Flow por dia (o desenho de 24 h e a ligação página -> serviço das horas analisadas) */
  cargasFlowDia: number;
  /** aberturas com filtro de segmento, robôs ou frames por dia (a Visão geral lê a cópia do período, sob demanda) */
  aberturasFiltroDia: number;
  /** "Isolar" e "Por quê?" por dia (leitura da navegação do período, sob demanda) */
  analisesDia: number;
  /** cliques em "Onde falha no backend?" por dia */
  cliquesOndeFalhaDia: number;
  /** período típico das telas, em minutos */
  janelaMin: number;
}

/** Tarifas, na moeda informada. Padrão (1.45.1): preço de lista público da Dynatrace convertido a R$ pelo câmbio de
    referência (lib/precos.ts), o mesmo do cartão "Consumo do app" da Configuração. */
export interface Tarifas {
  /** por GiB lido em consulta (eventos e spans) */
  consultaPorGib: number;
  /** por GiB-dia guardado */
  retencaoPorGibDia: number;
  /** por GiB gravado (o que os workflows gravam; a cópia só se o contrato cobrar a extração) */
  gravacaoPorGib: number;
  /** por invocação de função (cada execução de workflow) */
  funcaoPorInvocacao: number;
  /** rótulo da moeda, só para exibição */
  moeda: string;
}

/** Valores padrão da calculadora: a volumetria do laboratório. */
export const VOLUMETRIA_LAB: Volumetria = {
  sessoesDia: 15000, navegacoesPorSessao: 5.75, chamadasPorSessao: 4.9, errosPorSessao: 0.33, experienciaPorSessao: 12.7, paginasDistintas: 40, spansGibHora: 0.07,
  horasUsoDia: 10, jornadasSalvas: 1, cargasDia: 40, cargasFlowDia: 20, aberturasFiltroDia: 10, analisesDia: 10, cliquesOndeFalhaDia: 5, janelaMin: 30,
};
/** Preço de lista público da Dynatrace (US$), só como referência. */
/** 6 algarismos significativos: o campo da calculadora não mostra o ruído do ponto flutuante (0,003541999...). */
const arred = (x: number) => Number(x.toPrecision(6));
export const TARIFAS_LISTA: Tarifas = { consultaPorGib: arred(precoDeLista("consulta", null)), retencaoPorGibDia: arred(precoDeLista("retencao", null)), gravacaoPorGib: arred(precoDeLista("gravacao", null)),
  funcaoPorInvocacao: arred(precoDeLista("funcao", null) / 1000), moeda: "R$" };

/** Constantes do modelo (calibração do laboratório e limites do app). */
export const MODELO = {
  /** bytes lidos por registro da cópia e da experiência (laboratório, consultas reais do app e dos workflows) */
  bytesPorRegistro: 800,
  /** bytes por linha gravada: agregado de fatia, erro com exemplos, linha da análise de hora em hora */
  bytesPorAgregado: 420,
  bytesPorErro: 650,
  bytesPorLinhaHora: 600,
  /** linhas por página distinta: agregados em cada fatia de 5 min, erros com exemplos em cada fatia, análise em cada hora */
  linhasPorPaginaFatia: 3.7,
  linhasErroPorPaginaFatia: 1,
  linhasHoraPorPagina: 8,
  diasRetencaoCopia: 1,
  diasRetencaoAgregados: 8,
  diasRetencaoErros: 8,
  diasRetencaoHoras: 3,
  diasMes: 30,
  minutosDia: 1440,
  fatiaMin: 5,
  /** análise de hora em hora: a janela que cada hora analisada lê (sessões e funis: 30 min antes + a hora + 30 min depois;
      requisições e ligação: a hora) e de quanto em quanto o workflow confere */
  horaSessoesMin: 120,
  horaReqMin: 60,
  horaCadenciaMin: 15,
  /** ligação: os spans amostrados até ~500 mil linhas (no máximo ~0,5 GiB lidos por hora) e a contagem do volume (1/10.000) */
  ligacaoSpansMaxGib: 0.5,
  contagemSpansFracao: 1 / 10000,
  /** sessões da última hora: a cada 15 min, janela de 1 h, só nas horas de uso */
  ultimaHoraCadenciaMin: 15,
  ultimaHoraJanelaMin: 60,
  /** leitura ao vivo: até 13 min da cópia (começo < 5 min + fim de 3 a 8 min), navegação, erro e experiência uma vez */
  aoVivoMin: 13,
  /** leituras pequenas por carga: fatias guardadas (7 leitores, cada um com os registros de controle), erros com exemplos
      (2 leituras) e as 24 h analisadas (2 consultas, sessões e requisições, cada uma com os registros de controle; a aba
      guarda 5 min, então trocar de aplicação ou de período não relê) */
  leitoresAgregados: 14,
  leitoresErros: 2,
  leitoresHoras: 4,
  /** 1.44.6, medido no LAB: o desenho de 24 h do grafo (agregados de navegação das 24 h, com o controle) roda em toda
      carga com período de até 1 hora, na Visão geral e no Flow (antes contado só no Flow) */
  leitoresDesenho24h: 2,
  /** 1.46.1: a origem de aba nova ou frame (BAS-10) sai das fatias (grupo orig): a leitura das fatias do período e a cobertura
      (registros de controle), 2 leituras pequenas no bucket de agregados. Antes lia as navegações da cópia do período. Com
      aplicação mobile no escopo, a entrada e o híbrido (BAS-09 e BAS-11) ainda leem a cópia do período (fora desta conta) */
  leiturasOrigensFatias: 2,
  /** Flow: a ligação das 24 h analisadas (com o controle) e, sem filtro de segmento e com período de até 24 h, as
      aplicações dos últimos 7 dias nos agregados (BCK-06) */
  leitoresFlowHoras: 2,
  diasAgregadosFlow: 7,
  /** filtro de segmento, robôs ou frames: a Visão geral lê o período da cópia (navegação × 4 + erro × 4 + requisição); 1.46.1:
      com eles, o período vai no máximo até a última hora (MAX_JANELA_FILTRO_MIN, lib/queries.ts) */
  filtroJanelaMaxMin: 60,
  filtroNavegacao: 4,
  filtroErro: 4,
  /** "Isolar" e "Por quê?": o período da navegação, 2 leituras; 1.46.3: no máximo a última hora (o veredito do "Por quê?" em período
      longo sai das horas analisadas, junto com o funil; destinos, sessões e "Isolar" vão até a última hora) */
  analiseJanelaMaxMin: 60,
  analiseNavegacao: 2,
  /** "Onde falha no backend?": spans de até 12 min em volta das falhas; o filtro de trace direto lê cerca da metade */
  spansOndeFalhaMin: 12,
  fatorFiltroTrace: 0.5,
} as const;

const GIB = 2 ** 30;

export interface Estimativa {
  copia: {
    registrosDia: number; gibDia: number;
    /** por bucket: navegação, erro e requisição */
    gibNavDia: number; gibErroDia: number; gibReqDia: number;
    experienciaRegistrosDia: number; experienciaGibDia: number;
  };
  workflows: {
    /** GiB lidos por mês por peça */
    fatiasGibMes: number; horaSessoesGibMes: number; horaFunisGibMes: number; horaReqGibMes: number; horaLigacaoGibMes: number; ultimaHoraGibMes: number;
    gibMes: number; custoMes: number;
    invocacoesMes: number; custoFuncoesMes: number;
  };
  /** o que os workflows gravam: agregados de fatia, erros com exemplos e a análise de hora em hora */
  gravado: { agregadosGibDia: number; errosGibDia: number; horasGibDia: number; custoGravacaoMes: number; custoRetencaoMes: number };
  /** por carga de tela e por abertura do Flow; por mês */
  cargas: { aoVivoGib: number; agregadosGib: number; errosGib: number; horasGib: number; grafoGib: number; flowGib: number; gibMes: number; custoMes: number };
  sobDemanda: { filtroGib: number; analiseGib: number; ondeFalhaGib: number; gibMes: number; custoMes: number };
  retencao: { gibGuardado: number; custoMes: number };
  /** gravação da cópia, à parte: só se o contrato cobrar a extração do OpenPipeline */
  gravacaoCopia: { gibMes: number; custoMes: number };
  /** workflows + funções + gravado + cargas + sob demanda + retenção da cópia (sem a gravação da cópia) */
  totalMes: number;
  totalMesComGravacao: number;
  /** o que é fixo (workflows, funções, gravado, retenção) e o que depende do uso (cargas de tela e leituras sob demanda) */
  fixoMes: number;
  usoMes: number;
  /** total por mês dividido por (sessões por dia ÷ 1.000); 0 sem sessões */
  custoPorMilSessoesDia: number;
}

/** Número finito e não negativo; qualquer outra coisa vira 0. */
const sanear = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };

/** Estimativa mensal (teto) pela volumetria e pelas tarifas. Pura: mesma entrada, mesma saída. Com zero sessões devolve
    zero em tudo: sem tráfego não há cópia, fatia, hora analisada nem o que abrir no app. */
export function estimarCustos(v0: Volumetria, t0: Tarifas): Estimativa {
  const v: Volumetria = {
    sessoesDia: sanear(v0.sessoesDia), navegacoesPorSessao: sanear(v0.navegacoesPorSessao), chamadasPorSessao: sanear(v0.chamadasPorSessao),
    errosPorSessao: sanear(v0.errosPorSessao), experienciaPorSessao: sanear(v0.experienciaPorSessao), paginasDistintas: sanear(v0.paginasDistintas), spansGibHora: sanear(v0.spansGibHora),
    horasUsoDia: Math.min(sanear(v0.horasUsoDia), 24), jornadasSalvas: sanear(v0.jornadasSalvas), cargasDia: sanear(v0.cargasDia), cargasFlowDia: sanear(v0.cargasFlowDia),
    aberturasFiltroDia: sanear(v0.aberturasFiltroDia), analisesDia: sanear(v0.analisesDia), cliquesOndeFalhaDia: sanear(v0.cliquesOndeFalhaDia), janelaMin: sanear(v0.janelaMin), tempoReal: v0.tempoReal !== false,
  };
  const t: Tarifas = {
    consultaPorGib: sanear(t0.consultaPorGib), retencaoPorGibDia: sanear(t0.retencaoPorGibDia), gravacaoPorGib: sanear(t0.gravacaoPorGib),
    funcaoPorInvocacao: sanear(t0.funcaoPorInvocacao), moeda: t0.moeda,
  };
  const ativo = v.sessoesDia > 0 ? 1 : 0;
  const gib = (registros: number) => (registros * MODELO.bytesPorRegistro) / GIB;
  const M = MODELO.diasMes, D = MODELO.minutosDia;

  // cópia: um registro por navegação, chamada e erro; experiência: resumos, cliques, ações e aberturas
  const gibNavDia = gib(v.sessoesDia * v.navegacoesPorSessao), gibErroDia = gib(v.sessoesDia * v.errosPorSessao), gibReqDia = gib(v.sessoesDia * v.chamadasPorSessao);
  const registrosDia = v.sessoesDia * (v.navegacoesPorSessao + v.chamadasPorSessao + v.errosPorSessao);
  const gibDia = gibNavDia + gibErroDia + gibReqDia;
  const experienciaRegistrosDia = v.sessoesDia * v.experienciaPorSessao, experienciaGibDia = gib(experienciaRegistrosDia);

  // workflows (GiB por mês): cada fatia lida uma vez; cada hora analisada uma vez (sessões e funis com a volta e a espera);
  // a última hora só nas horas de uso
  const fatiasGibMes = (gibNavDia + gibErroDia + experienciaGibDia) * M;
  const horaSessoesGibMes = ((gibNavDia + gibErroDia) * MODELO.horaSessoesMin) / 60 * M;
  const horaFunisGibMes = v.jornadasSalvas > 0 ? horaSessoesGibMes : 0;
  const horaReqGibMes = ((gibDia * MODELO.horaReqMin) / 60) * M;
  // 1.45.2: requisições e ligação da mesma hora numa leitura só da cópia (horaReqGibMes); a ligação soma só o lado dos spans
  const horaLigacaoGibMes = (ativo * 24 * (Math.min(v.spansGibHora, MODELO.ligacaoSpansMaxGib) + v.spansGibHora * MODELO.contagemSpansFracao)) * M;
  const ultimaHoraGibMes = ativo * v.horasUsoDia * (60 / MODELO.ultimaHoraCadenciaMin) * ((gibNavDia + gibErroDia) * MODELO.ultimaHoraJanelaMin) / D * M;
  const gibWorkflowsMes = fatiasGibMes + horaSessoesGibMes + horaFunisGibMes + horaReqGibMes + horaLigacaoGibMes + ultimaHoraGibMes;
  // um workflow a cada 5 min (1.44.5): as fatias em toda execução e as sessões da última hora e a análise de hora em hora em
  // execuções alternadas; cada execução cabe em 1 minuto = uma invocação (eram três workflows, 288 + 96 + 96 por dia)
  const invocacoesMes = ativo * (D / MODELO.fatiaMin) * M;

  // o que os workflows gravam (pela API: cobrado como gravação) e guardam
  const agregadosGibDia = (ativo * v.paginasDistintas * MODELO.linhasPorPaginaFatia * (D / MODELO.fatiaMin) * MODELO.bytesPorAgregado) / GIB;
  const errosGibDia = (ativo * v.paginasDistintas * MODELO.linhasErroPorPaginaFatia * (D / MODELO.fatiaMin) * MODELO.bytesPorErro) / GIB;
  const horasGibDia = (ativo * v.paginasDistintas * MODELO.linhasHoraPorPagina * 24 * MODELO.bytesPorLinhaHora) / GIB;
  const custoGravacao = (agregadosGibDia + errosGibDia + horasGibDia) * M * t.gravacaoPorGib;
  const custoRetencaoGravado = (agregadosGibDia * MODELO.diasRetencaoAgregados + errosGibDia * MODELO.diasRetencaoErros + horasGibDia * MODELO.diasRetencaoHoras) * M * t.retencaoPorGibDia;

  // cargas de tela: o começo e o fim do período na cópia (uma leitura só) e as leituras pequenas dos buckets gravados; o
  // Flow lê o desenho de 24 h e a ligação das horas analisadas
  const fracaoJanela = Math.min(v.janelaMin, 7 * D) / D;
  const aoVivoGib = v.tempoReal === false ? 0 : ativo * (MODELO.aoVivoMin / D) * (gibNavDia + gibErroDia + experienciaGibDia);
  const agregadosGib = agregadosGibDia * MODELO.leitoresAgregados * fracaoJanela;
  const errosGib = errosGibDia * MODELO.leitoresErros * fracaoJanela;
  const horasGib = horasGibDia * MODELO.leitoresHoras;
  // o grafo de cada carga: a origem de aba nova ou frame. 1.45.9: sem o desenho de 24 h. 1.46.1: pelas fatias (grupo orig, leitura
  // e cobertura no bucket de agregados), não mais pelas navegações da cópia do período
  const grafoGib = agregadosGibDia * MODELO.leiturasOrigensFatias * fracaoJanela;
  // 1.45.9: as entidades das aplicações habilitadas saem de graça (antes, 7 dias dos agregados por abertura, BCK-06)
  const flowGib = horasGibDia * MODELO.leitoresFlowHoras;
  const cargasGibMes = ((aoVivoGib + agregadosGib + errosGib + horasGib + grafoGib) * v.cargasDia + flowGib * v.cargasFlowDia) * M;

  // sob demanda: filtro de segmento, robôs ou frames (a Visão geral lê a cópia do período), "Isolar" e "Por quê?" e "Onde falha"
  const fracaoSob = Math.min(v.janelaMin, D) / D;
  const fracaoFiltro = Math.min(v.janelaMin, MODELO.filtroJanelaMaxMin, D) / D;   // 1.46.1: com filtro, no máximo a última hora
  const filtroGib = fracaoFiltro * (MODELO.filtroNavegacao * gibNavDia + MODELO.filtroErro * gibErroDia + gibReqDia);
  const analiseGib = (Math.min(v.janelaMin, MODELO.analiseJanelaMaxMin, D) / D) * MODELO.analiseNavegacao * gibNavDia;
  const ondeFalhaGib = ativo * ((v.spansGibHora * MODELO.spansOndeFalhaMin) / 60) * MODELO.fatorFiltroTrace;
  const sobDemandaGibMes = (filtroGib * v.aberturasFiltroDia + analiseGib * v.analisesDia + ondeFalhaGib * v.cliquesOndeFalhaDia) * M;

  // retenção da cópia e da experiência: 1 dia
  const gibGuardado = (gibDia + experienciaGibDia) * MODELO.diasRetencaoCopia;
  const custoRetencao = gibGuardado * M * t.retencaoPorGibDia;

  const custoWorkflows = gibWorkflowsMes * t.consultaPorGib;
  const custoFuncoes = invocacoesMes * t.funcaoPorInvocacao;
  const custoCargas = cargasGibMes * t.consultaPorGib;
  const custoSobDemanda = sobDemandaGibMes * t.consultaPorGib;
  const fixoMes = custoWorkflows + custoFuncoes + custoGravacao + custoRetencaoGravado + custoRetencao;
  const totalMes = fixoMes + custoCargas + custoSobDemanda;
  const gravacaoCopiaGibMes = (gibDia + experienciaGibDia) * M;
  const custoGravacaoCopia = gravacaoCopiaGibMes * t.gravacaoPorGib;
  return {
    copia: { registrosDia, gibDia, gibNavDia, gibErroDia, gibReqDia, experienciaRegistrosDia, experienciaGibDia },
    workflows: { fatiasGibMes, horaSessoesGibMes, horaFunisGibMes, horaReqGibMes, horaLigacaoGibMes, ultimaHoraGibMes, gibMes: gibWorkflowsMes, custoMes: custoWorkflows, invocacoesMes, custoFuncoesMes: custoFuncoes },
    gravado: { agregadosGibDia, errosGibDia, horasGibDia, custoGravacaoMes: custoGravacao, custoRetencaoMes: custoRetencaoGravado },
    cargas: { aoVivoGib, agregadosGib, errosGib, horasGib, grafoGib, flowGib, gibMes: cargasGibMes, custoMes: custoCargas },
    sobDemanda: { filtroGib, analiseGib, ondeFalhaGib, gibMes: sobDemandaGibMes, custoMes: custoSobDemanda },
    retencao: { gibGuardado, custoMes: custoRetencao },
    gravacaoCopia: { gibMes: gravacaoCopiaGibMes, custoMes: custoGravacaoCopia },
    totalMes,
    totalMesComGravacao: totalMes + custoGravacaoCopia,
    fixoMes,
    usoMes: custoCargas + custoSobDemanda,
    custoPorMilSessoesDia: v.sessoesDia > 0 ? totalMes / (v.sessoesDia / 1000) : 0,
  };
}
