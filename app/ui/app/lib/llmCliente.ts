/* Análise ESTRUTURAL por LLM pela tela ("Analisar com LLM"): os tipos que a função do app "analise-llm"
   (app/api/analise-llm.function.ts) devolve, as chamadas e a orquestração. A função roda no servidor da plataforma
   com a identidade de quem clicou; a chave do LLM e o pedido montado nunca voltam para o navegador. O servidor importa
   este arquivo só pelos tipos.

   Fluxo (cerca de 3 min, cada chamada da função abaixo de 80 s e do teto de 120 s da plataforma):
     1. coleta: os dossiês de evidências das oportunidades priorizadas (lib/dossie.ts), no navegador, sob demanda;
        a verificação de privacidade roda antes de qualquer envio;
     2. iniciar: dossiês e contexto vão para a função, que valida, sanitiza e verifica de novo, aplica a regra de uso
        (reserva) e guarda; nenhuma ida ao LLM;
     3. oportunidade: UMA chamada por oportunidade, em paralelo; cada uma é uma ida ao LLM com o dossiê dela
        (Problema x Causa x Solução x Benefício). A análise do ambiente conta como usada quando a PRIMEIRA termina bem;
     4. sintese: uma chamada com SÓ os resultados das oportunidades: causas estruturais comuns, priorização, ondas de
        30, 60 e 90 dias e iniciativas recomendadas.
   Retomada: o modo "status" traz a análise com o que já terminou; continuar roda só o que falta (não gasta de novo). */
import type { ContextoAnalise, DossieLlm } from "./llmPacote";
import type { ColetaDossie, ProgressoColeta } from "./dossie";

export const FUNCAO_LLM = "analise-llm";

export type Esforco = "P" | "M" | "G";
export type Onda = "30" | "60" | "90";
export type Confianca = "alta" | "media" | "baixa";
export type Camada = "arquitetura" | "resiliencia" | "codigo" | "infraestrutura" | "observabilidade" | "processo";
export const CAMADAS: readonly Camada[] = ["arquitetura", "resiliencia", "codigo", "infraestrutura", "observabilidade", "processo"];

/** O resultado de UMA oportunidade, no formato Problema x Causa x Solução x Benefício. */
export interface ResultadoOportunidade {
  problema: { resumo: string; numerosChave: string[] };
  causaRaiz: {
    afirmacao: string; causaEstrutural: string;
    /** assinatura técnica (serviço, endpoint, exceção, arquivo:linha, início): a síntese compara as oportunidades por ela */
    assinatura: string;
    cadeia:{ evidencia: string; fonte: string; prova: string }[];
    confianca: Confianca; justificativa: string;
    descartadas: { hipotese: string; porQue: string }[];
    emAberto: { hipotese: string; comoConfirmar: string }[];
  };
  solucao: { rapida: { acao: string; onde: string; prazo: string }[]; estrutural: { acao: string; camada: Camada; detalhe: string }[] };
  /** só com medida real do dossiê: sessões (e clientes) por mês e conversão; null quando o dado não permite */
  beneficio: { sessoesAfetadasDia: number | null; sessoesRecuperadasDia: number | null; sessoesRecuperadasMes: number | null; conversaoAtualPct: number | null; conversaoEsperadaPct: number | null; conta: string; premissas: string[]; naoMedido: string };
  esforco: { nivel: Esforco; justificativa: string };
  /** o indicador do DEF que prova o ganho */
  validacao: { indicadorDef: string; linhaDeBase: string; meta: string; comoMedir: string };
  riscos: string[];
}
export type EstadoOportunidade = "pendente" | "ok" | "erro";
export interface OportunidadeAnalisada {
  indice: number; id: string; titulo: string; tipo: string; canal: string; aplicacoes: string[]; dossieBytes: number;
  estado: EstadoOportunidade;
  resultado: ResultadoOportunidade | null;
  erro: { codigo: CodigoErroLlm; mensagem: string } | null;
  quando: string | null; ms: number | null; tokens: { entrada: number; saida: number } | null;
}
/** A síntese estrutural: recebe só os resultados das oportunidades. */
export interface SinteseLlm {
  resumoExecutivo: string;
  causasComuns: { causa: string; oportunidades: string[]; evidencias: string[]; oQueSepara: string; mudancaEstrutural: string; beneficioSessoesMes: number | null; confianca: Confianca }[];
  priorizacao: { id: string; ordem: number; razao: string }[];
  ondas: { onda: Onda; objetivo: string; acoes: string[]; oportunidades: string[]; indicadorDef: string }[];
  iniciativasRecomendadas: { servico: string; nomeServico: string; /** 1.47.10 (as de antes não têm: vale o nome em português) */ nomeServicoEn?: string; oportunidades: string[]; comoAjuda: string }[];
  oQueFaltaMedir: string[];
}

