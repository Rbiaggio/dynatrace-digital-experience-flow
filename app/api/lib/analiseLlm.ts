/* O que a função "analise-llm" faz, sem nada da plataforma (as dependências chegam de fora: App State, identidade,
   ambiente, LLM, e-mail e relógio), para os testes rodarem com falsos. Análise ESTRUTURAL (1.35), modos:
   - status: quem é o usuário, se a análise do ambiente está livre e a análise já feita, com o que já terminou;
   - iniciar: os dossiês (lib/dossie.ts) e o contexto -> valida, sanitiza e verifica de novo (o navegador não é confiável),
     aplica a regra de uso (reserva para quem não está liberado) e guarda; nenhuma ida ao LLM. Com analiseId (sem dossiês):
     retomada, reserva de novo se a análise ainda não contou e a reserva venceu;
   - oportunidade: UMA oportunidade (o dossiê guardado) -> uma ida ao LLM (Problema x Causa x Solução x Benefício). A
     análise do ambiente conta como USADA quando a primeira oportunidade termina bem; falha não gasta; o que já terminou é
     reaproveitado;
   - sintese: SÓ os resultados das oportunidades -> uma ida ao LLM (causas estruturais comuns, priorização, ondas e
     iniciativas recomendadas); não gasta de novo, repete se falhar;
   - liberar: nenhuma oportunidade terminou bem: a reserva volta a ficar livre (senão vence sozinha em 4 min);
   - registros: os registros de uso para quem está na lista de liberados.
   Cada chamada faz no máximo UMA ida ao LLM, abaixo de 80 s no esperado e do teto de 120 s da app function. Nunca devolve
   a chave, o pedido montado nem a resposta crua do provedor. Cada oportunidade e cada dossiê ficam numa chave própria do
   App State (sem gravação concorrente na mesma chave). */
import { validarDossie, sanitizarDossie, verificarDossie, sanitizarContexto, verificarContexto, bytesDe, MAX_OPORTUNIDADES, type ContextoAnalise, type DossieLlm } from "../../ui/app/lib/llmPacote";
import type {
  CodigoErroLlm, MotorLlm, OportunidadeAnalisada, RegistroLlm, RespostaLlm, RespostaErro, RespostaIniciar, RespostaOportunidade, RespostaSintese,
  ResultadoLlm, ResultadoOportunidade, SinteseLlm, UsoLlm,
} from "../../ui/app/lib/llmCliente";
import { CATALOGO_INICIATIVAS, nomeServico, nomeServicoEn, type Iniciativa } from "./catalogoIniciativas";
import { chamarLLM, ErroLLM, llmConfigurado, motorDe, PADRAO_LLM, type ConfigLLM, type CodigoLLM, type RespostaLLM } from "./chamadaLlm";
import { lerOportunidade, lerSintese, markdownDaAnalise, markdownLegado, montarPedidoOportunidade, montarPedidoSintese, type Idioma } from "./promptLlm";
import {
  confirmarUso, ehLiberado, gravarRegistro, lerUso, liberarUso, listarRegistros, PONTEIRO_CONTADA, PONTEIRO_ULTIMA, PREFIXO_ANALISE, quem, reservarUso, situacao, SOMENTE_LIBERADOS,
  type Estado, type Usuario,
} from "./usoLlm";

/** E-mail para os administradores a cada análise (quando a primeira oportunidade termina bem): preparado e DESLIGADO. Ligar
    exige o escopo email:emails:send no app.config.json e a permissão de enviar e-mail para quem usa o app. */
export const EMAIL_ADMINS = { habilitado: false, para: [] as string[], assunto: "Digital Experience Flow: uso da análise por LLM" };
export type EnviarEmail = (para: string[], assunto: string, corpo: string) => Promise<void>;
/** Quanto tempo vale o "estou analisando" de uma oportunidade e da síntese (mais que o teto da chamada ao LLM). */
const ANDAMENTO_MS = 150_000;

export interface Dependencias {
  estado: Estado;
  usuario: () => Usuario;
  ambiente: () => { id: string; url: string };
  versaoApp: () => string;
  llm: ConfigLLM;
  fetch?: typeof fetch;
  agora?: () => number;
  gerarId?: () => string;
  /** espera entre a gravação e a releitura das marcas (os testes encurtam) */
  espera?: (ms: number) => Promise<void>;
  /** só a lista de liberados pode pedir a análise (padrão SOMENTE_LIBERADOS); os testes da regra de 1 por ambiente desligam */
  somenteLiberados?: boolean;
  enviarEmail?: EnviarEmail;
  email?: { habilitado: boolean; para: string[]; assunto: string };
  catalogo?: Iniciativa[];
  log?: (msg: string) => void;
}

/** A análise guardada no App State (chave própria por análise; dossiês e oportunidades em chaves próprias). */
export interface AnaliseGuardada {
  id: string; versao: 3; ambiente: string; por: { nome: string; email: string };
  /** começada por alguém liberado: não conta na regra de uso */
  ilimitada: boolean;
  periodo: string; idioma: Idioma; criadaEm: string;
  contexto: ContextoAnalise;
  oportunidades: Pick<OportunidadeAnalisada, "indice" | "id" | "titulo" | "tipo" | "canal" | "aplicacoes" | "dossieBytes">[];
  reservaId: string | null;
  usoConfirmado: boolean;
  primeiraOkEm: string | null;
  sintese: { dados: SinteseLlm; cobre: number[]; motor: MotorLlm; quando: string; ms: number; tokens: RespostaLLM["tokens"] } | null;
  andamentoSintese: { id: string; ate: number } | null;
}
interface OpGuardada {
  indice: number; estado: "ok" | "erro" | "andamento"; resultado: ResultadoOportunidade | null; erro: { codigo: CodigoErroLlm; mensagem: string } | null;
  motor: MotorLlm | null; quando: string | null; ms: number | null; tokens: RespostaLLM["tokens"]; marca?: string; ate?: number;
}

