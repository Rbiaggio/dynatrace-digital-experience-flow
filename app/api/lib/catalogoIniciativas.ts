/* Catálogo de tipos de iniciativa para a seção "Iniciativas recomendadas" da análise. EDITÁVEL: quem instala o app
   ajusta nomes, descrições e quando indicar; o id é o que o modelo devolve (e o que fica no registro de uso),
   então trocar um id muda o histórico. Sem preços nem promessa de resultado. */
export interface Iniciativa {
  id: string;
  nome: string;
  descricao: string;
  /** sinais do pacote que indicam esta iniciativa (ajuda o modelo a escolher) */
  quandoIndicar: string;
}

export const CATALOGO_INICIATIVAS: Iniciativa[] = [
  { id: "diagnostico-experiencia", nome: "Diagnosticar a experiência digital e a observabilidade",
    descricao: "Diagnóstico estruturado das jornadas, da instrumentação e da operação, com priorização pelo impacto no cliente e roteiro de evolução.",
    quandoIndicar: "Muitos problemas de naturezas diferentes, sem dono claro, ou necessidade de priorizar com o negócio." },
  { id: "engenharia-performance", nome: "Melhorar o desempenho web e mobile",
    descricao: "Análise e correção de lentidão de carga e interação (Web Vitals, Apdex), testes de carga e otimização de frontend e APIs.",
    quandoIndicar: "Apdex Razoável, Ruim ou Inaceitável, p75 de carga acima de 3 s, saídas por carga lenta." },
  { id: "correcao-aplicacoes", nome: "Corrigir as aplicações pela causa raiz",
    descricao: "Correção das falhas de backend e frontend com causa raiz, testes automatizados e entrega contínua.",
    quandoIndicar: "Erros de servidor (HTTP 5xx) ou de tela concentrados em páginas e endpoints que tiram clientes do fluxo." },
  { id: "sre-confiabilidade", nome: "Definir metas de confiabilidade (SLO) e resiliência",
    descricao: "SLOs por jornada, error budgets, alertas acionáveis, revisão de incidentes e práticas de resiliência.",
    quandoIndicar: "Falhas recorrentes em serviços de backend, picos de erro, ausência de metas de confiabilidade por jornada." },
  { id: "instrumentacao-qualidade", nome: "Melhorar a instrumentação e a qualidade do dado",
    descricao: "Nome de telas, monitoramento híbrido de WebView, propagação de trace entre domínios, tags de negócio e padrões de captura.",
    quandoIndicar: "Problemas de qualidade do dado: telas sem nome, páginas sem origem, chamadas sem trace, frames." },
  { id: "jornadas-negocio", nome: "Medir as jornadas de negócio e a conversão",
    descricao: "Definição de jornadas e funis, indicadores de conversão e abandono, eventos de negócio e painéis para as áreas de produto.",
    quandoIndicar: "Funis com queda forte entre etapas, poucas jornadas definidas, abandono depois de erro." },
  { id: "automacao-aiops", nome: "Automatizar a detecção e a resposta (AIOps)",
    descricao: "Workflows de detecção e resposta, remediação automática, correlação de eventos e uso de IA na operação.",
    quandoIndicar: "Problemas que se repetem e poderiam ser detectados ou corrigidos automaticamente." },
  { id: "governanca-observabilidade", nome: "Organizar a governança e os painéis executivos",
    descricao: "Modelo de responsabilidade por serviço e jornada, painéis executivos, rituais de acompanhamento e gestão de custo da plataforma.",
    quandoIndicar: "Vários times envolvidos, falta de visão executiva ou de dono por jornada e serviço." },
  { id: "acompanhamento-continuo", nome: "Acompanhar a observabilidade de forma contínua",
    descricao: "Revisão periódica da experiência digital, tratamento de alertas e evolução da plataforma.",
    quandoIndicar: "Necessidade de acompanhar os indicadores depois das correções." },
  { id: "monitoracao-sintetica", nome: "Testar as jornadas críticas com monitoração sintética",
    descricao: "Testes sintéticos das jornadas críticas, de várias regiões, para detectar falhas antes do cliente e validar correções.",
    quandoIndicar: "Jornadas críticas sem teste ativo, problemas regionais, necessidade de provar a correção." },
];

export const idsCatalogo = (c: Iniciativa[] = CATALOGO_INICIATIVAS) => c.map((s) => s.id);
export const nomeServico = (id: string | null, c: Iniciativa[] = CATALOGO_INICIATIVAS) => (id ? c.find((s) => s.id === id)?.nome ?? id : "");