/** Qual motor respondeu: sempre dito na resposta (nunca troca de motor em silêncio). */
export interface MotorLlm { nome: string; provedor: "api-messages" | "simulado"; modelo: string; simulado: boolean }
/** O nome do motor na língua da tela (1.47.10): o simulado dos testes vem da função em português. */
export const nomeMotor = (m: Pick<MotorLlm, "nome" | "simulado">) => (m.simulado ? ((globalThis as { __DEF_IDIOMA?: string }).__DEF_IDIOMA === "en" ? "simulated LLM (local test server)" : "LLM simulado (servidor local de teste)") : m.nome);
export interface QuemUsou { nome: string; email: string; quando: string }
export interface UsoLlm {
  /** e-mail liberado: sem limite */
  ilimitado: boolean;
  /** false = quem está logado não pode pedir a análise (só a lista de liberados); a tela esconde o botão */
  autorizado: boolean;
  /** a análise está livre (regra de cota por ambiente, desligada por padrão: só a lista de liberados pede a análise) */
  disponivel: boolean;
  usada: QuemUsou | null;
  emAndamento: QuemUsou | null;
  /** esta chamada gastou a análise do ambiente */
  consumido?: boolean;
}
export interface ResultadoLlm {
  /** id da análise: as chamadas seguintes e a retomada usam ele */
  id: string;
  /** "legado" = análise da 1.34 (duas etapas): só o texto */
  formato: "estrutural" | "legado";
  oportunidades: OportunidadeAnalisada[];
  sintese: SinteseLlm | null;
  /** o que já existe: a tela retoma pelo que falta */
  estado: { total: number; prontas: number; falhas: number; pendentes: number; sintese: boolean; completa: boolean };
  /** período, escopo e a medida da coleta (bytes lidos e custo pelo preço de consulta em uso) */
  contexto: Pick<ContextoAnalise, "periodo" | "escopo" | "coleta" | "sessoesPorDia"> | null;
  /** texto pronto (montado no servidor do JSON, sem HTML do modelo) */
  markdown: string;
  motor: MotorLlm;
  /** quando a análise começou e quando a primeira oportunidade terminou bem */
  quando: string;
  por: { nome: string; email: string };
  periodo: string;
  usoConfirmado: boolean;
  /** síntese: quando terminou, tempo e tokens */
  sinteseMeta: { quando: string; ms: number; tokens: { entrada: number; saida: number } | null } | null;
}
export type CodigoErroLlm =
  | "ja-usada" | "em-andamento" | "pacote-invalido" | "pacote-com-dado-pessoal" | "estado-indisponivel" | "sem-permissao-registros" | "nao-autorizado" | "analise-nao-encontrada"
  | "reserva-expirada" | "sem-oportunidade-pronta"
  | "llm-nao-configurado" | "llm-timeout" | "llm-autenticacao" | "llm-limite" | "llm-indisponivel" | "llm-endpoint" | "llm-saida-bloqueada"
  | "llm-recusa" | "llm-resposta-invalida" | "llm-requisicao" | "entrada-invalida"
  /** a tela não falou com a função (sem a permissão app-engine:functions:run, teto de execução da plataforma, rede) */
  | "funcao-indisponivel";