const MENSAGENS: Record<CodigoErroLlm, [string, string]> = {
  "ja-usada": ["A análise por LLM deste ambiente já foi usada.", "The LLM analysis for this environment has already been used."],
  "em-andamento": ["Esta parte da análise já está sendo gerada por outra pessoa ou aba. Aguarde até 3 minutos e abra de novo: o resultado aparece para todos.", "This part of the analysis is already being generated by someone else or another tab. Wait up to 3 minutes and open it again: the result shows for everyone."],
  "pacote-invalido": ["As evidências não estão no formato esperado.", "The evidence is not in the expected format."],
  "pacote-com-dado-pessoal": ["As evidências ainda têm dado que não pode sair do ambiente; nada foi enviado.", "The evidence still has data that cannot leave the environment; nothing was sent."],
  "estado-indisponivel": ["Não foi possível ler ou gravar o registro de uso (App State). Nada foi enviado.", "Could not read or write the usage record (App State). Nothing was sent."],
  "sem-permissao-registros": ["Os registros de uso são só para os usuários liberados.", "Usage records are for allowed users only."],
  "nao-autorizado": ["A análise por LLM está disponível só para usuários liberados (lista de liberados do llm.local.ts).", "The LLM analysis is available only to allowed users (allowed e-mail)."],
  "analise-nao-encontrada": ["A análise não foi encontrada neste ambiente. Comece uma nova.", "The analysis was not found in this environment. Start a new one."],
  "reserva-expirada": ["A reserva da análise venceu antes desta oportunidade. Continue a análise para reservar de novo.", "The analysis reservation expired before this opportunity. Continue the analysis to reserve again."],
  "sem-oportunidade-pronta": ["Nenhuma oportunidade terminou; a síntese precisa de pelo menos uma.", "No opportunity finished; the synthesis needs at least one."],
  "llm-nao-configurado": ["A análise por LLM não está configurada neste app.", "The LLM analysis is not configured in this app."],
  "llm-timeout": ["O LLM não respondeu a tempo. Esta tentativa não gastou outra análise; tente de novo.", "The LLM did not answer in time. This attempt did not use another analysis; try again."],
  "llm-autenticacao": ["O LLM recusou a credencial do app. Avise o administrador do app.", "The LLM rejected the app credential. Let the app administrator know."],
  "llm-limite": ["O LLM está no limite de uso. Esta tentativa não gastou outra análise; tente de novo em alguns minutos.", "The LLM is at its usage limit. This attempt did not use another analysis; try again in a few minutes."],
  "llm-indisponivel": ["O LLM está indisponível. Esta tentativa não gastou outra análise; tente de novo mais tarde.", "The LLM is unavailable. This attempt did not use another analysis; try again later."],
  "llm-endpoint": ["O endereço do LLM não responde. Esta tentativa não gastou outra análise. Avise o administrador do app.", "The LLM address does not answer. This attempt did not use another analysis. Let the app administrator know."],
  "llm-saida-bloqueada": ["O ambiente bloqueia a saída para o LLM (lista de conexões externas do AppEngine).", "The environment blocks outbound calls to the LLM (AppEngine external connections list)."],
  "llm-recusa": ["O modelo recusou o pedido. Esta tentativa não gastou outra análise.", "The model declined the request. This attempt did not use another analysis."],
  "llm-resposta-invalida": ["O LLM devolveu uma resposta que não deu para ler. Esta tentativa não gastou outra análise; tente de novo.", "The LLM returned an unreadable answer. This attempt did not use another analysis; try again."],
  "llm-requisicao": ["O LLM recusou o pedido. Esta tentativa não gastou outra análise. Avise o administrador do app.", "The LLM rejected the request. This attempt did not use another analysis. Let the app administrator know."],
  "entrada-invalida": ["Pedido inválido: modo deve ser status, iniciar, oportunidade, sintese, liberar ou registros.", "Invalid request: mode must be status, iniciar, oportunidade, sintese, liberar or registros."],
  "funcao-indisponivel": ["Não foi possível falar com a função do app. Confira a permissão app-engine:functions:run e tente de novo.", "Could not reach the app function. Check the app-engine:functions:run permission and try again."],
};
const msg = (c: CodigoErroLlm, idioma: Idioma) => MENSAGENS[c][idioma === "en" ? 1 : 0];
const CODIGO_LLM: Record<CodigoLLM, CodigoErroLlm> = {
  "nao-configurado": "llm-nao-configurado", timeout: "llm-timeout", autenticacao: "llm-autenticacao", limite: "llm-limite", indisponivel: "llm-indisponivel",
  endpoint: "llm-endpoint", "saida-bloqueada": "llm-saida-bloqueada", recusa: "llm-recusa", "resposta-invalida": "llm-resposta-invalida", requisicao: "llm-requisicao",
};

const idAleatorio = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
/** Marca "em andamento" (oportunidade ou síntese) sem compare-and-set: grava a marca com o nosso id e CONFIRMA relendo.
    O App State é de consistência eventual: a releitura logo depois da gravação pode vir de uma réplica ainda com a versão
    anterior (aconteceu no LAB em 17/10: a síntese gravou a marca, releu outra, desistiu e deixou a própria marca armada
    por 150 s, e ninguém mais conseguia gerar a síntese). Por isso: espera curta e até 3 releituras; a nossa marca em
    qualquer uma delas confirma; marca alheia só vale se aparecer em TODAS. Devolve a marca lida quando não é a nossa. */
const CONFIRMAR_MS = 300, RELEITURAS = 3;
async function assumirMarca<T extends { marca?: string; id?: string }>(ler: () => Promise<T | null>, gravar: () => Promise<void>, minha: string,
                                                                        espera: (ms: number) => Promise<void> = (ms) => new Promise((ok) => setTimeout(ok, ms))): Promise<{ minha: true } | { minha: false; lida: T | null }> {
  await gravar();
  let lida: T | null = null;
  for (let i = 0; i < RELEITURAS; i++) {
    await espera(CONFIRMAR_MS * (i + 1));
    lida = await ler();
    if ((lida?.marca ?? lida?.id) === minha) return { minha: true };
  }
  return { minha: false, lida };
}
const lerJson = <T>(s: string | null | undefined): T | null => { try { return s ? (JSON.parse(s) as T) : null; } catch { return null; } };
const erroDe = (e: unknown) => (e instanceof Error ? e.message : String(e));
const usoDe = (ilimitado: boolean, s: ReturnType<typeof situacao>, consumido?: boolean): UsoLlm =>
  ({ ilimitado, autorizado: true, disponivel: s.disponivel, usada: s.usada, emAndamento: s.emAndamento, ...(consumido !== undefined ? { consumido } : {}) });
/** Quem pode pedir a análise: com SOMENTE_LIBERADOS (padrão), só a lista `liberados` do llm.local.ts (e-mails ou
    "@dominio"). Nenhuma permissão de política entra aqui. */
const autorizado = (d: Dependencias, u: Usuario) => !(d.somenteLiberados ?? SOMENTE_LIBERADOS) || ehLiberado(u.email, d.llm.liberados);

export async function executar(entrada: unknown, d: Dependencias): Promise<RespostaLlm> {
  const e = (entrada && typeof entrada === "object" ? entrada : {}) as { modo?: unknown; dossies?: unknown; contexto?: unknown; analiseId?: unknown; indice?: unknown; idioma?: unknown; prontas?: unknown };
  const idioma: Idioma = e.idioma === "en" ? "en" : "pt";
  const modo = e.modo ?? "status";
  if (modo === "status") return status(d, idioma);
  if (modo === "registros") return registros(d, idioma);
  if (!autorizado(d, d.usuario())) {
    // recusa no servidor, mesmo que alguém chame a função por fora da tela; fica registrado para os administradores
    const m = typeof modo === "string" ? modo : "status";
    if (m === "iniciar") await registrar(d, registroBase(d, d.usuario(), false, "negado:nao-autorizado", { analiseId: null, etapa: "iniciar" }));
    return { ok: false, modo: (["iniciar", "oportunidade", "sintese", "liberar"].includes(m) ? m : "status") as RespostaErro["modo"], codigo: "nao-autorizado", mensagem: msg("nao-autorizado", idioma), motor: null };
  }
  if (modo === "iniciar") return e.dossies !== undefined ? iniciar(e.dossies, e.contexto, d, idioma) : retomar(e.analiseId, d, idioma);
  if (modo === "oportunidade") return oportunidade(e.analiseId, e.indice, d, idioma);
  if (modo === "sintese") return sintese(e.analiseId, d, idioma, Array.isArray(e.prontas) ? e.prontas.filter((x): x is number => Number.isInteger(x)) : []);
  if (modo === "liberar") return liberar(e.analiseId, d, idioma);
  return { ok: false, modo: "status", codigo: "entrada-invalida", mensagem: msg("entrada-invalida", idioma), motor: null };
}

/* ---- Análise guardada -------------------------------------------------------------------------------------------------- */
const chaveAnalise = (id: string) => `${PREFIXO_ANALISE}${id}`;
const chaveDossie = (id: string, i: number) => `${PREFIXO_ANALISE}${id}.d${i}`;
const chaveOp = (id: string, i: number) => `${PREFIXO_ANALISE}${id}.o${i}`;
type Lida = { tipo: "v3"; a: AnaliseGuardada } | { tipo: "legado"; bruto: Record<string, unknown> & { id: string } };
async function lerQualquer(estado: Estado, id: string): Promise<Lida | null> {
  if (!/^[\w-]{1,60}$/.test(id)) return null;   // vira parte da chave do App State
  const x = lerJson<Record<string, unknown> & { id: string; versao?: number }>((await estado.ler(chaveAnalise(id)))?.valor);
  if (!x || x.id !== id) return null;
  if (x.versao === 3) return { tipo: "v3", a: x as unknown as AnaliseGuardada };
  if (x.versao === 2 && x.etapa1) return { tipo: "legado", bruto: x };
  return null;
}
async function lerAnalise(estado: Estado, id: string): Promise<AnaliseGuardada | null> {
  const l = await lerQualquer(estado, id);
  return l?.tipo === "v3" ? l.a : null;
}
const gravarAnalise = (estado: Estado, a: AnaliseGuardada) => estado.gravar(chaveAnalise(a.id), JSON.stringify(a));
async function lerOps(estado: Estado, a: AnaliseGuardada): Promise<(OpGuardada | null)[]> {
  return Promise.all(a.oportunidades.map(async (o) => lerJson<OpGuardada>((await estado.ler(chaveOp(a.id, o.indice)))?.valor)));
}
const motorPadrao = (a: AnaliseGuardada, ops: (OpGuardada | null)[]): MotorLlm => a.sintese?.motor ?? ops.find((o) => o?.motor)?.motor ?? { nome: "LLM (API Messages)", provedor: "api-messages", modelo: "?", simulado: false };
/** O que a tela mostra: cada oportunidade no estado em que está, a síntese e o texto pronto. */
export function resultadoDe(a: AnaliseGuardada, ops: (OpGuardada | null)[], agora = Date.now()): ResultadoLlm {
  const oportunidades: OportunidadeAnalisada[] = a.oportunidades.map((m, k) => {
    const g = ops[k];
    const estado = g?.estado === "ok" ? "ok" : g?.estado === "erro" || (g?.estado === "andamento" && (g.ate ?? 0) <= agora) ? "erro" : "pendente";
    return { ...m, estado, resultado: g?.estado === "ok" ? g.resultado : null, erro: estado === "erro" ? g?.erro ?? { codigo: "llm-timeout", mensagem: msg("llm-timeout", a.idioma) } : null, quando: g?.quando ?? null, ms: g?.ms ?? null, tokens: g?.tokens ?? null };
  });
  const prontas = oportunidades.filter((o) => o.estado === "ok").length, falhas = oportunidades.filter((o) => o.estado === "erro").length;
  const sinteseVale = !!a.sintese && oportunidades.filter((o) => o.estado === "ok").every((o) => a.sintese!.cobre.includes(o.indice));
  const motor = motorPadrao(a, ops);
  // 1.47.10: as análises de antes não guardavam o nome em inglês da iniciativa: completa pelo catálogo a cada leitura
  const sintese = a.sintese?.dados ? { ...a.sintese.dados, iniciativasRecomendadas: a.sintese.dados.iniciativasRecomendadas.map((x) => ({ ...x, nomeServicoEn: x.nomeServicoEn ?? nomeServicoEn(x.servico) })) } : null;
  return {
    id: a.id, formato: "estrutural", oportunidades, sintese,
    estado: { total: oportunidades.length, prontas, falhas, pendentes: oportunidades.length - prontas - falhas, sintese: !!a.sintese, completa: prontas === oportunidades.length && sinteseVale },
    contexto: { periodo: a.contexto.periodo, escopo: a.contexto.escopo, coleta: a.contexto.coleta, sessoesPorDia: a.contexto.sessoesPorDia },
    markdown: markdownDaAnalise(oportunidades, sintese, { motor, quando: a.sintese?.quando ?? a.primeiraOkEm ?? a.criadaEm, periodo: a.periodo, idioma: a.idioma }),
    motor, quando: a.primeiraOkEm ?? a.criadaEm, por: a.por, periodo: a.periodo, usoConfirmado: a.usoConfirmado,
    sinteseMeta: a.sintese ? { quando: a.sintese.quando, ms: a.sintese.ms, tokens: a.sintese.tokens } : null,
  };
}
/** Análise da 1.34 (duas etapas): só o texto. */
function resultadoLegado(x: Record<string, unknown> & { id: string }): ResultadoLlm {
  const e1 = (x.etapa1 as { dados?: Parameters<typeof markdownLegado>[0]; motor?: MotorLlm; quando?: string } | undefined);
  const e2 = (x.etapa2 as { dados?: Parameters<typeof markdownLegado>[1] } | null | undefined);
  const idioma = x.idioma === "en" ? "en" : "pt";
  return {
    id: x.id, formato: "legado", oportunidades: [], sintese: null, estado: { total: 0, prontas: 0, falhas: 0, pendentes: 0, sintese: false, completa: true }, contexto: null,
    markdown: markdownLegado(e1?.dados ?? null, e2?.dados ?? null, idioma), motor: e1?.motor ?? { nome: "?", provedor: "api-messages", modelo: "?", simulado: false },
    quando: e1?.quando ?? "", por: (x.por as { nome: string; email: string }) ?? { nome: "", email: "" }, periodo: String(x.periodo ?? ""), usoConfirmado: true, sinteseMeta: null,
  };
}