export type ModoLlm = "status" | "iniciar" | "oportunidade" | "sintese" | "liberar" | "registros";
export interface Medida { duracaoMs: number; tokens: { entrada: number; saida: number } | null }
export interface RespostaIniciar { ok: true; modo: "iniciar"; resultado: ResultadoLlm; uso: UsoLlm; nova: boolean; duracaoMs: number; avisos: string[] }
export interface RespostaOportunidade extends Medida { ok: true; modo: "oportunidade"; oportunidade: OportunidadeAnalisada; uso: UsoLlm | null; reaproveitada: boolean; avisos: string[] }
export interface RespostaSintese extends Medida { ok: true; modo: "sintese"; resultado: ResultadoLlm; reaproveitada: boolean; avisos: string[] }
export interface RespostaLiberar { ok: true; modo: "liberar"; liberada: boolean }
export interface RespostaErro {
  ok: false; modo: ModoLlm; codigo: CodigoErroLlm; mensagem: string; detalhe?: string; erros?: string[]; motor: MotorLlm | null; uso?: UsoLlm; tentarDeNovoEmS?: number;
  /** o que já existe (uma oportunidade ou a síntese falhou: o resto continua valendo) */
  resultado?: ResultadoLlm;
  /** modo oportunidade: o estado da oportunidade que falhou */
  oportunidade?: OportunidadeAnalisada;
}
export interface RespostaStatus {
  ok: true; modo: "status";
  usuario: { nome: string; email: string };
  ambiente: string;
  uso: UsoLlm;
  llmConfigurado: boolean;
  motor: MotorLlm | null;
  /** a análise deste ambiente (a que contou o uso, se houver; senão a última), com o que já terminou */
  analise: ResultadoLlm | null;
}
export interface RegistroLlm {
  id: string; analiseId: string | null; etapa: "oportunidade" | "sintese" | "iniciar" | null; quando: string; ambiente: string; versaoApp: string; usuario: { nome: string; email: string }; ilimitada: boolean;
  resultado: string; motor: string | null; modelo: string | null; duracaoMs: number | null; pacoteBytes: number | null; tokens: { entrada: number; saida: number } | null;
  escopo: { aplicacoes: string[]; periodo: string } | null; oportunidades: { titulo: string; servico: string | null }[]; email: "enviado" | "desligado" | "falhou";
}
export interface RespostaRegistros { ok: true; modo: "registros"; registros: RegistroLlm[] }
export type RespostaLlm = RespostaIniciar | RespostaOportunidade | RespostaSintese | RespostaLiberar | RespostaStatus | RespostaRegistros | RespostaErro;

type Idioma = "pt" | "en";
export type EntradaLlm =
  | { modo: "status"; idioma?: Idioma }
  | { modo: "iniciar"; dossies: DossieLlm[]; contexto: ContextoAnalise; idioma?: Idioma }
  | { modo: "iniciar"; analiseId: string; idioma?: Idioma }
  | { modo: "oportunidade"; analiseId: string; indice: number; idioma?: Idioma }
  | { modo: "sintese"; analiseId: string; idioma?: Idioma; /** índices que a tela viu prontos: a função relê os que vierem atrasados do App State */ prontas?: number[] }
  | { modo: "liberar"; analiseId: string; idioma?: Idioma }
  | { modo: "registros"; idioma?: Idioma };

/** Chama a função (POST /api/analise-llm, o mesmo que functions.call do @dynatrace-sdk/app-utils). Erro de rede
    ou da plataforma vira RespostaErro, para a tela tratar num lugar só. */
export async function chamarLlm(entrada: EntradaLlm, sinal?: AbortSignal, f: typeof fetch = (...a) => fetch(...a)): Promise<RespostaLlm> {
  const modo = entrada.modo;
  try {
    const r = await f(`/api/${FUNCAO_LLM}`, { method: "POST", body: JSON.stringify(entrada), signal: sinal });
    const texto = await r.text();
    if (!r.ok) return { ok: false, modo, codigo: "funcao-indisponivel", mensagem: `HTTP ${r.status}`, detalhe: texto.slice(0, 200), motor: null };
    return JSON.parse(texto) as RespostaLlm;
  } catch (e) {
    return { ok: false, modo, codigo: "funcao-indisponivel", mensagem: e instanceof Error ? e.message : String(e), motor: null };
  }
}
export const statusLlm = (idioma?: Idioma) => chamarLlm({ modo: "status", idioma }) as Promise<RespostaStatus | RespostaErro>;

/* ---- Orquestração pela tela ------------------------------------------------------------------------------------------ */
export type EstadoPasso = "aguardando" | "analisando" | "pronta" | "falhou";
/** O progresso que a janela mostra: a coleta, cada oportunidade e a síntese. */
export interface ProgressoLlm {
  fase: "coleta" | "iniciando" | "oportunidades" | "sintese" | "pronto" | "erro";
  inicio: number;
  coleta: (ProgressoColeta & { custoRs?: number }) | null;
  oportunidades: { indice: number; titulo: string; estado: EstadoPasso; desde: number | null; ms: number | null; erro: string | null }[];
  sintese: { estado: EstadoPasso; desde: number | null; ms: number | null; erro: string | null };
  resultado: ResultadoLlm | null;
  erro: RespostaErro | null;
  uso?: UsoLlm;
}
/** Duração esperada (para a barra; medida no LAB em 17/10): coleta, cada oportunidade em paralelo e a síntese. */
export const DURACAO_ESPERADA_MS = { coleta: 30_000, oportunidade: 70_000, sintese: 70_000, total: 180_000 };
/** Quantas chamadas de oportunidade ao mesmo tempo (o LLM aguenta as 8; o navegador também). */
export const PARALELO = 8;

const TR = (pt: string, en: string) => ((globalThis as { __DEF_IDIOMA?: string }).__DEF_IDIOMA === "en" ? en : pt);
interface Opcoes { idioma?: Idioma; sinal?: AbortSignal; chamar?: typeof chamarLlm; agora?: () => number }

/** A análise nova: coleta, início, oportunidades em paralelo e síntese. */
export async function analisarComLlm(coletar: (aoProgresso: (p: ProgressoColeta) => void) => Promise<ColetaDossie>, aoProgresso: (p: ProgressoLlm) => void, o: Opcoes = {}): Promise<ProgressoLlm> {
  const agora = o.agora ?? Date.now, chamar = o.chamar ?? chamarLlm;
  const p: ProgressoLlm = { fase: "coleta", inicio: agora(), coleta: { etapa: "amostra", consultas: 0, bytes: 0 }, oportunidades: [], sintese: { estado: "aguardando", desde: null, ms: null, erro: null }, resultado: null, erro: null };
  const avisar = () => aoProgresso({ ...p, oportunidades: p.oportunidades.map((x) => ({ ...x })), sintese: { ...p.sintese } });
  avisar();
  let coleta: ColetaDossie;
  try { coleta = await coletar((c) => { p.coleta = c; avisar(); }); }
  catch (e) { return falhar(p, avisar, { ok: false, modo: "iniciar", codigo: "pacote-invalido", mensagem: TR("Não foi possível coletar as evidências no ambiente.", "Could not collect the evidence in the environment."), detalhe: e instanceof Error ? e.message : String(e), motor: null }); }
  p.coleta = { etapa: "pronto", consultas: coleta.contexto.coleta.consultas, bytes: coleta.bytes, custoRs: coleta.custoRs };
  if (coleta.achados.length) return falhar(p, avisar, { ok: false, modo: "iniciar", codigo: "pacote-com-dado-pessoal", mensagem: TR("As evidências ainda têm dado que não pode sair do ambiente; nada foi enviado.", "The evidence still has data that cannot leave the environment; nothing was sent."), erros: coleta.achados.slice(0, 10).map((a) => `${a.onde}: ${a.tipo}`), motor: null });
  if (!coleta.dossies.length) return falhar(p, avisar, { ok: false, modo: "iniciar", codigo: "pacote-invalido", mensagem: TR("Nenhuma oportunidade para analisar.", "No opportunity to analyze."), motor: null });
  p.fase = "iniciando"; avisar();
  const r = await chamar({ modo: "iniciar", dossies: coleta.dossies, contexto: coleta.contexto, idioma: o.idioma }, o.sinal);
  if (!r.ok) return falhar(p, avisar, r as RespostaErro);
  const ini = r as RespostaIniciar;
  p.uso = ini.uso;
  return seguir(ini.resultado, p, avisar, o);
}
/** Continua uma análise que parou (pelo status): reserva de novo se precisar e roda só as oportunidades e a síntese que faltam. */
export async function continuarAnalise(parcial: ResultadoLlm, aoProgresso: (p: ProgressoLlm) => void, o: Opcoes = {}): Promise<ProgressoLlm> {
  const agora = o.agora ?? Date.now, chamar = o.chamar ?? chamarLlm;
  const p: ProgressoLlm = { fase: "iniciando", inicio: agora(), coleta: null, oportunidades: [], sintese: { estado: "aguardando", desde: null, ms: null, erro: null }, resultado: parcial, erro: null };
  const avisar = () => aoProgresso({ ...p, oportunidades: p.oportunidades.map((x) => ({ ...x })), sintese: { ...p.sintese } });
  avisar();
  if (parcial.estado.completa) { p.fase = "pronto"; avisar(); return p; }
  const r = await chamar({ modo: "iniciar", analiseId: parcial.id, idioma: o.idioma }, o.sinal);
  if (!r.ok) return falhar(p, avisar, r as RespostaErro);
  p.uso = (r as RespostaIniciar).uso;
  return seguir((r as RespostaIniciar).resultado, p, avisar, o);
}