async function status(d: Dependencias, idioma: Idioma): Promise<RespostaLlm> {
  const agora = (d.agora ?? Date.now)();
  const u = d.usuario(), ilimitado = ehLiberado(u.email, d.llm.liberados);
  const configurado = llmConfigurado(d.llm);
  // fora da lista de liberados: a tela esconde o botão e não recebe a análise guardada
  if (!autorizado(d, u)) return { ok: true, modo: "status", usuario: quem(u), ambiente: d.ambiente().id, uso: { ilimitado: false, autorizado: false, disponivel: false, usada: null, emAndamento: null }, llmConfigurado: configurado, motor: null, analise: null };
  try {
    const s = situacao(await lerUso(d.estado), agora);
    let resultado: ResultadoLlm | null = null;
    for (const p of [PONTEIRO_CONTADA, PONTEIRO_ULTIMA]) {
      const id = lerJson<{ id: string }>((await d.estado.ler(p))?.valor)?.id;
      const l = id ? await lerQualquer(d.estado, id) : null;
      if (l) { resultado = l.tipo === "v3" ? resultadoDe(l.a, await lerOps(d.estado, l.a), agora) : resultadoLegado(l.bruto); break; }
    }
    return { ok: true, modo: "status", usuario: quem(u), ambiente: d.ambiente().id, uso: usoDe(ilimitado, s), llmConfigurado: configurado, motor: configurado ? motorDe(d.llm) : null, analise: resultado };
  } catch (err) {
    return { ok: false, modo: "status", codigo: "estado-indisponivel", mensagem: msg("estado-indisponivel", idioma), detalhe: erroDe(err).slice(0, 200), motor: null };
  }
}

async function registros(d: Dependencias, idioma: Idioma): Promise<RespostaLlm> {
  const u = d.usuario();
  if (!ehLiberado(u.email, d.llm.liberados)) return { ok: false, modo: "registros", codigo: "sem-permissao-registros", mensagem: msg("sem-permissao-registros", idioma), motor: null };
  try { return { ok: true, modo: "registros", registros: await listarRegistros<RegistroLlm>(d.estado, 100) }; }
  catch (err) { return { ok: false, modo: "registros", codigo: "estado-indisponivel", mensagem: msg("estado-indisponivel", idioma), detalhe: erroDe(err).slice(0, 200), motor: null }; }
}

/** Uma ida ao LLM com a leitura da resposta; falha (inclusive JSON cortado ou fora do formato) vira ErroLLM. */
async function perguntar<T>(d: Dependencias, pedido: Parameters<typeof chamarLLM>[1], extra: Partial<ConfigLLM>, ler: (texto: string) => T | null, relogio: () => number): Promise<{ dados: T; r: RespostaLLM }> {
  const r = await chamarLLM({ ...d.llm, ...extra }, pedido, { fetch: d.fetch, agora: relogio });
  const dados = ler(r.texto);
  if (!dados) throw new ErroLLM("resposta-invalida", r.stopReason === "max_tokens" ? "A resposta do LLM foi cortada (max_tokens)." : "O LLM devolveu um JSON fora do formato pedido.");
  return { dados, r };
}
function erroLLM(err: unknown): { codigo: CodigoErroLlm; detalhe?: string; tentarDeNovoEmS?: number } {
  if (!(err instanceof ErroLLM)) return { codigo: "llm-indisponivel", detalhe: erroDe(err).slice(0, 200) };
  return { codigo: CODIGO_LLM[err.codigo], detalhe: [err.message, err.extra.detalhe].filter(Boolean).join(" · ").slice(0, 400) || undefined, tentarDeNovoEmS: err.extra.tentarDeNovoEmS };
}
const motorDaConfig = (d: Dependencias): MotorLlm | null => (llmConfigurado(d.llm) ? motorDe(d.llm) : null);