async function seguir(base: ResultadoLlm, p: ProgressoLlm, avisar: () => void, o: Opcoes): Promise<ProgressoLlm> {
  const agora = o.agora ?? Date.now, chamar = o.chamar ?? chamarLlm;
  p.resultado = base;
  p.oportunidades = base.oportunidades.map((x) => ({ indice: x.indice, titulo: x.titulo, estado: x.estado === "ok" ? "pronta" : "aguardando", desde: null, ms: x.ms, erro: null }));
  p.fase = "oportunidades"; avisar();
  const fila = base.oportunidades.filter((x) => x.estado !== "ok").map((x) => x.indice);
  let ultimoErro: RespostaErro | null = null;
  const trabalhador = async () => {
    for (let i = fila.shift(); i != null; i = fila.shift()) {
      const passo = p.oportunidades.find((x) => x.indice === i)!;
      passo.estado = "analisando"; passo.desde = agora(); avisar();
      const r = await chamar({ modo: "oportunidade", analiseId: base.id, indice: i, idioma: o.idioma }, o.sinal);
      passo.ms = agora() - passo.desde!;
      if (r.ok) {
        const x = r as RespostaOportunidade;
        passo.estado = "pronta";
        if (x.uso) p.uso = x.uso;
        p.resultado = { ...p.resultado!, oportunidades: p.resultado!.oportunidades.map((y) => (y.indice === i ? x.oportunidade : y)) };
      } else {
        const er = r as RespostaErro;
        passo.estado = "falhou"; passo.erro = mensagemDoErro(er); ultimoErro = er;
        if (er.uso) p.uso = er.uso;
        if (er.oportunidade) p.resultado = { ...p.resultado!, oportunidades: p.resultado!.oportunidades.map((y) => (y.indice === i ? er.oportunidade! : y)) };
      }
      avisar();
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALELO, Math.max(1, fila.length)) }, trabalhador));
  const prontas = p.oportunidades.filter((x) => x.estado === "pronta").length;
  if (!prontas) {
    await chamar({ modo: "liberar", analiseId: base.id, idioma: o.idioma }, o.sinal).catch(() => undefined);
    return falhar(p, avisar, ultimoErro ?? { ok: false, modo: "oportunidade", codigo: "sem-oportunidade-pronta", mensagem: TR("Nenhuma oportunidade foi analisada.", "No opportunity was analyzed."), motor: null });
  }
  if (base.sintese && !p.oportunidades.some((x) => x.estado === "pronta" && base.oportunidades.find((y) => y.indice === x.indice)?.estado !== "ok")) {
    p.sintese = { estado: "pronta", desde: null, ms: base.sinteseMeta?.ms ?? null, erro: null };
  } else {
    p.fase = "sintese"; p.sintese = { estado: "analisando", desde: agora(), ms: null, erro: null }; avisar();
    const s = await chamar({ modo: "sintese", analiseId: base.id, idioma: o.idioma, prontas: p.oportunidades.filter((x) => x.estado === "pronta").map((x) => x.indice) }, o.sinal);
    p.sintese.ms = agora() - p.sintese.desde!;
    if (!s.ok) {
      const er = s as RespostaErro;
      p.sintese.estado = "falhou"; p.sintese.erro = mensagemDoErro(er);
      if (er.resultado) p.resultado = er.resultado;
      return falhar(p, avisar, er);
    }
    p.sintese.estado = "pronta";
    p.resultado = (s as RespostaSintese).resultado;
  }
  p.fase = p.resultado?.estado.completa ? "pronto" : "erro";
  if (p.fase === "erro") p.erro = ultimoErro ?? { ok: false, modo: "oportunidade", codigo: "sem-oportunidade-pronta", mensagem: TR("Parte das oportunidades não foi analisada.", "Some opportunities were not analyzed."), motor: null };
  avisar();
  return p;
}
function falhar(p: ProgressoLlm, avisar: () => void, er: RespostaErro): ProgressoLlm {
  p.fase = "erro"; p.erro = er;
  if (er.uso) p.uso = er.uso;
  if (er.resultado) p.resultado = er.resultado;
  avisar();
  return p;
}
/** Ao abrir a tela: o que o status tem e o que falta. */
export function proximoPasso(s: RespostaStatus): "nova" | "continuar" | "pronta" {
  if (!s.analise) return "nova";
  return s.analise.formato === "legado" || s.analise.estado.completa ? "pronta" : "continuar";
}