/* ---- Iniciar ------------------------------------------------------------------------------------------------------------ */
async function iniciar(brutos: unknown, brutoContexto: unknown, d: Dependencias, idioma: Idioma): Promise<RespostaLlm> {
  const relogio = d.agora ?? Date.now, gerarId = d.gerarId ?? idAleatorio, inicio = relogio();
  const u = d.usuario(), ilimitado = ehLiberado(u.email, d.llm.liberados), amb = d.ambiente(), motor = motorDaConfig(d);
  const falha = (codigo: CodigoErroLlm, extra: Partial<RespostaErro> = {}): RespostaErro => ({ ok: false, modo: "iniciar", codigo, mensagem: msg(codigo, idioma), motor, ...extra });

  // 1. formato e conteúdo: o navegador não é confiável
  if (!Array.isArray(brutos) || !brutos.length || brutos.length > MAX_OPORTUNIDADES) return falha("pacote-invalido", { erros: [`dossies: lista de 1 a ${MAX_OPORTUNIDADES} esperada`] });
  if (!brutoContexto || typeof brutoContexto !== "object") return falha("pacote-invalido", { erros: ["contexto: objeto esperado"] });
  const dossies: DossieLlm[] = [], erros: string[] = [];
  for (const [i, b] of brutos.entries()) {
    const v = validarDossie(b);
    if (!v.ok) { erros.push(...v.erros.slice(0, 5).map((x) => `[${i}] ${x}`)); continue; }
    dossies.push(sanitizarDossie(v.dossie));
  }
  if (erros.length) return falha("pacote-invalido", { erros: erros.slice(0, 10) });
  const contexto = sanitizarContexto(brutoContexto as ContextoAnalise);
  const achados = [...dossies.flatMap((x, i) => verificarDossie(x).map((a) => `[${i}] ${a.onde}: ${a.tipo}`)), ...verificarContexto(contexto).map((a) => `contexto ${a.onde}: ${a.tipo}`)];
  if (achados.length) return falha("pacote-com-dado-pessoal", { erros: achados.slice(0, 10) });
  if (new Set(dossies.map((x) => x.id)).size !== dossies.length) return falha("pacote-invalido", { erros: ["dossies: id repetido"] });
  if (!motor) return falha("llm-nao-configurado");

  // 2. regra de uso (só quem não está liberado): reserva; conta como usada quando a primeira oportunidade terminar bem
  const analiseId = gerarId();
  let reservaId: string | null = null;
  if (!ilimitado) {
    try {
      const r = await reservarUso(d.estado, u, amb.id, relogio, gerarId);
      if (!r.ok) {
        await registrar(d, registroBase(d, u, ilimitado, `negado:${r.motivo}`, { analiseId: null, etapa: "iniciar", duracaoMs: relogio() - inicio }));
        return falha(r.motivo, { uso: usoDe(false, r.situacao, false) });
      }
      reservaId = r.reservaId;
    } catch (err) {
      d.log?.(`[analise-llm] App State indisponível na reserva: ${erroDe(err)}`);
      return falha("estado-indisponivel", { detalhe: erroDe(err).slice(0, 200) });
    }
  }

  // 3. guarda os dossiês e a análise
  const a: AnaliseGuardada = {
    id: analiseId, versao: 3, ambiente: amb.id, por: quem(u), ilimitada: ilimitado, periodo: contexto.periodo.rotulo, idioma, criadaEm: new Date(relogio()).toISOString(), contexto,
    oportunidades: dossies.map((x, i) => ({ indice: i, id: x.id, titulo: x.titulo, tipo: x.tipo, canal: x.canal, aplicacoes: x.aplicacoes, dossieBytes: bytesDe(x) })),
    reservaId, usoConfirmado: false, primeiraOkEm: null, sintese: null, andamentoSintese: null,
  };
  try {
    for (const [i, x] of dossies.entries()) await d.estado.gravar(chaveDossie(analiseId, i), JSON.stringify(x));
    await gravarAnalise(d.estado, a);
    await d.estado.gravar(PONTEIRO_ULTIMA, JSON.stringify({ id: analiseId }));
  } catch (err) {
    d.log?.(`[analise-llm] não guardou a análise: ${erroDe(err)}`);
    if (reservaId) await liberarUso(d.estado, reservaId, u, amb.id, relogio(), "estado-indisponivel").catch(() => undefined);
    return falha("estado-indisponivel", { detalhe: erroDe(err).slice(0, 200) });
  }
  const s = await lerUso(d.estado).then((x) => situacao(x, relogio())).catch(() => ({ disponivel: ilimitado, usada: null, emAndamento: null }));
  await registrar(d, registroBase(d, u, ilimitado, "ok", { analiseId, etapa: "iniciar", duracaoMs: relogio() - inicio, pacoteBytes: dossies.reduce((m, x) => m + bytesDe(x), 0), escopo: { aplicacoes: contexto.aplicacoes.map((x) => x.nome).slice(0, 20), periodo: contexto.periodo.rotulo }, oportunidades: dossies.map((x) => ({ titulo: x.titulo.slice(0, 120), servico: null })), motor: motor.nome, modelo: motor.modelo }));
  const ok: RespostaIniciar = { ok: true, modo: "iniciar", resultado: resultadoDe(a, a.oportunidades.map(() => null), relogio()), uso: usoDe(ilimitado, s, false), nova: true, duracaoMs: relogio() - inicio, avisos: [] };
  return ok;
}

/** Retomada: a análise existe; se ainda não contou e a reserva venceu, reserva de novo (uma chamada só, antes das oportunidades). */
async function retomar(id: unknown, d: Dependencias, idioma: Idioma): Promise<RespostaLlm> {
  const relogio = d.agora ?? Date.now, gerarId = d.gerarId ?? idAleatorio, inicio = relogio();
  const u = d.usuario(), ilimitado = ehLiberado(u.email, d.llm.liberados), amb = d.ambiente(), motor = motorDaConfig(d);
  const falha = (codigo: CodigoErroLlm, extra: Partial<RespostaErro> = {}): RespostaErro => ({ ok: false, modo: "iniciar", codigo, mensagem: msg(codigo, idioma), motor, ...extra });
  if (typeof id !== "string") return falha("entrada-invalida");
  let a: AnaliseGuardada | null;
  try { a = await lerAnalise(d.estado, id); } catch (err) { return falha("estado-indisponivel", { detalhe: erroDe(err).slice(0, 200) }); }
  if (!a) return falha("analise-nao-encontrada");
  if (!motor) return falha("llm-nao-configurado", { resultado: resultadoDe(a, await lerOps(d.estado, a), relogio()) });
  try {
    if (!a.ilimitada && !a.usoConfirmado) {
      const uso = await lerUso(d.estado);
      const valida = uso?.status === "reservado" && uso.reservaId === a.reservaId && (uso.expira ?? 0) > relogio();
      if (!valida) {
        const r = await reservarUso(d.estado, u, amb.id, relogio, gerarId);
        if (!r.ok) return falha(r.motivo, { uso: usoDe(false, r.situacao, false), resultado: resultadoDe(a, await lerOps(d.estado, a), relogio()) });
        a = { ...a, reservaId: r.reservaId };
        await gravarAnalise(d.estado, a);
      }
    }
    const s = situacao(await lerUso(d.estado), relogio());
    const ok: RespostaIniciar = { ok: true, modo: "iniciar", resultado: resultadoDe(a, await lerOps(d.estado, a), relogio()), uso: usoDe(ilimitado, s, false), nova: false, duracaoMs: relogio() - inicio, avisos: [] };
    return ok;
  } catch (err) {
    return falha("estado-indisponivel", { detalhe: erroDe(err).slice(0, 200) });
  }
}

/* ---- Uma oportunidade -------------------------------------------------------------------------------------------------- */
async function oportunidade(id: unknown, indice: unknown, d: Dependencias, idioma: Idioma): Promise<RespostaLlm> {
  const relogio = d.agora ?? Date.now, gerarId = d.gerarId ?? idAleatorio, inicio = relogio();
  const u = d.usuario(), amb = d.ambiente(), motor = motorDaConfig(d);
  const falha = (codigo: CodigoErroLlm, extra: Partial<RespostaErro> = {}): RespostaErro => ({ ok: false, modo: "oportunidade", codigo, mensagem: msg(codigo, idioma), motor, ...extra });
  if (typeof id !== "string" || typeof indice !== "number" || !Number.isInteger(indice)) return falha("entrada-invalida");
  let a: AnaliseGuardada | null, g: OpGuardada | null, dossie: DossieLlm | null;
  try {
    a = await lerAnalise(d.estado, id);
    if (!a) return falha("analise-nao-encontrada");
    if (!a.oportunidades.some((o) => o.indice === indice)) return falha("entrada-invalida");
    g = lerJson<OpGuardada>((await d.estado.ler(chaveOp(id, indice)))?.valor);
    dossie = lerJson<DossieLlm>((await d.estado.ler(chaveDossie(id, indice)))?.valor);
  } catch (err) { return falha("estado-indisponivel", { detalhe: erroDe(err).slice(0, 200) }); }
  const meta = a.oportunidades.find((o) => o.indice === indice)!;
  const estadoOp = (x: OpGuardada | null): OportunidadeAnalisada => resultadoDe(a!, a!.oportunidades.map((o) => (o.indice === indice ? x : null)), relogio()).oportunidades.find((o) => o.indice === indice)!;
  // já pronta: devolve sem chamar nada
  if (g?.estado === "ok") return { ok: true, modo: "oportunidade", oportunidade: estadoOp(g), uso: null, reaproveitada: true, duracaoMs: relogio() - inicio, tokens: null, avisos: [] } satisfies RespostaOportunidade;
  if (!motor) return falha("llm-nao-configurado", { oportunidade: estadoOp(g) });
  if (g?.estado === "andamento" && (g.ate ?? 0) > relogio()) return falha("em-andamento", { oportunidade: estadoOp(g) });
  if (!dossie) return falha("analise-nao-encontrada", { oportunidade: estadoOp(g) });
  // permissão: a análise já contou, está liberado, ou a reserva dela vale
  try {
    if (!a.ilimitada && !a.usoConfirmado) {
      const uso = await lerUso(d.estado);
      const deOutra = uso?.status === "usado" && uso.reservaId !== a.reservaId;
      const valida = (uso?.status === "reservado" || uso?.status === "usado") && uso.reservaId === a.reservaId && (uso.status === "usado" || (uso.expira ?? 0) > relogio());
      if (deOutra) return falha("ja-usada", { uso: usoDe(false, situacao(uso, relogio()), false), oportunidade: estadoOp(g) });
      if (!valida) return falha("reserva-expirada", { oportunidade: estadoOp(g) });
    }
    // marca "analisando" (evita duas chamadas pagas para a mesma oportunidade), confirmada por releitura
    const marca = gerarId();
    const vez = await assumirMarca<OpGuardada>(async () => lerJson<OpGuardada>((await d.estado.ler(chaveOp(id, indice)))?.valor),
      () => d.estado.gravar(chaveOp(id, indice), JSON.stringify({ indice, estado: "andamento", resultado: null, erro: null, motor: null, quando: null, ms: null, tokens: null, marca, ate: relogio() + ANDAMENTO_MS } satisfies OpGuardada)), marca, d.espera);
    if (!vez.minha) return falha("em-andamento", { oportunidade: estadoOp(vez.lida) });
  } catch (err) { return falha("estado-indisponivel", { detalhe: erroDe(err).slice(0, 200), oportunidade: estadoOp(g) }); }

  const ilimitadoU = ehLiberado(u.email, d.llm.liberados);
  let r: { dados: ResultadoOportunidade; r: RespostaLLM };
  try {
    r = await perguntar(d, montarPedidoOportunidade(dossie, a.contexto, a.idioma), { esforco: d.llm.esforcoOportunidade ?? d.llm.esforco ?? PADRAO_LLM.esforcoOportunidade, maxTokens: d.llm.maxTokensOportunidade ?? d.llm.maxTokens ?? PADRAO_LLM.maxTokensOportunidade }, lerOportunidade, relogio);
  } catch (err) {
    const e = erroLLM(err);
    d.log?.(`[analise-llm] oportunidade ${indice} falhou: ${e.codigo}`);
    const gErro: OpGuardada = { indice, estado: "erro", resultado: null, erro: { codigo: e.codigo, mensagem: msg(e.codigo, idioma) }, motor, quando: new Date(relogio()).toISOString(), ms: relogio() - inicio, tokens: null };
    await d.estado.gravar(chaveOp(id, indice), JSON.stringify(gErro)).catch(() => undefined);
    await registrar(d, registroBase(d, u, ilimitadoU, `erro:${e.codigo}`, { analiseId: id, etapa: "oportunidade", duracaoMs: relogio() - inicio, pacoteBytes: meta.dossieBytes, oportunidades: [{ titulo: meta.titulo.slice(0, 120), servico: null }], motor: motor.nome, modelo: motor.modelo }));
    return falha(e.codigo, { detalhe: e.detalhe, tentarDeNovoEmS: e.tentarDeNovoEmS, oportunidade: estadoOp(gErro) });
  }
  const motorFinal: MotorLlm = { ...motor, modelo: r.r.modelo || motor.modelo };
  const gOk: OpGuardada = { indice, estado: "ok", resultado: r.dados, erro: null, motor: motorFinal, quando: new Date(relogio()).toISOString(), ms: r.r.ms, tokens: r.r.tokens };
  const avisos: string[] = [];
  try { await d.estado.gravar(chaveOp(id, indice), JSON.stringify(gOk)); }
  catch (err) { avisos.push(idioma === "en" ? "The result could not be saved in App State." : "Não foi possível guardar o resultado no App State."); d.log?.(`[analise-llm] não guardou a oportunidade: ${erroDe(err)}`); }

  // a primeira oportunidade que termina bem conta o uso (quem não está liberado); as outras não gastam de novo
  let uso: UsoLlm | null = null, consumiu = false;
  try {
    const fresca = (await lerAnalise(d.estado, id)) ?? a;
    if (!fresca.usoConfirmado) {
      const atual: AnaliseGuardada = { ...fresca, usoConfirmado: true, primeiraOkEm: fresca.primeiraOkEm ?? gOk.quando };
      if (!fresca.ilimitada && fresca.reservaId) {
        const u0 = await lerUso(d.estado);
        if (!(u0?.status === "usado" && u0.reservaId === fresca.reservaId)) { await confirmarUso(d.estado, fresca.reservaId, u, amb.id, relogio()); consumiu = true; }
        await d.estado.gravar(PONTEIRO_CONTADA, JSON.stringify({ id }));
      }
      await gravarAnalise(d.estado, atual);
      a = atual;
    }
    uso = usoDe(ilimitadoU, situacao(await lerUso(d.estado), relogio()), consumiu);
  } catch (err) {
    avisos.push(idioma === "en" ? "The use could not be recorded in App State." : "Não foi possível registrar o uso no App State.");
    d.log?.(`[analise-llm] não confirmou o uso: ${erroDe(err)}`);
  }
  const reg = registroBase(d, u, ilimitadoU, "ok", { analiseId: id, etapa: "oportunidade", duracaoMs: relogio() - inicio, pacoteBytes: meta.dossieBytes, tokens: r.r.tokens, oportunidades: [{ titulo: meta.titulo.slice(0, 120), servico: null }], motor: motorFinal.nome, modelo: motorFinal.modelo });
  if (consumiu || (a.ilimitada && a.primeiraOkEm === gOk.quando)) reg.email = await avisarAdmins(d, reg);
  await registrar(d, reg);
  const ok: RespostaOportunidade = { ok: true, modo: "oportunidade", oportunidade: estadoOp(gOk), uso, reaproveitada: false, duracaoMs: relogio() - inicio, tokens: r.r.tokens, avisos };
  return ok;
}