/* ---- Ligação com a tela ---------------------------------------------------------------------------------------------- */
/** O que a App.tsx entrega à Visão geral para o "Analisar com LLM": a coleta dos dossiês (lib/dossie.ts, com as
    oportunidades na ordem da tela) e as chamadas da função (com a retomada pelo status). A Visão geral
    (components/Inicio.tsx) junta isso ao que a janela espera (AjudaLlm). */
export interface FabricaLlm {
  coletar: (x: { oportunidades: import("./oportunidades").Oportunidade[]; jornadas: import("./oportunidades").JornadaOp[] | null; chamadas: import("./oportunidades").LinhaChamadaEstado[] | null }, aoProgresso: (p: ProgressoColeta) => void) => Promise<ColetaDossie>;
  statusLlm: () => Promise<RespostaStatus | RespostaErro>;
  idioma: Idioma;
  contato?: string;
}
/** Mensagem do erro: a do servidor (no idioma pedido); a da tela quando a função nem respondeu. */
export const mensagemDoErro = (e: RespostaErro) => e.codigo === "funcao-indisponivel"
  ? TR(`Não foi possível falar com a função do app (${e.mensagem}). Confira a permissão app-engine:functions:run e tente de novo.`, `Could not reach the app function (${e.mensagem}). Check the app-engine:functions:run permission and try again.`)
  : `${e.mensagem}${e.tentarDeNovoEmS ? TR(` Tente de novo em ${e.tentarDeNovoEmS} s.`, ` Try again in ${e.tentarDeNovoEmS} s.`) : ""}`;
/** A regra de uso como a janela mostra (sem e-mail). `configurado` = a função tem a chave do LLM (status.llmConfigurado). */
export const usoDaTela = (u?: UsoLlm | null, configurado = true) => (u ? {
  ilimitado: u.ilimitado, autorizado: u.autorizado !== false, configurado, disponivel: u.disponivel,
  usada: u.usada ? { nome: u.usada.nome, quando: u.usada.quando } : null, emAndamento: u.emAndamento ? { nome: u.emAndamento.nome, quando: u.emAndamento.quando } : null,
} : undefined);