/* ---- Síntese ------------------------------------------------------------------------------------------------------------ */
/** Relê as oportunidades que a tela diz prontas mas que a leitura trouxe "em andamento": réplica atrasada do App State
    (a oportunidade regravou a chave ao terminar e a leitura seguinte ainda vê a versão anterior). Até 3 releituras. */
async function lerOpsConfirmando(d: Dependencias, a: AnaliseGuardada, prontasNaTela: number[]): Promise<(OpGuardada | null)[]> {
  const ops = await lerOps(d.estado, a);
  const espera = d.espera ?? ((ms) => new Promise<void>((ok) => setTimeout(ok, ms)));
  for (let i = 0; i < RELEITURAS; i++) {
    const atrasadas = a.oportunidades.map((o, k) => ({ o, k })).filter(({ o, k }) => prontasNaTela.includes(o.indice) && ops[k]?.estado !== "ok");
    if (!atrasadas.length) break;
    await espera(CONFIRMAR_MS * (i + 1));
    for (const { o, k } of atrasadas) ops[k] = lerJson<OpGuardada>((await d.estado.ler(chaveOp(a.id, o.indice)))?.valor);
  }
  return ops;
}
async function sintese(id: unknown, d: Dependencias, idioma: Idioma, prontasNaTela: number[] = []): Promise<RespostaLlm> {
  const relogio = d.agora ?? Date.now, gerarId = d.gerarId ?? idAleatorio, catalogo = d.catalogo ?? CATALOGO_INICIATIVAS, inicio = relogio();
  const u = d.usuario(), motor = motorDaConfig(d);
  const falha = (codigo: CodigoErroLlm, extra: Partial<RespostaErro> = {}): RespostaErro => ({ ok: false, modo: "sintese", codigo, mensagem: msg(codigo, idioma), motor, ...extra });
  if (typeof id !== "string") return falha("entrada-invalida");
  let a: AnaliseGuardada | null, ops: (OpGuardada | null)[];
  try { a = await lerAnalise(d.estado, id); if (!a) return falha("analise-nao-encontrada"); ops = await lerOpsConfirmando(d, a, prontasNaTela); }
  catch (err) { return falha("estado-indisponivel", { detalhe: erroDe(err).slice(0, 200) }); }
  let atual = resultadoDe(a, ops, relogio());
  const prontas = atual.oportunidades.filter((o) => o.estado === "ok");
  if (!prontas.length) return falha("sem-oportunidade-pronta", { resultado: atual });
  const jaFeita = (x: AnaliseGuardada) => !!x.sintese && prontas.every((o) => x.sintese!.cobre.includes(o.indice));
  // já feita para estas oportunidades: devolve sem chamar nada. Antes de pagar outra ida ao LLM (ou de responder "em
  // andamento" por uma marca que pode já ter sido substituída pela síntese), confirma relendo: réplica atrasada do App
  // State, em que a síntese recém-gravada ainda não aparece na leitura seguinte e a leitura mostra a marca anterior
  // Só há o que confirmar quando a leitura traz uma marca (alguém gerou ou está gerando); sem marca nenhuma, gera direto.
  if (!jaFeita(a) && a.andamentoSintese) {
    const espera = d.espera ?? ((ms) => new Promise<void>((ok) => setTimeout(ok, ms)));
    for (let i = 0; i < RELEITURAS && !jaFeita(a); i++) {
      await espera(CONFIRMAR_MS * (i + 1));
      const de = await lerAnalise(d.estado, id).catch(() => null);
      if (de) { a = de; atual = resultadoDe(a, ops, relogio()); }
    }
  }
  if (jaFeita(a)) return { ok: true, modo: "sintese", resultado: atual, reaproveitada: true, duracaoMs: relogio() - inicio, tokens: null, avisos: [] } satisfies RespostaSintese;
  if (!motor) return falha("llm-nao-configurado", { resultado: atual });
  if (a.andamentoSintese && a.andamentoSintese.ate > relogio()) return falha("em-andamento", { resultado: atual });
  const marca = { id: gerarId(), ate: relogio() + ANDAMENTO_MS };
  try {
    const vez = await assumirMarca(async () => (await lerAnalise(d.estado, id))?.andamentoSintese ?? null, () => gravarAnalise(d.estado, { ...a, andamentoSintese: marca }), marca.id, d.espera);
    if (!vez.minha) return falha("em-andamento", { resultado: atual });
  } catch (err) { return falha("estado-indisponivel", { detalhe: erroDe(err).slice(0, 200), resultado: atual }); }
  const base = a, ilimitadoU = ehLiberado(u.email, d.llm.liberados);
  let r: { dados: SinteseLlm; r: RespostaLLM };
  try {
    r = await perguntar(d, montarPedidoSintese(prontas, base.contexto, catalogo, base.idioma), { esforco: d.llm.esforcoSintese ?? d.llm.esforco ?? PADRAO_LLM.esforcoSintese, maxTokens: d.llm.maxTokensSintese ?? d.llm.maxTokens ?? PADRAO_LLM.maxTokensSintese }, (t) => lerSintese(t, prontas.map((o) => o.id), catalogo), relogio);
  } catch (err) {
    const e = erroLLM(err);
    d.log?.(`[analise-llm] síntese falhou: ${e.codigo}`);
    const fresca = (await lerAnalise(d.estado, id).catch(() => null)) ?? base;
    await gravarAnalise(d.estado, { ...fresca, andamentoSintese: null }).catch(() => undefined);   // libera para tentar de novo
    await registrar(d, registroBase(d, u, ilimitadoU, `erro:${e.codigo}`, { analiseId: id, etapa: "sintese", duracaoMs: relogio() - inicio, motor: motor.nome, modelo: motor.modelo }));
    return falha(e.codigo, { detalhe: e.detalhe, tentarDeNovoEmS: e.tentarDeNovoEmS, resultado: atual });
  }
  const motorFinal: MotorLlm = { ...motor, modelo: r.r.modelo || motor.modelo };
  const fresca = (await lerAnalise(d.estado, id).catch(() => null)) ?? base;
  const pronta: AnaliseGuardada = { ...fresca, andamentoSintese: null, sintese: { dados: r.dados, cobre: prontas.map((o) => o.indice), motor: motorFinal, quando: new Date(relogio()).toISOString(), ms: r.r.ms, tokens: r.r.tokens } };
  const avisos: string[] = [];
  try { await gravarAnalise(d.estado, pronta); }
  catch (err) { avisos.push(idioma === "en" ? "The synthesis could not be saved in App State." : "Não foi possível guardar a síntese no App State."); d.log?.(`[analise-llm] não guardou a síntese: ${erroDe(err)}`); }
  const resultado = resultadoDe(pronta, ops, relogio());
  await registrar(d, registroBase(d, u, ilimitadoU, "ok", { analiseId: id, etapa: "sintese", duracaoMs: relogio() - inicio, tokens: r.r.tokens, motor: motorFinal.nome, modelo: motorFinal.modelo,
    oportunidades: prontas.slice(0, 10).map((o) => ({ titulo: o.titulo.slice(0, 120), servico: r.dados.iniciativasRecomendadas.find((s) => s.oportunidades.includes(o.id))?.servico ?? null })) }));
  const ok: RespostaSintese = { ok: true, modo: "sintese", resultado, reaproveitada: false, duracaoMs: relogio() - inicio, tokens: r.r.tokens, avisos };
  return ok;
}

/* ---- Liberar ------------------------------------------------------------------------------------------------------------ */
async function liberar(id: unknown, d: Dependencias, idioma: Idioma): Promise<RespostaLlm> {
  const relogio = d.agora ?? Date.now, u = d.usuario(), amb = d.ambiente();
  if (typeof id !== "string") return { ok: false, modo: "liberar", codigo: "entrada-invalida", mensagem: msg("entrada-invalida", idioma), motor: null };
  try {
    const a = await lerAnalise(d.estado, id);
    if (!a || a.ilimitada || a.usoConfirmado || !a.reservaId) return { ok: true, modo: "liberar", liberada: false };
    if ((await lerOps(d.estado, a)).some((o) => o?.estado === "ok")) return { ok: true, modo: "liberar", liberada: false };
    const uso = await lerUso(d.estado);
    if (uso?.status !== "reservado" || uso.reservaId !== a.reservaId) return { ok: true, modo: "liberar", liberada: false };
    await liberarUso(d.estado, a.reservaId, u, amb.id, relogio(), "nenhuma-oportunidade");
    return { ok: true, modo: "liberar", liberada: true };
  } catch (err) {
    return { ok: false, modo: "liberar", codigo: "estado-indisponivel", mensagem: msg("estado-indisponivel", idioma), detalhe: erroDe(err).slice(0, 200), motor: null };
  }
}

/* ---- Registro e e-mail -------------------------------------------------------------------------------------------------- */
function registroBase(d: Dependencias, u: Usuario, ilimitada: boolean, resultado: string, extra: Partial<RegistroLlm>): RegistroLlm {
  const gerarId = d.gerarId ?? idAleatorio, relogio = d.agora ?? Date.now;
  return { id: gerarId(), analiseId: null, etapa: null, quando: new Date(relogio()).toISOString(), ambiente: d.ambiente().id, versaoApp: d.versaoApp(), usuario: quem(u), ilimitada,
    resultado, motor: null, modelo: null, duracaoMs: null, pacoteBytes: null, tokens: null, escopo: null, oportunidades: [], email: "desligado", ...extra };
}
async function registrar(d: Dependencias, r: RegistroLlm) {
  try { await gravarRegistro(d.estado, r); } catch (err) { d.log?.(`[analise-llm] não gravou o registro: ${erroDe(err)}`); }
}
/** E-mail aos administradores (desligado por padrão). Só dados do registro: quem, quando, ambiente, oportunidades. */
async function avisarAdmins(d: Dependencias, r: RegistroLlm): Promise<RegistroLlm["email"]> {
  const cfg = d.email ?? EMAIL_ADMINS;
  if (!cfg.habilitado || !cfg.para.length || !d.enviarEmail) return "desligado";
  const corpo = [
    `Ambiente: ${r.ambiente} (Digital Experience Flow ${r.versaoApp})`,
    `Quem: ${r.usuario.nome} <${r.usuario.email}>${r.ilimitada ? " (liberado)" : ""}`,
    `Quando: ${r.quando}`,
    `Análise: ${r.analiseId ?? "-"}`,
    `Motor: ${r.motor} (${r.modelo})`,
    "Oportunidade:",
    ...r.oportunidades.map((o, i) => `${i + 1}. ${o.titulo}${o.servico ? ` [${nomeServico(o.servico)}]` : ""}`),
  ].join("\n");
  try { await d.enviarEmail(cfg.para, cfg.assunto, corpo); return "enviado"; }
  catch (err) { d.log?.(`[analise-llm] e-mail falhou: ${erroDe(err)}`); return "falhou"; }
}
