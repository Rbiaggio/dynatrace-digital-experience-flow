import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { dql, num, texto, JANELAS, TODAS, limitarJanelaFiltro,
         qFunil, qNomesAplicacoes, entidadesDoIdRum, LIMITE_ARESTAS_METRICA,
         qEntradasMobile, qOrigensRecuperadas, qHibrido, usarQuadros,
         qInicioSerieErros, carregarBackend, qCanaisServicos, ligacaoDoEscopo,
         classeLigacao, janelaMaiorDaClasse, LIMITE_LIGACAO_GLOBAL, qContarSpans, qLigacaoAmostrada, razaoLigacao, intervaloLigacao, filtroSegmentoDaCopia, carregarBackendGlobal, ehBackendGlobal, comporBackend, comporLigacao, idsDoGlobal, lerVolume,
         BUCKET_PASSOS_PADRAO, BUCKETS_COPIA, usarCopia, passosEmUso, qCopiaUltimo, estadoCopia, usarSegmento, segmentoAtivo, chaveSegmento, qValoresSegmento, chaveSegmentoDe, type Segmento, quadrosEmUso,
         qApdexNomes, qApdex, apdexIgnorados, qApdexMobile, qApdexLugares, apdexComCarga, sistemaDoSegmento, linhasDosFunis, INTERVALO_SERIE } from "./lib/dql";
import { planoInicio, planoQualidade, planoIsolar, planoBaseCopia, planoFunis } from "./lib/juntas";
import { qUltimaFatia, usarFimAgregados, qApdexMobileEscopo7d, qAplicacoesAgregado, qArestasAgregado, qViewsAgregado, qErrosPorViewAgregado, qOrigensAgregado, janelaRelativa, trechosAoVivo, LIMITE_LINHAS_FATIA, qErrosClienteAgregado, qSerieErrosAgregado, intervaloAgregados } from "./lib/agregados";
import { serieDoTrecho, juntarErrosCliente } from "./lib/aovivo";
import { chaveJornadas, qualidadeDas24, caminhosDoEscopo, MS_HORA } from "./lib/horaria";
import type { SessaoLenta } from "./components/ListaSessoes";
import { lerUltimaHora, lerLigacao24, usarChaveFunis, chaveFunisEmUso, lerSessoes24, lerReq24 } from "./lib/horas";
import { lerTrecho, comTrecho, juntarAplicacoes, juntarArestas, juntarViews, juntarErros, juntarOrigens, juntarApdexCarga, juntarApdexMobile, juntarLugares, type TrechoAoVivo } from "./lib/aovivo";
import { inicioDasLinhas, marcarAcesso, INTERVALO_ACESSO_MS } from "./lib/agendado";
import type { ResultadoQualidade } from "./lib/juntas";
import type { LinhaApdexLugar, LinhaLugar } from "./lib/lugares";
import { escopoApdex, nomesDoEscopo, consultarApdex, montarApdex, linhaApdex, parApdex, escopoApdexMobile, montarApdexMobile, linhaApdexMobile, type Apdex, type ApdexMobile, type ParApdex } from "./lib/apdex";
import { AppInfo, LinhaAresta, LinhaBackend, LinhaChamada, LinhaPagina, LinhaServico, LinhaView, montarGrafo, formatarInt, idView, canalDaEntidade, isolarGrafo, ocultarTipos, caminhoDominante, Niveis, TipoNo } from "./lib/graph";
import { mapaDeQuadros, juntarQuadros, ehQuadro, aplicarComponentes, paginasComQuadros, errosComComponentes, type LinhaQuadro } from "./lib/quadros";
import { carregarComponentes } from "./lib/quadrosEstado";
import { lerModoAtualizacao, aplicarModoAtualizacao } from "./lib/atualizacao";
import { entidadesHabilitadas, qNomesEntidades } from "./lib/entidadesHabilitadas";
import { Modo } from "./lib/layout";
import { Armazenamento, Funil, Jornada, carregarJornadas, jornadaDaSelecao, montarFunil, nosDaJornada, salvarJornadas } from "./lib/jornadas";
import { lerCache, gravarCache, resumo as resumoChave, TTL_PADRAO_MS } from "./lib/cache";
import { lerCompartilhado, esperarOuAssumir, marcarAtualizar, fimMinimo, chaveBloco, prepararCompartilhado, marcarNaTela, type Lider } from "./lib/compartilhado";
import { DadosDe } from "./components/DadosDe";
import { FlowGraph } from "./components/FlowGraph";
import { Inicio } from "./components/Inicio";
import type { Inicio as DadosInicio } from "./lib/inicio";
import { lerPrecos, precosEfetivos } from "./lib/consumo";
import { getAppId, getAppVersion } from "@dynatrace-sdk/app-environment";
import { t, idiomaAtual, definirIdioma, type Idioma } from "./lib/i18n";
import type { LinhaQualidade } from "./lib/qualidade";
import type { JornadaOp, LinhaChamadaEstado, LinhaTerceiro } from "./lib/oportunidades";
import { textoPeriodo } from "./lib/oportunidades";
import { coletarDossies } from "./lib/dossie";
import { statusLlm, type FabricaLlm } from "./lib/llmCliente";
import { intervaloDe } from "./components/Links";
import { Destaque } from "./lib/destaques";
import { DetailPanel, type AbaPagina } from "./components/DetailPanel";
import { ControlPanel, type Realce } from "./components/ControlPanel";
import { JourneyBar } from "./components/JourneyBar";
import { JourneyPanel } from "./components/JourneyPanel";
import { MarcaIcone } from "./components/MarcaIcone";
import { ConfigPanel } from "./components/ConfigPanel";
import { DocsPanel, type SubAbaDocs } from "./components/docs/DocsPanel";
import { SettingIcon, InformationIcon, FilterIcon, ClockIcon, ApplicationsIcon, RefreshIcon } from "@dynatrace/strato-icons";
import { podeConfigurar, podeUsarIA } from "./lib/permissao";
import { carregarHabilitadas } from "./lib/habilitadas";
import "./styles.css";

interface Aplicacao extends AppInfo { navegacoes: number; sessoes: number; entidade: string | null }
/** Páginas e navegações (métricas): servem à Visão geral e ao Flow. */
interface DadosBase { apps: Aplicacao[]; arestas: LinhaAresta[]; views: LinhaView[]; quadros?: LinhaQuadro[] }
/** Backend do grafo (cadeia pelo modelo de entidades + ligação página -> serviço pelos spans): só o Flow usa. */
interface DadosBackend { backend: LinhaBackend[]; servicos: LinhaServico[]; chamadas: LinhaChamada[]; paginas: LinhaPagina[] }
/** Falha no backend do grafo: a ligação página -> serviço (spans) ou a cadeia pelo modelo de entidades. O Flow abre sem ela. */
interface AvisoBackend { tipo: "ligacao" | "cadeia"; msg: string }
/** lidoDesde = quando a leitura começou (o Atualizar recusa o que começou antes do clique, mesmo que tenha gravado depois);
    deCache = veio do cache compartilhado (não é gravado: só marca o que esta tela recebeu) */
interface ResultadoBackend { dados: DadosBackend; aviso: AvisoBackend | null; lidoDesde?: number; deCache?: boolean }
/** chave = cache da base (leva "mostrar frames"); chaveBackend = cache do backend (frames não mudam a ligação). */
interface Escopo { chave: string; chaveBackend: string; app: string; janela: string; robos: boolean; segmento: string; passos: string | null }
/** comBackend = o backend já foi carregado para este escopo (a Visão geral carrega só a base); recebidoEm = quando esta
    tela recebeu a base (do tenant ou do cache). */
interface Dados extends DadosBase, DadosBackend { escopo: Escopo | null; comBackend: boolean; recebidoEm: number }
const SEM_BACKEND: DadosBackend = { backend: [], servicos: [], chamadas: [], paginas: [] };
const VAZIO: Dados = { apps: [], arestas: [], views: [], ...SEM_BACKEND, escopo: null, comBackend: false, recebidoEm: 0 };
const msgErro = (e: unknown) => (e instanceof Error ? e.message : String(e));
const listas = (...xs: unknown[]) => xs.every((x) => Array.isArray(x));
/** Falha de permissão: é de quem leu (não vai ao cache compartilhado) e o aviso diz quem resolve. */
const semPermissao = (msg: string) => /missing scope|missing permission|not_authorized|access denied|permiss|forbidden|(?:HTTP |status is ')403\b/i.test(msg);
/** A permissão que faltou, quando a mensagem traz o nome ("storage:metrics:read"); senão, a esperada. */
const permissaoNegada = (msg: string, esperada: string) => /storage:[a-z0-9._-]+:read/i.exec(msg)?.[0] ?? esperada;
/** Texto do aviso quando o backend do grafo veio com falha (o detalhe técnico fica no title). */
const textoAvisoBackend = (a: AvisoBackend, janela: string) => {
  if (a.tipo === "cadeia") return semPermissao(a.msg)
    ? t(`Sem permissão para ler os dados do backend (${permissaoNegada(a.msg, "storage:entities:read")}): o fluxo aparece só com as páginas. Peça a permissão ao administrador do Dynatrace; depois de liberada, clique em Atualizar.`,
      `No permission to read the backend data (${permissaoNegada(a.msg, "storage:entities:read")}): the flow shows only the pages. Ask your Dynatrace administrator for the permission; once granted, click Refresh.`)
    : t("O backend não carregou neste período; o fluxo aparece só com as páginas. Clique em Atualizar para tentar de novo.",
      "The backend did not load for this timeframe; the flow shows only the pages. Click Refresh to try again.");
  if (semPermissao(a.msg)) return t(`Sem permissão para ler spans (${permissaoNegada(a.msg, "storage:spans:read")}): o fluxo e a cadeia do backend aparecem sem a ligação página → serviço. Peça a permissão ao administrador do Dynatrace; depois de liberada, clique em Atualizar.`,
    `No permission to read spans (${permissaoNegada(a.msg, "storage:spans:read")}): the flow and the backend chain are shown without the page → service link. Ask your Dynatrace administrator for the permission; once granted, click Refresh.`);
  return janela === "30m"
    ? t("Ligação página → serviço indisponível agora; o fluxo e a cadeia do backend aparecem sem ela. Clique em Atualizar para tentar de novo.",
      "Page → service link unavailable right now; the flow and the backend chain are shown without it. Click Refresh to try again.")
    : t("Ligação página → serviço indisponível neste período; o fluxo e a cadeia do backend aparecem sem ela. Tente os últimos 30 minutos: a ligação lê no máximo a última hora de spans.",
      "Page → service link unavailable in this timeframe; the flow and the backend chain are shown without it. Try the last 30 minutes: the link reads at most the last hour of spans.");
};
/** De onde vem a base do grafo: os agregados por fatia de 5 min (lib/agregados.ts; o workflow de agregação está gravando)
    ou, sem eles, a cópia das sessões (a leitura que o filtro de segmento já usava, BAS-S). Sem nenhum dos dois, o app não
    lê nada: desde a 1.41 não existe mais a leitura de user.events (Digital Experience Monitoring - Query). */
type Fonte = "agregados" | "copia";
/** Agregados "em dia": a última fatia gravada terminou há no máximo isto (o workflow grava a cada 5 min). */
const AGREGADOS_EM_DIA_MS = 30 * 60000;
/** Executor de DQL do backend (carregarBackend passa o id da consulta: BCK-02 a BCK-06). */
const dqlBackend = (q: string, max?: number, id?: string) => dql(q, { contexto: `backend/${id ?? "BCK"}`, maxRecords: max });
interface PreReq { agregados: boolean | null; bucket: boolean | null; detalhe: string }
/** Spans de servidor por hora (amostra de 1/10.000, qContarSpans): dá a amostragem da ligação. Compartilhado e relido no
    máximo de hora em hora (o volume muda devagar). */
async function lerSpansPorHora(): Promise<number> {
  const contar = async () => {
    const ate = Date.now(), de = ate - 3600000;
    const l = (await dql(qContarSpans(new Date(de).toISOString(), new Date(ate).toISOString()), { contexto: "backend/BCK-00", maxRecords: 1 }))[0];
    return Number(l?.n ?? 0);                                 // já multiplicado pela amostragem real
  };
  const b = await lerCompartilhado("backend", JSON.stringify(["spans-hora"]), contar, { validadeMs: 3600000, aceitar: (x) => typeof x === "number" });
  return b ? b.dados : contar();
}
/** A ligação página -> serviço do período escolhido (no máximo a última hora), lida na hora com os spans amostrados pelo
    volume (lib/queries.ts, qLigacaoAmostrada): as linhas no formato da qPaginasServicosGlobal. `filtro` = filtros de
    segmento no lado da cópia. Falha lança (o Flow abre sem a ligação, com o aviso). */
async function lerLigacaoNaHora(janela: string, filtro = "", contexto: `backend/${string}` = "backend/BCK-01G") {
  const { de, ate } = intervaloLigacao(janela);
  const razao = razaoLigacao(await lerSpansPorHora() * (Date.parse(ate) - Date.parse(de)) / 3600000);
  return dql(qLigacaoAmostrada(de, ate, razao, filtro), { contexto, maxRecords: LIMITE_LIGACAO_GLOBAL });
}
/** O trecho ao vivo da janela (cabeça e cauda da cópia, todos os grupos), lido uma vez nesta aba a cada 5 min e servido a
    todos os leitores do grafo e do Apdex (lib/aovivo.ts); null = janela "início/fim" (só as fatias). */
const trechoDa = (janela: string, contexto: `base/${string}` | `apdex/${string}` | `inicio/${string}`): TrechoAoVivo | null => (janelaRelativa(janela)
  ? lerTrecho(janela, (q) => dql(q, { contexto, maxRecords: LIMITE_LINHAS_FATIA }), fimMinimo())
  : null);
/** Fim da última fatia gravada (PRE-01): relido antes de cada leitura da base, no máximo a cada minuto. */
let fimAgregadosLidoEm = 0;
async function lerFimAgregados(forcar = false): Promise<number | null> {
  if (!forcar && Date.now() - fimAgregadosLidoEm < 60000) return null;
  fimAgregadosLidoEm = Date.now();
  try {
    const l = (await dql(qUltimaFatia(), { contexto: "prereq/PRE-01", maxRecords: 1 }))[0];
    const fim = l ? Date.parse(String(l.fim)) : NaN, agora = l ? Date.parse(String(l.agora)) : NaN;
    if (isNaN(fim)) { usarFimAgregados(null); return null; }
    // relógio do Grail x do navegador: a janela relativa termina no fim da última fatia, no relógio do navegador
    usarFimAgregados(fim - (isNaN(agora) ? 0 : agora - Date.now()));
    return isNaN(agora) ? fim : Date.now() - (agora - fim);
  } catch { return null; }
}

/**
 * Digital Experience Flow: o "service flow" do frontend. Nós = aplicações, telas (views) e serviços de backend;
 * arestas = navegações, chamadas canal -> serviço e serviço -> serviço/banco.
 * Jornadas de negócio com funil por sessão e drill de abandono.
 *
 * Custo (pré-requisitos de produção): as páginas vêm de MÉTRICAS extraídas pelo OpenPipeline (consulta grátis); o
 * backend vem do modelo de entidades (quem chama quem, o que o Smartscape desenha: 0 bytes) com o volume da métrica
 * nativa do serviço; o que depende de sessão lê a CÓPIA enxuta (business events em 3 buckets: navegação, erro e
 * requisição; cada consulta lê só os que precisa; na transição, também o bucket único rum_flow_passos); resultados
 * ficam em CACHE compartilhado. Sem métricas, o app só varre o Grail com confirmação explícita. A ligação página ->
 * serviço (spans, no máximo 1 h) só roda com o Flow aberto: quem fica na Visão geral não lê spans.
 */
export const App: React.FC = () => {
  const [janelaEscolhida, setJanela] = useState("30m");
  const [robos, setRobos] = useState(false);
  const [quadros, setQuadros] = useState(false);   // frames (iframes) no fluxo: escondidos por padrão
  // só as aplicações habilitadas na Configuração (uma desligada continua nas métricas até a janela passar)
  const [habilitadas, setHabilitadas] = useState<Set<string> | null>(null);
  const habilitadasRef = useRef<Set<string> | null>(null);
  habilitadasRef.current = habilitadas;
  const [soHabilitadas, setSoHabilitadas] = useState(true);
  const [realce, setRealce] = useState<Realce>(null);                   // "Node types"/"Node status": tipo realçado
  const [filtroAberto, setFiltroAberto] = useState(false);              // menu de filtros de segmento (barra de cima)
  const [pctMinimo, setPctMinimo] = useState(0);
  const [modo, setModo] = useState<Modo>("horizontal");
  const [busca, setBusca] = useState("");
  const [segmento, setSegmento] = useState<Segmento>({});
  const [valoresSegmento, setValoresSegmento] = useState<Partial<Record<keyof Segmento, string[]>> | null>(null);
  usarSegmento(segmento);   // estado do módulo de consultas acompanha o filtro antes dos efeitos rodarem
  // 1.46.1: com filtro, robôs ou frames (leituras da cópia crua do período), o período vai no máximo até a última hora; o
  // seletor continua com a escolha e o aviso ao lado diz que o limite agiu
  const janela = limitarJanelaFiltro(janelaEscolhida, robos || quadros || Object.values(segmento).some(Boolean));
  const janelaLimitada = janela !== janelaEscolhida;
  const [versaoReposicionar, setVersaoReposicionar] = useState(0);
  const [app, setApp] = useState<string>(TODAS);
  const [dados, setDados] = useState<Dados>(VAZIO);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [painelAberto, setPainelAberto] = useState(true);          // painel da direita (detalhes / jornada) recolhível
  // isolar: só o fluxo que passa por um nó; números recalculados pelas sessões que passaram por ele (Grail no bucket)
  const [isolado, setIsolado] = useState<{ id: string; niveis: Niveis } | null>(null);
  const [fluxoIsolado, setFluxoIsolado] = useState<{ id: string; chave: string; arestas: LinhaAresta[]; sessoes: number } | null>(null);
  const [carregandoIsolado, setCarregandoIsolado] = useState(false);
  // filtros: tipos escondidos do grafo. 1.45.9: o backend começa escondido; "+ Backend" na barra o mostra
  const [ocultos, setOcultos] = useState<Set<TipoNo>>(new Set(["servico"]));
  const [editando, setEditando] = useState<string | null>(null);       // id da jornada aberta no compositor para edição
  const [telaConfig, setTelaConfig] = useState(false);                  // tela de Configuração (pré-requisitos no tenant)
  const [telaSobre, setTelaSobre] = useState(false);                    // aba "Documentação" (o botão de informação abre a sub-aba Sobre)
  const [subDocs, setSubDocs] = useState<SubAbaDocs>("visao");
  // tela inicial (Overview: indicadores) ou o mapa (Flow); o app abre nos indicadores
  const [tela, setTela] = useState<"inicio" | "fluxo">("inicio");
  const [inicio, setInicio] = useState<DadosInicio | null>(null);
  const [carregandoInicio, setCarregandoInicio] = useState(false);
  const [erroInicio, setErroInicio] = useState<string | null>(null);
  // experiência (Apdex de Web Vitals) da visão geral: consulta de métrica (grátis); janelaApdex = "7d" quando quem usa
  // pediu 7 dias no cartão por falta de medição no período da página (só o cartão muda, a página continua no período)
  const [apdex, setApdex] = useState<Apdex | null>(null);
  // Apdex mobile (agregados "amob" do DEF, lib/agregados.ts, e a abertura pela métrica nativa): lido junto com o web, com
  // o mesmo cache de 5 min
  const [apdexMobile, setApdexMobile] = useState<ApdexMobile | null>(null);
  const [carregandoApdex, setCarregandoApdex] = useState(false);
  const [janelaApdex, setJanelaApdex] = useState<string | null>(null);
  const forcarApdex = useRef(false);
  // lugares do mapa SEM o filtro de país/região do mesmo escopo: com um lugar escolhido, os mapas continuam mostrando
  // todos (o escolhido marcado) em vez de uma bolha só; vêm da leitura sem o filtro (memória ou cache), sem consulta a mais
  const [lugaresBase, setLugaresBase] = useState<{ chave: string; lugares: LinhaLugar[]; geradoEm: number } | null>(null);
  // Apdex por lugar (APX-04, agregados "lugar" do DEF): a cor do mapa "Onde estão os clientes"; lido junto com o cartão de Apdex
  const [apdexLugares, setApdexLugares] = useState<LinhaApdexLugar[]>([]);
  // publicação de testes (id com .preview): selo no cabeçalho para não confundir com o app principal
  // idioma da interface (PT padrão, EN opcional): trocar re-renderiza tudo; fica salvo neste navegador
  const [idioma, setIdioma] = useState<Idioma>(idiomaAtual());
  const mudarIdioma = (i: Idioma) => { definirIdioma(i); setIdioma(i); try { document.documentElement.lang = i === "en" ? "en" : "pt-BR"; } catch { /* fora do navegador */ } };
  const ehPreview = useMemo(() => { try { return getAppId().endsWith(".preview"); } catch { return false; } }, []);
  // Dynatrace Assist: ligado para quem tem a permissão de IA generativa na política de acesso (lib/permissao.ts,
  // PERMISSAO_IA), em qualquer ambiente. A análise por LLM NÃO depende disto: só a lista de liberados do llm.local.ts, e
  // quem decide é a função, pelo status. Sem chave no pacote (llm.local.ts modelo), ela
  // responde "não configurado".
  const [iaPermitida, setIaPermitida] = useState(false);
  useEffect(() => { let vivo = true; podeUsarIA().then((v) => { if (vivo) setIaPermitida(v); }); return () => { vivo = false; }; }, []);
  const assistLigado = iaPermitida;
  const [avisoBackend, setAvisoBackend] = useState<AvisoBackend | null>(null);   // backend do grafo carregou com falha
  const [carregandoBackend, setCarregandoBackend] = useState(false);             // backend do grafo ao abrir o Flow
  // Atualizar: fixa o fim mínimo da aba (lib/compartilhado.ts): o backend, como tudo o que for lido depois do clique, não
  // aceita leitura começada antes dele, agora (Flow aberto) ou quando o Flow abrir
  const backendEmVoo = useRef(new Map<string, { p: Promise<ResultadoBackend | null>; inicio: number }>());   // quem volta ao Flow espera a mesma leitura
  const leituraVigente = useRef(new Map<string, object>());                       // só a leitura mais nova de cada escopo grava no cache
  const escopoVigente = useRef<string | null>(null);                             // escopo da última carga do grafo
  const [recargaBase, setRecargaBase] = useState(0);                             // base velha ao abrir o Flow: relê
  const telaRef = useRef(tela);                                                  // tela no fim da carga do grafo (decide se lê o backend)
  telaRef.current = tela;
  const [qualidade, setQualidade] = useState<LinhaQualidade[]>([]);          // por que o fluxo de cada app sai quebrado
  // da mesma leitura da qualidade (QUA-U): chamadas por endpoint e estado e terceiros, para as Oportunidades de melhoria
  // (null = sem dado: acima da guarda, grupo cortado ou cache de antes)
  const [chamadasOp, setChamadasOp] = useState<{ chamadas: LinhaChamadaEstado[] | null; terceiros: LinhaTerceiro[] | null }>({ chamadas: null, terceiros: null });
  // botão Refresh: lê de novo (grafo, painel, qualidade, aplicações habilitadas, funil aberto); dali em diante a aba só
  // aceita leitura começada depois do clique (fim mínimo, lib/compartilhado.ts), do tenant ou de quem leu depois dele
  const [atualizacao, setAtualizacao] = useState(0);
  // o que está na tela veio do cache compartilhado: início da leitura de cada bloco (rótulo "dados de hh:mm"); null =
  // lido agora por esta aba
  const [desdeCache, setDesdeCache] = useState<Partial<Record<"inicio" | "base" | "backend" | "qualidade" | "isolar", number | null>>>({});
  const deCache = (bloco: keyof typeof desdeCache, desde: number | null) => setDesdeCache((d) => (d[bloco] === desde ? d : { ...d, [bloco]: desde }));
  // o perfil de acesso (entra na chave dos blocos) e o custo da última leitura de cada tipo (decide o marcador): resolvem
  // logo ao abrir, junto com os pré-requisitos, e não atrasam a primeira leitura
  useEffect(() => { prepararCompartilhado(); }, []);
  const [admin, setAdmin] = useState(false);                            // engrenagem só para quem pode configurar o tenant
  useEffect(() => { let vivo = true; podeConfigurar().then((v) => { if (vivo) setAdmin(v); }); return () => { vivo = false; }; }, []);
  const LIMITE_PAGINAS = 40;                                            // canal com mais páginas que isso abre só pelo caminho dominante
  const [mostrarTudo, setMostrarTudo] = useState(false);
  // pré-requisitos e fonte
  const [preReq, setPreReq] = useState<PreReq>({ agregados: null, bucket: null, detalhe: "" });
  const [fonte, setFonte] = useState<Fonte | null>(null);
  // jornadas
  const [jornadas, setJornadas] = useState<Jornada[]>([]);
  const [armazenamento, setArmazenamento] = useState<Armazenamento | null>(null);
  const [jornadaAtiva, setJornadaAtiva] = useState<string | null>(null);
  const [funis, setFunis] = useState<Record<string, Funil | null | undefined>>({});
  const [erroFunil, setErroFunil] = useState<string | null>(null);
  const [modoSelecao, setModoSelecao] = useState(false);
  const [selecao, setSelecao] = useState<string[]>([]);

  // pré-requisitos: os agregados (a última fatia gravada pelo workflow de agregação) e a cópia das sessões
  useEffect(() => {
    let vivo = true;
    (async () => {
      // a cópia (etapa 6): o último registro nos 3 buckets e no bucket único de antes (transição), em 2 leituras que param
      // no primeiro bloco com registro; com registro nas últimas 2 h em algum dos lados, a cópia está ativa (o sim/não de antes)
      const ultimo = (q: string, id: string) => dql(q, { contexto: `prereq/${id}`, maxRecords: 1 }).catch(() => null);
      const copia = Promise.all([ultimo(qCopiaUltimo(Object.values(BUCKETS_COPIA)), "PRE-02N"), ultimo(qCopiaUltimo([BUCKET_PASSOS_PADRAO]), "PRE-02A")]).then(([n, a]) => estadoCopia(n, a));
      // 1.45.11: os frames das 24 h (App State, grátis) antes da primeira leitura por sessão; 1.46.0: o modo de atualização
      // escolhido na Configuração (App State, grátis), ligado antes da primeira leitura de dado
      const [fimAgregados, estadoDaCopia, , modo] = await Promise.all([lerFimAgregados(true), copia, carregarComponentes().catch(() => null), lerModoAtualizacao()]);
      if (!vivo) return;
      aplicarModoAtualizacao(modo);
      usarCopia(estadoDaCopia);
      const passos = !!estadoDaCopia;
      const agregados = fimAgregados != null && Date.now() - fimAgregados <= AGREGADOS_EM_DIA_MS;
      setPreReq({ agregados, bucket: passos, detalhe: [`aggregates ${agregados ? "✓" : "✗"}`, `session copy ${passosEmUso() ?? BUCKET_PASSOS_PADRAO} ${passos ? "✓" : "✗"}`].join(" · ") });
      setFonte(agregados ? "agregados" : passos ? "copia" : null);
    })();
    return () => { vivo = false; };
  }, []);

  // aplicações habilitadas na Configuração (Settings ou cópia no App State)
  useEffect(() => { let vivo = true; carregarHabilitadas().then((h) => { if (vivo) setHabilitadas(h); }); return () => { vivo = false; }; }, []);
  useEffect(() => { if (soHabilitadas && habilitadas && app !== TODAS && !habilitadas.has(app)) setApp(TODAS); }, [soHabilitadas, habilitadas, app]);

  // valores dos filtros de segmento (sistema, navegador, versão, país, região): uma varredura da cópia por janela, com
  // cache compartilhado de 5 min (lib/compartilhado.ts)
  useEffect(() => {
    if (!fonte || !passosEmUso()) { setValoresSegmento(null); return; }
    let vivo = true;
    const q = qValoresSegmento(janela);
    // os valores das 24 horas analisadas (H-06, lib/horaria.ts); sem elas, a leitura de 5 min de antes
    const doRetrato = fonte === "agregados"
      ? lerReq24().then((r) => (r ? { dados: r.valores as Record<string, unknown>[] } : null)).catch(() => null)
      : Promise.resolve(null);
    doRetrato.then((r) => r ?? lerCompartilhado("valores", chaveBloco(janela), () => dql(q, { contexto: "filtros/SEG-01", maxRecords: 1 }), { desistir: () => !vivo })).then((b) => {
      if (!vivo || !b) return;
      const l = b.dados[0] ?? {};
      const lista = (v: unknown) => (Array.isArray(v) ? v.map((x) => texto(x)).filter((x): x is string => !!x) : []);
      setValoresSegmento({ os: lista(l.os), navegador: lista(l.navegador), versao: lista(l.versao), pais: lista(l.pais), regiao: lista(l.regiao) });
    }).catch(() => { if (vivo) setValoresSegmento(null); });
    return () => { vivo = false; };
  }, [fonte, janela]);

  // jornadas salvas
  useEffect(() => {
    let vivo = true;
    carregarJornadas().then((r) => { if (vivo) { setJornadas(r.jornadas); setArmazenamento(r.armazenamento); } });
    return () => { vivo = false; };
  }, []);

  /** Backend do grafo para um escopo: cadeia pelo modelo de entidades (0 bytes; volume pela métrica nativa) e ligação
      página -> serviço (requisições da cópia x spans do mesmo trace, no máximo 1 h: a leitura de spans da carga). Só o
      Flow usa: a Visão geral não mostra serviços (destaques e qualidade leem páginas e navegações). Sem filtro de
      segmento, sai da leitura global da classe da janela (lerBackendGlobal); com ele, cache próprio de 5 min por escopo.
      Uma leitura só por escopo: quem sai e volta ao Flow no meio da carga espera a mesma. Nunca lança (a falha vira
      aviso); devolve null se o filtro de segmento mudou antes da consulta (o resultado não seria deste escopo). */
  const obterBackend = (escopo: Escopo, appsBase: Aplicacao[], fon: Fonte): Promise<ResultadoBackend | null> => {
    const chave = `backend|${escopo.chaveBackend}`;
    const emVoo = backendEmVoo.current.get(chave);
    if (emVoo && emVoo.inicio >= fimMinimo()) return emVoo.p;      // a de antes do Atualizar não serve
    const marca = {};
    leituraVigente.current.set(chave, marca);
    const p = lerBackend(chave, escopo, appsBase, fon, () => leituraVigente.current.get(chave) === marca);
    const voo = { p, inicio: Date.now() };
    backendEmVoo.current.set(chave, voo);
    const fim = () => { if (backendEmVoo.current.get(chave) === voo) backendEmVoo.current.delete(chave); };
    p.then(fim, fim);
    return p;
  };
  /** Backend sem filtro de segmento (etapa 5): a ligação página -> serviço de todas as aplicações e a cadeia a partir dos
      canais de todas são lidas uma vez por classe de janela (30m e 60m: de 2 h a 7 d a ligação lê a mesma última hora de
      spans) para todos os usuários e abas (lerCompartilhado, com o marcador), e o escopo (aplicação x robôs) sai delas
      no navegador (comporBackend), com o mesmo resultado da leitura por escopo. A cadeia global cobre também as
      aplicações da maior janela da classe (BCK-06, bucket rum_flow_agregados, leitura pequena); o volume dos serviços é
      lido por janela (métrica, R$ 0).
      "escopo" = a ligação global veio cortada no limite de linhas: esta aplicação lê por escopo, como antes. Nunca lança. */
  const lerBackendGlobal = async (escopo: Escopo, appsBase: Aplicacao[], fon: Fonte): Promise<ResultadoBackend | null | "escopo"> => {
    try {
      if (passosEmUso() !== escopo.passos) return null;                // a cópia do módulo já não é a deste escopo
      const classe = classeLigacao(escopo.janela), comLigacao = !!escopo.passos;
      const maior = fon === "agregados" ? janelaMaiorDaClasse(classe) : escopo.janela;
      const daBase = appsBase.map((x) => x.entidade).filter((x): x is string => !!x);
      // volume dos serviços na janela (métrica, R$ 0), compartilhado por janela; na leitura global, sai junto com os nomes
      const lerVolumeDe = (ids: string[]) => lerCompartilhado("volume", JSON.stringify(["volume", escopo.janela, resumoChave(ids.join(","))]),
        () => lerVolume(dqlBackend, ids, escopo.janela), { aceitar: (x) => Array.isArray(x) });
      // chave: classe, fonte e cópia (sem filtro de segmento, frames e cliques, que não mudam a ligação nem a cadeia)
      const b = await lerCompartilhado("backend", JSON.stringify(["backend-global", fon, classe, comLigacao, escopo.passos ?? "-"]), async (ctx) => {
        // canais de todas as aplicações: as da base deste escopo e as da maior janela da classe
        // 1.45.9: as entidades das aplicações habilitadas (lib/entidadesHabilitadas.ts, R$ 0) no lugar da leitura de 7 dias dos
        // agregados (BCK-06): cobrem qualquer janela da classe, porque só as habilitadas entram na cópia
        const entidades = maior === escopo.janela || !habilitadasRef.current?.size ? Promise.resolve(daBase)
          : entidadesHabilitadas(habilitadasRef.current).then((m) => [...new Set([...daBase, ...m.values()])], () => daBase);
        // a ligação página -> serviço das 24 horas analisadas (H-08, lib/horaria.ts); sem hora analisada, lida na hora
        const g = await carregarBackendGlobal(dqlBackend, classe, entidades, comLigacao ? () => lerLigacao24().catch(() => lerLigacaoNaHora(classe)) : null,
          (ids) => { if (ids.length) void lerVolumeDe(ids).catch(() => { /* relida abaixo */ }); });
        if (g.aviso && semPermissao(g.aviso)) ctx.naoGuardar();     // a falha de permissão é de quem leu
        return g;
      }, { aceitar: ehBackendGlobal });
      if (!b) return null;
      const g = b.dados;
      if (g.lig?.cortada && escopo.app !== TODAS) return "escopo";
      const canais = new Map(appsBase.filter((x) => x.entidade && (escopo.app === TODAS || x.id === escopo.app)).map((x) => [x.entidade!, x.id]));
      const ids = idsDoGlobal(g);
      const v = ids.length ? await lerVolumeDe(ids) : null;
      const volume = new Map((v?.dados ?? []).map((l) => [texto(l.servico) ?? "", Number(l.n ?? 0)]));
      const falhasServico = new Map((v?.dados ?? []).map((l) => [texto(l.servico) ?? "", Number(l.f ?? 0)]));
      let dados: DadosBackend | null = comporBackend(g, escopo.app, escopo.robos, canais, volume, falhasServico);
      if (!dados) {
        // a cadeia global não cobre este escopo (aplicação que entrou na base depois da leitura global): só a cadeia
        // dele, pelo modelo de entidades (0 bytes), sobre a ligação composta
        const paginas = comporLigacao(g, escopo.app, escopo.robos);
        dados = { ...(await carregarBackend(dqlBackend, canais, escopo.janela, [...new Set(paginas.map((x) => x.servico))])), paginas };
      }
      return { dados, aviso: g.aviso ? { tipo: "ligacao", msg: g.aviso } : null, lidoDesde: Math.min(b.desde, v?.desde ?? b.desde), deCache: b.deCache || !!v?.deCache };
    } catch (e) {
      // a cadeia não carregou (permissão de entidades, tempo esgotado): o Flow abre só com as páginas e o aviso
      return { dados: SEM_BACKEND, aviso: { tipo: "cadeia", msg: msgErro(e) } };
    }
  };
  const lerBackend = async (chave: string, escopo: Escopo, appsBase: Aplicacao[], fon: Fonte, ehVigente: () => boolean): Promise<ResultadoBackend | null> => {
    if (escopo.segmento === "-") { const r = await lerBackendGlobal(escopo, appsBase, fon); if (r !== "escopo") return r; }
    // com filtro de segmento, por escopo: vale o cache no formato certo, lido depois do Atualizar (fim mínimo da aba) e
    // sem falha de permissão. Hora de referência: quando a leitura começou (entradas antigas, sem ela: quando gravou)
    const doCache = async (): Promise<{ dados: ResultadoBackend; t: number } | null> => {
      const hit = await lerCache<ResultadoBackend>(chave, TTL_PADRAO_MS);
      const c = hit?.dados?.dados, lidoEm = hit ? (hit.dados?.lidoDesde ?? Date.now() - hit.idadeMs) : 0;
      return hit && c && listas(c.backend, c.servicos, c.chamadas, c.paginas) && lidoEm >= fimMinimo() && !(hit.dados.aviso && semPermissao(hit.dados.aviso.msg))
        ? { dados: { ...hit.dados, deCache: true }, t: lidoEm } : null;
    };
    let lider: Lider | null = null, gravacao: Promise<void> | null = null, leu = false;
    try {
      const hit = await doCache();
      if (hit) return hit.dados;
      // a consulta de spans lê o filtro de segmento do estado do módulo: se ele mudou, já não é este escopo
      if (chaveSegmento() !== escopo.segmento || passosEmUso() !== escopo.passos) return null;
      // leitura cara e outra aba lendo o mesmo escopo: espera o resultado dela (lib/compartilhado.ts)
      const vez = await esperarOuAssumir("backend", chave, doCache);
      if (vez.pronto) return vez.pronto.dados;
      lider = vez.lider ?? null;
      if (chaveSegmento() !== escopo.segmento || passosEmUso() !== escopo.passos) return null;
      const lidoDesde = Date.now();
      // com filtro de segmento, a ligação lida na hora com o filtro no lado da cópia (os spans não têm segmento)
      const ligacao: Promise<{ paginas: LinhaPagina[]; aviso: AvisoBackend | null }> = escopo.passos
        ? lerLigacaoNaHora(escopo.janela, filtroSegmentoDaCopia(), "backend/BCK-01").then(
            (linhas) => ({ paginas: ligacaoDoEscopo(linhas, escopo.app, escopo.robos), aviso: null }),
            (e) => ({ paginas: [], aviso: { tipo: "ligacao", msg: msgErro(e) } }))
        : Promise.resolve({ paginas: [], aviso: null });
      const canais = new Map(appsBase.filter((x) => x.entidade && (escopo.app === TODAS || x.id === escopo.app)).map((x) => [x.entidade!, x.id]));
      const qCanais = qCanaisServicos([...canais.keys()]);
      // os canais (modelo de entidades, 0 bytes) são lidos junto com os spans e os saltos começam por eles enquanto os
      // spans não chegam (R8; quando chegam, só o que falta). Os saltos partem dos canais e dos serviços das páginas numa
      // busca só, como na 1.30.2 (o que está a 6 saltos de uma página também é expandido)
      const linhasCanais = qCanais ? dql(qCanais, { contexto: "backend/BCK-02", maxRecords: 5000 }) : Promise.resolve([] as Record<string, unknown>[]);
      const [l, { backend, servicos, chamadas }] = await Promise.all([ligacao, carregarBackend(dqlBackend, canais, escopo.janela, ligacao.then((x) => [...new Set(x.paginas.map((p) => p.servico))]), linhasCanais)]);
      const r: ResultadoBackend = { dados: { backend, servicos, chamadas, paginas: l.paginas }, aviso: l.aviso, lidoDesde };
      leu = true;
      // não guarda a falha de permissão (é de quem leu; o cache é de todos) nem uma leitura que um Atualizar já substituiu
      if (ehVigente() && !(l.aviso && semPermissao(l.aviso.msg))) gravacao = gravarCache(chave, r, { desde: lidoDesde });
      return r;
    } catch (e) {
      // a cadeia não carregou (permissão de entidades, tempo esgotado): o Flow abre só com as páginas e o aviso; fica
      // fora do cache, para Atualizar ou outro escopo tentar de novo
      return { dados: SEM_BACKEND, aviso: { tipo: "cadeia", msg: msgErro(e) } };
    } finally {
      // solta o marcador depois de gravar (quem espera acha a entrada); a leitura que falhou solta sem gravar
      const ld = lider, ok = leu;
      if (ld) void (gravacao ?? Promise.resolve()).finally(() => ld.soltar(ok));
    }
  };

  // grafo: métricas (grátis) ou Grail (confirmado), com cache compartilhado. O backend (a leitura de spans da carga) só
  // entra com o Flow aberto; com a Visão geral aberta, fica para quando o Flow abrir (efeito seguinte)
  useEffect(() => {
    if (!fonte) return;
    const fon = fonte;
    let vivo = true;
    setCarregando(true); setErro(null);
    usarQuadros(quadros);
    const segmentoAtual = chaveSegmento(), passos = passosEmUso();
    const chaveBackend = `${fonte}|${app}|${janela}|${robos}|${passos ?? "-"}|${segmentoAtual}`;
    const escopo: Escopo = { chave: `${chaveBackend}|q${quadros ? 1 : 0}`, chaveBackend, app, janela, robos, segmento: segmentoAtual, passos };
    escopoVigente.current = escopo.chave;
    // com o Flow aberto, o backend vem na mesma carga (o grafo aparece completo); sem navegação, não há o que ligar.
    // desdeBase = início da leitura da base quando ela veio do cache (null = lida agora por esta aba)
    const completar = async (base: DadosBase, desdeBase: number | null) => {
      if (!vivo) return;
      const b = telaRef.current === "fluxo" && base.arestas.length > 0 ? await obterBackend(escopo, base.apps, fon) : null;
      if (!vivo) return;
      setAvisoBackend(b ? b.aviso : null);
      setDados({ ...base, ...SEM_BACKEND, ...(b ? b.dados : {}), escopo, comBackend: !!b, recebidoEm: Date.now() });
      deCache("base", desdeBase); deCache("backend", b?.deCache ? b.lidoDesde ?? null : null);
    };
    const nomeBase = `base|${escopo.chave}`;
    // vale a entrada no formato certo e lida depois do Atualizar (fim mínimo da aba)
    const doCache = async (): Promise<{ dados: DadosBase; t: number } | null> => {
      const hit = await lerCache<DadosBase>(nomeBase, TTL_PADRAO_MS);
      const h = hit?.dados;
      return hit && h && listas(h.apps, h.arestas, h.views) && hit.t >= fimMinimo() ? { dados: h, t: hit.t } : null;
    };
    (async () => {
      let lider: Lider | null = null, gravacao: Promise<void> | null = null, leu = false;
      try {
        const hit = await doCache();
        if (hit) { await completar(hit.dados, hit.t); return; }
        // a leitura vai até o fim e grava o cache mesmo que o efeito saia no meio (outra tela, outro período): a leitura já
        // paga serve quem vier depois. Só a leitura mais nova deste escopo grava, e só segue enquanto o estado do módulo de
        // consultas (filtro, cópia, frames) é o deste escopo: as consultas seguintes são montadas a partir dele
        const marca = {};
        leituraVigente.current.set(nomeBase, marca);
        const segue = () => vivo || (chaveSegmento() === segmentoAtual && passosEmUso() === passos && quadrosEmUso() === quadros);
        // leitura cara e outra aba lendo o mesmo escopo: espera o resultado dela (lib/compartilhado.ts)
        const vez = await esperarOuAssumir("base", nomeBase, doCache, { desistir: () => !vivo });
        if (vez.desistiu) return;
        if (vez.pronto) { await completar(vez.pronto.dados, vez.pronto.t); return; }
        lider = vez.lider;
        if (!segue()) return;
        // a janela relativa termina no fim da última fatia gravada (no máximo uma releitura por minuto, R$ 0,00...)
        if (fonte === "agregados") await lerFimAgregados();
        const lidoDesde = Date.now();
        // sem filtro de segmento, a base são as somas das fatias (agregados); com filtro de segmento (os agregados não têm
        // essas dimensões) ou sem os agregados, as 4 consultas numa leitura da cópia (BAS-S, lib/juntas.ts)
        const usarAgregados = fonte === "agregados" && !segmentoAtivo();
        if (!usarAgregados && !passosEmUso()) throw new Error(t("Sem a cópia das sessões: peça a um administrador para abrir a Configuração.", "No session copy: ask an administrator to open the Configuration."));
        // agregados: cada leitor lê só as fatias guardadas do trecho e soma a cabeça e a cauda da leitura ao vivo da aba
        const tr = usarAgregados ? trechoDa(janela, "base/BAS-00") : null;
        const [la, a, v, e] = usarAgregados
          ? await Promise.all([
            comTrecho(tr, (t) => dql(qAplicacoesAgregado(janela, t), { contexto: "base/BAS-01" }), juntarAplicacoes),
            comTrecho(tr, (t) => dql(qArestasAgregado(app, janela, robos, quadros, LIMITE_ARESTAS_METRICA, t), { contexto: "base/BAS-02", maxRecords: LIMITE_ARESTAS_METRICA }), (x, l) => juntarArestas(x, l, app, robos, quadros, LIMITE_ARESTAS_METRICA)),
            comTrecho(tr, (t) => dql(qViewsAgregado(app, janela, robos, t), { contexto: "base/BAS-03", maxRecords: 4000 }), (x, l) => juntarViews(x, l, app, robos)),
            comTrecho(tr, (t) => dql(qErrosPorViewAgregado(app, janela, robos, t), { contexto: "base/BAS-04", maxRecords: 4000 }), (x, l) => juntarErros(x, l, app, robos))])
          : await planoBaseCopia(app, janela, robos)();
        if (!segue()) return;
        const apps = la.map((l) => ({ id: texto(l["dt.rum.application.id"]) ?? "", nome: texto(l.nome) ?? texto(l["frontend.name"]) ?? texto(l["dt.rum.application.id"]) ?? "", canal: canalDaEntidade(texto(l.entidade)), entidade: texto(l.entidade), navegacoes: num(l.navegacoes), sessoes: num(l.sessoes) })).filter((x) => x.id);
        const arestas: LinhaAresta[] = a.map((l) => ({ app: texto(l.app) ?? "", de: texto(l.de), para: texto(l.para) ?? "", tipo: texto(l.tipo), n: num(l.n), sessoes: num(l.sessoes) }));
        // 1.45.9: sem o desenho de 24 h; o grafo mostra só o que teve navegação no período.
        // A aplicação habilitada sem navegação no período sai no aviso "Sem coleta" (semColeta).
        // As três leituras da cópia a seguir (entradas do mobile, origens recuperadas e híbrido) não dependem uma da outra:
        // saem juntas (R8) e são aplicadas na ordem de antes, com as mesmas regras
        // mobile real sem a 1ª tela marcada: entrada pela 1ª tela de cada sessão, da cópia (qEntradasMobile, por plataforma:
        // no Android a tela da abertura, e a ligação dela fica; no iOS a 1ª tela navegada, e a origem dela, de fora da
        // sessão, sai das navegações)
        const mobileSemEntrada = apps.filter((x) => x.canal === "mobile" && (app === TODAS || x.id === app) && !arestas.some((r) => r.app === x.id && !r.de)).map((x) => x.id);
        const mobilesEscopo = apps.filter((x) => x.canal === "mobile" && (app === TODAS || x.id === app)).map((x) => x.id);
        const copia = !!passosEmUso();
        // 1.46.1: as origens recuperadas (aba nova e frames) saem das fatias (grupo orig) quando todas as fatias da janela têm o
        // grupo; com fatia de antes da troca, filtro de segmento ou sem agregados, da cópia do período (BAS-10), como antes
        const lerOrigens = async (): Promise<Record<string, unknown>[] | null> => {
          if (usarAgregados) {
            try {
              const cob = (ls: Record<string, unknown>[]) => ls.filter((r) => r.linha === "cobertura");
              const sem = (ls: Record<string, unknown>[]) => ls.filter((r) => r.linha !== "cobertura");
              const x = await comTrecho(tr, (t) => dql(qOrigensAgregado(app, janela, robos, t), { contexto: "base/BAS-10A", maxRecords: 4001 }), (ls, l) => [...cob(ls), ...juntarOrigens(sem(ls), l, app, robos)]);
              const c = cob(x)[0];
              if (c && num(c.antigas) === 0) return sem(x);
            } catch { /* lê da cópia, abaixo */ }
          }
          return copia ? dql(qOrigensRecuperadas(app, janela, robos), { contexto: "base/BAS-10", maxRecords: 4000 }).catch(() => null) : null;
        };
        const [entradasMobile, origens, hibridas, quadros24] = await Promise.all([
          mobileSemEntrada.length && copia ? dql(qEntradasMobile(mobileSemEntrada, janela, robos), { contexto: "base/BAS-09", maxRecords: 4000 }).catch(() => null) : Promise.resolve(null),
          lerOrigens(),
          mobilesEscopo.length && copia ? dql(qHibrido(mobilesEscopo, janela, robos), { contexto: "base/BAS-11", maxRecords: 2000 }).catch(() => null) : Promise.resolve(null),
          quadros ? Promise.resolve(null) : carregarComponentes().catch(() => null),   // 1.45.10: frames das 24 h (App State da análise de hora em hora, R$ 0)
        ]);
        if (entradasMobile) {
          try {
            for (const l of entradasMobile) {
              const appL = texto(l.app) ?? "", para = texto(l.para) ?? "", de = texto(l.de), n = num(l.n);
              arestas.push({ app: appL, de: null, para, tipo: null, n, sessoes: n });
              const falsa = de ? arestas.find((r) => r.app === appL && r.de === de && r.para === para) : undefined;
              if (falsa) falsa.n = Math.max(0, falsa.n - n);
            }
          } catch { /* sem a entrada do mobile, o resto do grafo continua */ }
        }
        if (!segue()) return;
        // tela aberta em aba nova ou dentro de frame: o RUM não liga a origem, mas o navegador informa a página anterior;
        // vira passo (anterior -> tela) quando a anterior é uma página conhecida da mesma aplicação, e sai da entrada
        // 1.45.8: a mesma leitura traz os frames (quadro) com a página que os contém: com os frames escondidos, eles não viram
        // passo, só dizem de que página fazem parte (contem: app|frame -> página -> cargas)
        const contem = origens && !quadros ? mapaDeQuadros(origens) : new Map<string, Map<string, number>>();
        if (origens) {
          try {
            const conhecidas = new Set<string>();
            for (const r of arestas) { conhecidas.add(`${r.app}|${r.para}`); if (r.de) conhecidas.add(`${r.app}|${r.de}`); }
            for (const l of origens) {
              const appL = texto(l.app) ?? "", de = texto(l.de) ?? "", para = texto(l.para) ?? "", n = num(l.n);
              if (!quadros && ehQuadro(l)) continue;      // frame escondido: só diz de que página faz parte (abaixo)
              if (!de || !conhecidas.has(`${appL}|${de}`)) continue;
              const entrada = arestas.find((r) => r.app === appL && !r.de && r.para === para);
              const usar = entrada ? Math.min(n, entrada.n) : 0;
              if (usar <= 0) continue;                 // só converte o que foi contado como entrada
              entrada!.n -= usar;
              arestas.push({ app: appL, de, para, tipo: texto(l.tipo), n: usar, sessoes: usar });
            }
          } catch { /* sem a recuperação, o grafo continua como antes */ }
        }
        // HÍBRIDO: página web aberta numa WebView do app, com o monitoramento híbrido ligado (o evento web traz dt.rum.adk
        // com a sessão do app). Liga a tela nativa que abriu a WebView -> 1ª página web, e com o app mobile selecionado traz
        // junto as páginas web dele (que são outra aplicação RUM)
        if (!segue()) return;
        if (hibridas) {
          try {
            const linhasH = hibridas;
            const webs = app === TODAS ? [] : [...new Set(linhasH.map((l) => texto(l.app_web) ?? "").filter((w) => w && w !== app))];
            for (const w of usarAgregados ? webs : []) {
              if (!segue()) return;
              const [aw, vw, ew] = await Promise.all([
                comTrecho(tr, (t) => dql(qArestasAgregado(w, janela, robos, quadros, LIMITE_ARESTAS_METRICA, t), { contexto: "base/BAS-12", maxRecords: LIMITE_ARESTAS_METRICA }), (x, l) => juntarArestas(x, l, w, robos, quadros, LIMITE_ARESTAS_METRICA)),
                comTrecho(tr, (t) => dql(qViewsAgregado(w, janela, robos, t), { contexto: "base/BAS-12", maxRecords: 4000 }), (x, l) => juntarViews(x, l, w, robos)),
                comTrecho(tr, (t) => dql(qErrosPorViewAgregado(w, janela, robos, t), { contexto: "base/BAS-12", maxRecords: 4000 }), (x, l) => juntarErros(x, l, w, robos))]);
              for (const l of aw) arestas.push({ app: texto(l.app) ?? "", de: texto(l.de), para: texto(l.para) ?? "", tipo: texto(l.tipo), n: num(l.n), sessoes: num(l.sessoes) });
              v.push(...vw); e.push(...ew);
            }
            for (const l of linhasH) {
              const appW = texto(l.app_web) ?? "", appM = texto(l.app_mobile) ?? "", tela = texto(l.tela) ?? "", pagina = texto(l.pagina) ?? "", n = num(l.n);
              if (!appW || !tela || !pagina) continue;
              const entrada = arestas.find((r) => r.app === appW && !r.de && r.para === pagina);
              if (entrada) entrada.n = Math.max(0, entrada.n - n);
              arestas.push({ app: appW, appDe: appM, de: tela, para: pagina, tipo: "hibrido", n, sessoes: n });
            }
          } catch { /* sem a costura híbrida, o grafo continua */ }
        }
        // 1.45.10: frames reconhecidos pelas cargas das últimas 24 h (lib/quadros.ts, componentesDe), também nas cargas que o
        // RUM não marca como frame: saem dos passos e contam na página que os contém; a navegação que sai deles sai da página
        if (quadros24) arestas.splice(0, arestas.length, ...aplicarComponentes(arestas, quadros24, contem));
        // frames: cada frame fica com a página que mais o contém; o erro de uma página que só existe como frame (não aparece
        // como troca de página no grafo) conta na página que a contém, em vez de ficar num nó escondido
        const naTela = new Set<string>();
        for (const r of arestas) { naTela.add(`${r.app}|${r.para}`); if (r.de) naTela.add(`${r.app}|${r.de}`); }
        const { quadros: quadrosBase, erros: errosJuntos } = juntarQuadros(contem, naTela, e);
        const errosPorView = new Map(errosJuntos.map((l) => [`${texto(l.app)}|${texto(l.view)}`, l]));
        const views: LinhaView[] = v.map((l) => ({ app: texto(l.app) ?? "", view: texto(l.view) ?? "", views: num(l.views), sessoes: num(l.sessoes), tempo_ms: l.tempo_ms == null ? null : num(l.tempo_ms), erros: 0, excecoes: 0, falhas: 0 }));
        for (const vw of views) { const x = errosPorView.get(`${vw.app}|${vw.view}`); if (x) { vw.erros = num(x.erros); vw.excecoes = num(x.excecoes); vw.falhas = num(x.falhas); errosPorView.delete(`${vw.app}|${vw.view}`); } }
        for (const [, x] of errosPorView) if (texto(x.view)) views.push({ app: texto(x.app) ?? "", view: texto(x.view) ?? "", views: 0, sessoes: 0, tempo_ms: null, erros: num(x.erros), excecoes: num(x.excecoes), falhas: num(x.falhas) });
        if (!segue()) return;
        const base: DadosBase = { apps, arestas, views, quadros: quadrosBase };
        leu = true;
        const desde = tr ? Math.min(lidoDesde, tr.lidoEm) : lidoDesde;
        if (leituraVigente.current.get(nomeBase) === marca) gravacao = gravarCache(nomeBase, base, { desde });
        if (!vivo) return;
        await completar(base, Date.now() - desde > 60000 ? desde : null);
      } catch (e) { if (vivo) setErro(msgErro(e)); }
      finally {
        if (vivo) setCarregando(false);
        const ld = lider, ok = leu;
        if (ld) void (gravacao ?? Promise.resolve()).finally(() => ld.soltar(ok));   // solta o marcador depois de gravar
      }
    })();
    return () => { vivo = false; };
  }, [fonte, app, janela, robos, segmento, atualizacao, quadros, recargaBase]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Flow aberto com o grafo que a Visão geral carregou (sem backend): completa com a cadeia do backend e a ligação
  // página -> serviço. Quem fica só na Visão geral não lê spans. Só completa o escopo da última carga, e não depois de
  // uma falha dela (não lê spans de um escopo que já saiu da tela)
  useEffect(() => {
    const escopo = dados.escopo;
    if (tela !== "fluxo" || !fonte || carregando || erro || !escopo || escopo.chave !== escopoVigente.current || dados.comBackend || dados.arestas.length === 0) return;
    // esta tela está com a base há mais de 5 min (Visão geral aberta há tempo): relê a base junto com o backend, do mesmo
    // período (a idade conta da hora em que a tela recebeu a base, não da gravação do cache)
    if (Date.now() - dados.recebidoEm > TTL_PADRAO_MS) { setRecargaBase((v) => v + 1); return; }
    let vivo = true;
    const appsBase = dados.apps;
    setCarregandoBackend(true);
    (async () => {
      try {
        const b = await obterBackend(escopo, appsBase, fonte);
        if (!vivo || !b) return;
        setAvisoBackend(b.aviso);
        setDados((d) => (d.escopo?.chave === escopo.chave && !d.comBackend ? { ...d, ...SEM_BACKEND, ...b.dados, comBackend: true } : d));
        deCache("backend", b.deCache ? b.lidoDesde ?? null : null);
      } catch { /* obterBackend não lança */ }
      finally { if (vivo) setCarregandoBackend(false); }
    })();
    return () => { vivo = false; setCarregandoBackend(false); };
  }, [tela, fonte, carregando, erro, dados.escopo, dados.comBackend]);   // eslint-disable-line react-hooks/exhaustive-deps

  // qualidade do dado (cópia enxuta): telas sem nome, aba nova sem origem, frames, chamadas sem trace. Cache compartilhado
  // de 5 min (lib/compartilhado.ts); o Atualizar relê (fim mínimo). Qualidade e domínios numa leitura (QUA-U, lib/juntas.ts)
  useEffect(() => {
    if (!fonte || !passosEmUso()) { setQualidade([]); setChamadasOp({ chamadas: null, terceiros: null }); deCache("qualidade", null); return; }
    let vivo = true;
    const ler = planoQualidade(app, janela, robos);
    // escopo padrão (sem robôs, sem filtro de segmento): as 24 horas analisadas (H-04, lib/horaria.ts), uma leitura pequena
    // nos agregados; fora dele, ou sem hora analisada, a leitura da cópia de antes
    const doRetrato = fonte === "agregados" && !robos && chaveSegmentoDe(segmento) === "-"
      ? lerReq24().then((r) => {
          if (!r) return null;
          const q = qualidadeDas24(app === TODAS ? r.qualidade : r.qualidade.filter((l) => l.app === app));
          return { dados: [q.qualidade, q.dominios, q.chamadas, q.terceiros] as unknown as ResultadoQualidade, desde: Date.now(), deCache: false };
        }).catch(() => null)
      : Promise.resolve(null);
    doRetrato.then((r) => r ?? lerCompartilhado("qualidade", chaveBloco(app, janela, robos), () => ler(),
      { desistir: () => !vivo, aceitar: (x) => listas(x[0], x[1]) })).then((b) => {
      if (!vivo || !b) return;
      const [q, d, ch, te] = b.dados;
      deCache("qualidade", b.deCache ? b.desde : null);
      setChamadasOp({ chamadas: Array.isArray(ch) ? ch : null, terceiros: Array.isArray(te) ? te : null });
      const dom = new Map<string, string>();
      for (const l of d) { const a = texto(l.app) ?? ""; if (!dom.has(a)) dom.set(a, texto(l.dominio) ?? ""); }
      setQualidade(q.map((l) => ({ app: texto(l.app) ?? "", navs: num(l.navs), novaAbaSemOrigem: num(l.nova_aba_sem_origem), frames: num(l.frames), semNome: num(l.sem_nome), genericas: num(l.genericas), hibridas: num(l.hibridas), wvAndroid: num(l.wv_and), wvAndroidHibrido: num(l.wv_and_hib), iosHibrido: num(l.ios_hib),
        reqs: num(l.reqs), reqsTrace: num(l.reqs_trace), dominioSemTrace: dom.get(texto(l.app) ?? "") || null })));
    }).catch(() => { if (vivo) { setQualidade([]); setChamadasOp({ chamadas: null, terceiros: null }); deCache("qualidade", null); } });
    return () => { vivo = false; };
  }, [fonte, app, janela, robos, atualizacao, chaveSegmentoDe(segmento)]);   // o filtro de segmento muda as contagens (antes ficavam as do filtro anterior)

  // a tela em uso: o workflow só lê as sessões da última hora enquanto alguém usa a Visão geral (lib/agendado.ts); aberta e
  // visível, ela marca o acesso ao abrir e de 5 em 5 min
  useEffect(() => {
    if (telaConfig || telaSobre || tela !== "inicio") return;
    const marcar = () => { if (document.visibilityState === "visible") marcarAcesso(); };
    marcar();
    const id = window.setInterval(marcar, INTERVALO_ACESSO_MS);
    document.addEventListener("visibilitychange", marcar);
    return () => { window.clearInterval(id); document.removeEventListener("visibilitychange", marcar); };
  }, [tela, telaConfig, telaSobre, atualizacao]);

  // visão geral (tela inicial): indicadores por sessão, da cópia enxuta; só lê quando a tela está aberta
  useEffect(() => {
    if (tela !== "inicio" || !fonte || !passosEmUso()) return;
    let vivo = true;
    setCarregandoInicio(true); setErroInicio(null); setInicio(null); deCache("inicio", null);
    usarQuadros(quadros);
    // "inicio2": o modelo ganhou os lugares do mapa (o cache antigo, sem eles, não serve)
    // 1.43: no escopo padrão (sem robôs, sem frames, sem filtro de segmento), a Visão geral junta as bases de tempo do modelo
    // por feature (ver abaixo); "inicio3" para o cache não misturar com o modelo de antes
    const escopoNovo = fonte === "agregados" && !robos && !quadros && chaveSegmentoDe(segmento) === "-";
    const chaveDe = (s: Segmento) => `${escopoNovo ? "inicio3" : "inicio2"}|${app}|${janela}|${robos}|q${quadros ? 1 : 0}|${passosEmUso() ?? "-"}|${chaveSegmentoDe(s)}`;
    const chave = chaveDe(segmento);
    const semLugar = !segmento.pais && !segmento.regiao;
    const chaveSemLugar = chaveDe({ ...segmento, pais: undefined, regiao: undefined });
    const guardarLugares = (d: DadosInicio) => { if (semLugar && vivo) setLugaresBase({ chave: chaveSemLugar, lugares: d.lugares ?? [], geradoEm: d.geradoEm }); };
    // com um lugar escolhido e sem a leitura sem filtro na memória (ou com mais de 5 min): tenta o cache dela, que é grátis.
    // O recorte filtrado vindo do cache espera essa leitura, para o mapa não abrir com uma bolha só e depois completar.
    const basePronta = !semLugar && (lugaresBase?.chave !== chaveSemLugar || Date.now() - lugaresBase.geradoEm > TTL_PADRAO_MS)
      ? lerCache<DadosInicio>(chaveSemLugar, TTL_PADRAO_MS).then((h) => { if (h && vivo) setLugaresBase({ chave: chaveSemLugar, lugares: h.dados.lugares ?? [], geradoEm: h.dados.geradoEm }); }).catch(() => {})
      : Promise.resolve();
    // vale a entrada lida depois do Atualizar (fim mínimo da aba)
    const doCache = async (): Promise<{ dados: DadosInicio; t: number } | null> => {
      const hit = await lerCache<DadosInicio>(chave, TTL_PADRAO_MS);
      return hit && hit.t >= fimMinimo() ? { dados: hit.dados, t: hit.t } : null;
    };
    const usarCache = async (h: { dados: DadosInicio; t: number }) => { await basePronta; if (vivo) { setInicio(h.dados); guardarLugares(h.dados); deCache("inicio", h.t); } };
    (async () => {
      let lider: Lider | null = null, gravacao: Promise<void> | null = null, leu = false;
      try {
        const hit = await doCache();
        if (hit) { await usarCache(hit); return; }
        // 1.45.11: frames das 24 h nas leituras por sessão (lib/queries.ts) e nos erros (cartões e série, abaixo)
        const comp = quadros ? new Map<string, string>() : (await carregarComponentes().catch(() => null)) ?? new Map<string, string>();
        if (escopoNovo) {
          // MODELO POR FEATURE (1.43, definido em 20/10/2026), sem leitura da cópia a não ser a última hora:
          //   indicadores de sessão, aplicações e mapa · as sessões da última hora (workflow a cada 15 min, ou lidas na hora);
          //   onde as sessões terminam, caminhos e páginas · as 24 horas analisadas (lib/horaria.ts, H-01 a H-03);
          //   erros e a série · ao vivo, pelos agregados errx/erro e a ponta da aba (lib/aovivo.ts).
          const lidoDesde = Date.now();
          await lerFimAgregados();
          const tr = trechoDa(janela, "inicio/INI-00");
          const so = tr?.t ?? (() => { const i = intervaloAgregados(janela); return { ini: i.ini, iniFatias: i.ini, fimFatias: i.fim, fim: i.fim }; })();
          const doApp = (ls: Record<string, unknown>[]) => (app === TODAS ? ls : ls.filter((l) => l.app === app));
          const [s24, e, se, uh, trl] = await Promise.all([
            lerSessoes24().catch(() => null),
            comTrecho(tr, (t) => dql(qErrosClienteAgregado(app, janela, false, t), { contexto: "inicio/ERR-01", maxRecords: 300 }), (x, l) => juntarErrosCliente(x, l, app, false)),
            dql(qSerieErrosAgregado(app, janela, false, INTERVALO_SERIE[janela], so), { contexto: "inicio/INI-05", maxRecords: 5000 }).catch(() => [] as Record<string, unknown>[]),
            lerUltimaHora().catch(() => null),
            tr ? tr.linhas.catch(() => null) : Promise.resolve(null),
          ]);
          const ps = s24?.periodo ?? null;
          const f24 = s24 ? doApp(s24.fins) : [], c24 = s24 ? caminhosDoEscopo(s24.caminhos, app) : [], p24 = s24 ? doApp(s24.paginas) : [];
          const lugaresHora = !uh ? [] : app === TODAS ? uh.lugares.filter((l) => l.tipo === "lugar") : uh.lugares.filter((l) => l.tipo === "lugarapp" && l.app === app).map((l) => ({ ...l, tipo: "lugar" }));
          const novo = inicioDasLinhas({ f: f24, p: [...p24, ...lugaresHora], c: c24, e: errosComComponentes(e, comp) }, errosComComponentes(se, comp), janela, so.fim, trl && tr ? errosComComponentes(serieDoTrecho(trl, tr.t, app, false), comp) : []);
          novo.total24 = novo.total; novo.porApp24 = novo.porApp;   // as 24 h analisadas (H-SES), antes de virar a última hora
          if (uh) {
            const k = inicioDasLinhas({ f: app === TODAS ? uh.fins : uh.fins.filter((l) => l.app === app), p: [], c: [], e: [] }, [], "60m", uh.t);
            novo.total = k.total; novo.porApp = k.porApp;
          }
          novo.periodos = { ultimaHora: uh ? { de: uh.t - MS_HORA, ate: uh.t } : null, dia: ps ? { de: ps.de, ate: ps.ate, horas: ps.horas } : null };
          novo.sessoesHora = uh?.sessoes ?? [];
          leu = true;
          if (vivo) { setInicio(novo); guardarLugares(novo); deCache("inicio", null); }
          gravacao = gravarCache(chave, novo, { desde: lidoDesde });
          return;
        }
        // como na base: a leitura já paga vai ao cache mesmo que o efeito tenha saído; só a mais nova deste escopo grava
        const marca = {};
        leituraVigente.current.set(chave, marca);
        // leitura cara e outra aba lendo o mesmo escopo: espera o resultado dela (lib/compartilhado.ts)
        const vez = await esperarOuAssumir("inicio", chave, doCache, { desistir: () => !vivo });
        if (vez.desistiu) return;
        if (vez.pronto) { await usarCache(vez.pronto); return; }
        lider = vez.lider;
        if (!vivo) return;                       // saiu durante a confirmação do marcador: não lê para ninguém
        const lidoDesde = Date.now();
        // fins e caminhos numa leitura (INI-A, lib/juntas.ts); páginas, erros e a série como antes
        const [{ f, p, c, e }, se] = await Promise.all([planoInicio(app, janela, robos)(), dql(qInicioSerieErros(app, janela, robos), { contexto: "inicio/INI-05", maxRecords: 5000 }).catch(() => [] as Record<string, unknown>[])]);
        const novo = inicioDasLinhas({ f, p, c, e: errosComComponentes(e, comp) }, errosComComponentes(se, comp), janela);
        leu = true;
        if (vivo) { setInicio(novo); guardarLugares(novo); deCache("inicio", null); }
        if (leituraVigente.current.get(chave) === marca) gravacao = gravarCache(chave, novo, { desde: lidoDesde });
      } catch (e) { if (vivo) setErroInicio(e instanceof Error ? e.message : String(e)); }
      finally {
        if (vivo) setCarregandoInicio(false);
        const ld = lider, ok = leu;
        if (ld) void (gravacao ?? Promise.resolve()).finally(() => ld.soltar(ok));   // solta o marcador depois de gravar
      }
    })();
    return () => { vivo = false; setCarregandoInicio(false); };
  }, [tela, fonte, app, janela, robos, segmento, atualizacao, quadros]);

  // funil de uma jornada (Grail por sessão, no bucket). Também chamado ao abrir um drill, para funil e drill
  // refletirem o mesmo instante (a janela é relativa: "últimos 30 min" anda com o relógio).
  // O resultado só entra se o escopo da tela ainda for o do pedido e nenhum pedido mais novo da mesma jornada já tiver
  // chegado: antes, o funil de outro período (ou filtro) aparecia e às vezes ficava por cima do novo
  const escopoFunil = `${janela}|${robos}|${passosEmUso() ?? "-"}|${chaveSegmentoDe(segmento)}`;
  const escopoFunilAtual = useRef(escopoFunil);
  escopoFunilAtual.current = escopoFunil;
  const ordemFunil = useRef({ pedidos: 0, aplicado: new Map<string, number>() });
  // a linha do funil na tela de cada jornada, com o escopo e o início da leitura: o "Por quê?" usa a mesma quando ela é
  // de agora (até 30 s) e devolve a dele quando lê ou vem do cache, para funil e análise mostrarem o mesmo instante
  const ultimoFunil = useRef(new Map<string, { linha: Record<string, unknown> | undefined; desde: number; escopo: string }>());
  // a lista de passos das jornadas de agora: o pacote dos funis acima da guarda para quando ela muda (lib/juntas.ts planoFunis)
  const passosAtuais = useRef("");
  const fonteFunis = useRef<Fonte | null>(null);
  fonteFunis.current = fonte;
  // a chave das jornadas salvas, a mesma que a ação usa (os funis das 24 h só valem para a mesma lista)
  usarChaveFunis((() => { const ps = jornadas.filter((j) => j.passos.length > 0).map((j) => j.passos.map((x) => ({ app: String(x.app), view: String(x.view) }))); return ps.length ? chaveJornadas(ps) : null; })());
  const escopoDaJornada = (j: Jornada) => `${escopoFunilAtual.current}|${JSON.stringify(j.passos)}`;
  const calcularFunil = useCallback(async (j: Jornada) => {
    if (j.passos.length === 0) { setFunis((f) => ({ ...f, [j.id]: null })); return; }
    const escopo = `${janela}|${robos}|${passosEmUso() ?? "-"}|${chaveSegmentoDe(segmento)}`;
    const pedido = ++ordemFunil.current.pedidos;
    const vale = () => {
      const o = ordemFunil.current;
      if (escopoFunilAtual.current !== escopo || pedido < (o.aplicado.get(j.id) ?? 0)) return false;
      o.aplicado.set(j.id, pedido);
      return true;
    };
    try {
      // uma leitura: o funil traz também os erros de cada passo (erros0..errosN)
      const desde = Date.now();
      const linhas = await dql(qFunil(j.passos, janela, robos), { contexto: "funil/FUN-01", maxRecords: 10 });
      if (!vale()) return;
      ultimoFunil.current.set(j.id, { linha: linhas[0], desde, escopo: `${escopo}|${JSON.stringify(j.passos)}` });
      setFunis((f) => ({ ...f, [j.id]: montarFunil(j, linhas[0]) }));
    } catch (e) {
      if (!vale()) return;
      setFunis((f) => ({ ...f, [j.id]: null }));
      setErroFunil(e instanceof Error ? e.message : String(e));
    }
  }, [janela, robos, segmento]);
  /** Os funis de todas as jornadas numa leitura (FUN-T em lotes, lib/juntas.ts), com o pacote no cache compartilhado de
      5 min (chave = escopo inteiro e a lista de passos de cada jornada). Cada funil entra pela mesma conferência de escopo
      e de ordem de calcularFunil: o pacote não passa por cima de um funil mais novo da mesma jornada (Atualizar, "Por
      quê?"), nem aparece se o período ou o filtro mudou. */
  const calcularFunis = useCallback(async (lista: Jornada[]) => {
    const vazias = lista.filter((j) => j.passos.length === 0), com = lista.filter((j) => j.passos.length > 0);
    if (vazias.length) setFunis((f) => ({ ...f, ...Object.fromEntries(vazias.map((j) => [j.id, null])) }));
    if (!com.length) return;
    const escopo = `${janela}|${robos}|${passosEmUso() ?? "-"}|${chaveSegmentoDe(segmento)}`;
    const pedido = ++ordemFunil.current.pedidos;
    const vale = (j: Jornada) => {
      const o = ordemFunil.current;
      if (escopoFunilAtual.current !== escopo || pedido < (o.aplicado.get(j.id) ?? 0)) return false;
      o.aplicado.set(j.id, pedido);
      return true;
    };
    const aplicar = (j: Jornada, linha: Record<string, unknown>, desde: number) => {
      if (ultimoFunil.current.get(j.id)?.linha === linha || !vale(j)) return;
      ultimoFunil.current.set(j.id, { linha, desde, escopo: `${escopo}|${JSON.stringify(j.passos)}` });
      setFunis((f) => ({ ...f, [j.id]: montarFunil(j, linha) }));
    };
    const falhar = (j: Jornada, msg: string) => { if (!vale(j)) return; setFunis((f) => ({ ...f, [j.id]: null })); setErroFunil(msg); };
    // textos e chave montados agora, com o filtro e a cópia de agora
    const passos = com.map((j) => j.passos);
    const chavePassos = JSON.stringify(passos);
    passosAtuais.current = chavePassos;
    const ler = planoFunis(passos, janela, robos);
    // quem pediu saiu do escopo: outro período ou filtro (e não voltou), ou outra lista de jornadas. Acima da guarda o pacote
    // (uma jornada por vez) para antes da próxima jornada e não vai ao cache incompleto; abaixo dela nada muda
    const saiu = () => escopoFunilAtual.current !== escopo || passosAtuais.current !== chavePassos;
    try {
      // escopo padrão (sem robôs, sem filtro de segmento) e as mesmas jornadas que a ação analisa: os funis das 24 horas
      // analisadas (H-07, lib/horaria.ts), uma leitura pequena nos agregados
      const chaveF = chaveFunisEmUso();
      if (fonteFunis.current === "agregados" && !robos && chaveSegmentoDe(segmento) === "-" && chaveF) {
        const r = await lerReq24().catch(() => null);
        if (r && r.funisDe === chaveF && r.funil) { const ls = linhasDosFunis(r.funil, passos); com.forEach((j, i) => aplicar(j, ls[i], Date.now())); return; }
      }
      const b = await lerCompartilhado("funil", chaveBloco(janela, robos, chavePassos), async (ctx) => {
        // cada funil vai para a tela quando o lote dele chega; o pacote só vai ao cache inteiro
        const r = await ler({ aoParcial: (i, linha, desde) => aplicar(com[i], linha, desde), aoFalhar: (i, msg) => falhar(com[i], msg), desistir: saiu });
        if (r.falhas.some(Boolean) || r.parou) ctx.naoGuardar();
        // o pacote que parou leva a marca (fora do JSON: não vai ao cache) para quem pegou a mesma leitura em andamento
        if (r.parou) Object.defineProperty(r.linhas, "parou", { value: true });
        return r.linhas;
      }, { aceitar: (x) => Array.isArray(x) && x.length === com.length });
      if (b) com.forEach((j, i) => { const l = b.dados[i]; if (l) aplicar(j, l, b.desde); });
      // o pacote que esta tela recebeu parou no meio (outro pedido do mesmo escopo, que saiu e voltou): as que faltam leem
      // uma por vez, como o Atualizar da jornada
      if (b && (b.dados as { parou?: boolean }).parou && !saiu()) for (const [i, j] of com.entries()) if (!b.dados[i]) void calcularFunil(j);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      for (const j of com) falhar(j, msg);
    }
  }, [janela, robos, segmento, calcularFunil]);   // eslint-disable-line react-hooks/exhaustive-deps
  const funilRecente = (j: Jornada, qualquerIdade = false) => {
    const u = ultimoFunil.current.get(j.id);
    return u && u.escopo === escopoDaJornada(j) && (qualquerIdade || Date.now() - u.desde <= 30_000) ? { linha: u.linha, desde: u.desde } : null;
  };
  /** o funil que o "Por quê?" leu (ou trouxe do cache) junto com a análise: entra como o pedido mais novo da jornada */
  const funilDoDrill = (j: Jornada, linha: Record<string, unknown> | undefined, desde: number) => {
    const u = ultimoFunil.current.get(j.id);
    if (u && u.linha === linha) return;
    const o = ordemFunil.current, pedido = ++o.pedidos;
    o.aplicado.set(j.id, pedido);
    ultimoFunil.current.set(j.id, { linha, desde, escopo: escopoDaJornada(j) });
    setFunis((f) => ({ ...f, [j.id]: montarFunil(j, linha) }));
  };
  // as sessões das 3 requisições mais lentas das 24 horas analisadas (lista de exemplos da Visão geral)
  const lerLentasVG = useCallback(async (): Promise<SessaoLenta[]> => {
    const r = await lerReq24();
    if (!r) return [];
    const m = r.lentas;
    return [...m.entries()].filter(([k]) => app === TODAS || k.startsWith(`${app}|`)).flatMap(([k, xs]) => { const i = k.indexOf("|"); return xs.map((x) => ({ ...x, app: k.slice(0, i), pagina: k.slice(i + 1) || null })); }).sort((a, b) => b.d - a.d);
  }, [app, atualizacao]);   // eslint-disable-line react-hooks/exhaustive-deps
  const atualizar = () => {
    marcarAtualizar();                         // fim mínimo: grafo, backend, Visão geral, painel, qualidade e lista releem
    forcarApdex.current = true;
    setAtualizacao((v) => v + 1);
    carregarHabilitadas().then((h) => setHabilitadas(h)).catch(() => {});
    if (jornada) calcularFunil(jornada);
  };

  // funis das jornadas (só depois de decidida a fonte): todos numa leitura, com cache compartilhado (calcularFunis)
  useEffect(() => {
    if (!fonte) return;
    setErroFunil(null);
    setFunis(Object.fromEntries(jornadas.map((j) => [j.id, undefined])));
    void calcularFunis(jornadas);
  }, [fonte, jornadas, calcularFunis]);

  const visiveis = useMemo<Dados>(() => {
    // 1.45.10: as chamadas ao backend feitas de dentro de um frame contam na página que o contém (o frame não é nó)
    const paginas = paginasComQuadros(dados.paginas, dados.quadros);
    if (!soHabilitadas || !habilitadas) return paginas === dados.paginas ? dados : { ...dados, paginas };
    const ok = (a: string) => habilitadas.has(a);
    return { ...dados, apps: dados.apps.filter((a) => ok(a.id)), arestas: dados.arestas.filter((a) => ok(a.app)), views: dados.views.filter((v) => ok(v.app)),
             backend: dados.backend.filter((b) => ok(b.app)), paginas: paginas.filter((p) => ok(p.app)) };
  }, [dados, soHabilitadas, habilitadas]);
  const apps = visiveis.apps;
  // aplicações que não estão na base do período (só erro ou requisição, sem navegação na janela; ou, desde a 1.43, as do
  // desenho de 24 h sem coleta no período) mostrariam o id (ex.: app mobile que só mandou erros, ou parado, aparecia pelo
  // UUID no aviso de coleta): o nome vem da entidade, pelo id do RUM (BAS-12, entidades, R$ 0)
  const [appsExtras, setAppsExtras] = useState<Aplicacao[]>([]);
  useEffect(() => {
    const ids = [...new Set([...(inicio?.porApp ?? []).map((r) => r.app), ...visiveis.arestas.map((a) => a.app)])];
    const faltam = ids.filter((id) => id && id !== "*" && !apps.some((a) => a.id === id) && !appsExtras.some((a) => a.id === id));
    const candidatos = faltam.flatMap((id) => entidadesDoIdRum(id).map((entidade) => ({ id, entidade })));
    if (!candidatos.length) return;
    let vivo = true;
    dql(qNomesAplicacoes(candidatos.map((c) => c.entidade)), { contexto: "base/BAS-12" }).then((ls) => {
      if (!vivo) return;
      const nomes = new Map(ls.map((l) => [texto(l.entidade) ?? "", texto(l.nome) ?? ""]));
      const novos: Aplicacao[] = candidatos.filter((c) => nomes.get(c.entidade)).map((c) => ({ id: c.id, nome: nomes.get(c.entidade)!, canal: canalDaEntidade(c.entidade), entidade: c.entidade, navegacoes: 0, sessoes: 0 }));
      if (novos.length) setAppsExtras((x) => [...x, ...novos.filter((n) => !x.some((a) => a.id === n.id))]);
    }, () => undefined);
    return () => { vivo = false; };
  }, [inicio, apps, visiveis.arestas]);   // eslint-disable-line react-hooks/exhaustive-deps
  const appsTela = useMemo(() => [...apps, ...appsExtras.filter((x) => !apps.some((a) => a.id === x.id))], [apps, appsExtras]);

  // Apdex da visão geral: efeito próprio porque depende da lista de aplicações (sem ela, "Todas" sairia sem recorte);
  // cache de 5 min no App State, como a visão geral; o par entidade -> frontend.name (qApdexNomes), de 1 h
  useEffect(() => { setJanelaApdex(null); }, [app, janela]);
  // a métrica só tem sistema e navegador: país, região e versão não mudam o Apdex, então clicar num lugar do mapa não o relê
  // (os filtros ignorados saem do filtro atual na hora de desenhar). Com filtro de lugar a lista de aplicações vem da cópia
  // filtrada (só quem teve sessão no lugar): o Apdex usa a lista do mesmo escopo sem o filtro de lugar, quando já existe,
  // para não encolher o recorte do cartão nem reler a métrica a cada lugar
  const segApdex = chaveSegmentoDe({ os: segmento.os, navegador: segmento.navegador });
  const comLugar = !!(segmento.pais || segmento.regiao);
  const chaveSemLugarApps = `${janela}|${robos}|${soHabilitadas ? 1 : 0}|${chaveSegmentoDe({ ...segmento, pais: undefined, regiao: undefined })}`;
  const appsSemLugar = useRef<{ chave: string; apps: AppInfo[] }>({ chave: "", apps: [] });
  // só guarda a lista quando a base na tela é deste escopo sem lugar (logo depois de tirar o filtro, ela ainda é a do lugar)
  const baseDoEscopo = dados.escopo?.segmento === chaveSegmento() && dados.escopo.janela === janela && dados.escopo.robos === robos;
  if (!comLugar && baseDoEscopo && apps.length > 0) appsSemLugar.current = { chave: chaveSemLugarApps, apps };
  const appsApdex = appsSemLugar.current.chave === chaveSemLugarApps ? appsSemLugar.current.apps : apps;
  const chaveApps = appsApdex.map((a) => `${a.id}:${a.canal}`).sort().join(",");
  useEffect(() => {
    if (tela !== "inicio" || !fonte || appsApdex.length === 0) return;
    let vivo = true;
    const jan = janelaApdex ?? janela;
    const escopo = escopoApdex(appsApdex, app, TODAS, []);
    const chave = `apdex|${app}|${jan}|${segApdex}|${resumoChave(chaveApps)}`;
    const mob = escopoApdexMobile(appsApdex, app, TODAS);
    const chaveMob = `apdex-mobile|${app}|${jan}|${segApdex}|${resumoChave(chaveApps)}`;
    setCarregandoApdex(true); setApdex(null); setApdexMobile(null); setApdexLugares([]);
    const forcar = forcarApdex.current; forcarApdex.current = false;
    // o trecho ao vivo da aba para os três leitores (o mesmo do grafo, se a janela for a mesma)
    let trApdex: TrechoAoVivo | null | undefined;
    const trecho = async () => { if (trApdex === undefined) { if (fonte === "agregados") await lerFimAgregados(); trApdex = fonte === "agregados" ? trechoDa(jan, "apdex/APX-00") : null; } return trApdex; };
    // lugar: os agregados por lugar (APX-04), pelas aplicações do escopo (web e mobile); cache próprio, mesma validade
    const idsLugar = (app === TODAS ? appsApdex : appsApdex.filter((a) => a.id === app)).map((a) => a.id);
    const chaveLug = `apdex-lugares|${app}|${jan}|${resumoChave(chaveApps)}`;
    const linhaLugar = (l: Record<string, unknown>): LinhaApdexLugar => ({ canal: texto(l.canal) === "mobile" ? "mobile" : "web", app: texto(l.app) ?? "", pais: texto(l.pais), regiao: texto(l.regiao), faixa: texto(l.faixa) ?? "frustrado", n: num(l.n) });
    const lerLugares = async (): Promise<LinhaApdexLugar[]> => {
      if (!idsLugar.length) return [];
      try {
        const hit = forcar ? null : await lerCache<LinhaApdexLugar[]>(chaveLug, TTL_PADRAO_MS);
        if (hit) return hit.dados;
        const lidoDesde = Date.now();
        const tr = await trecho();
        const ls = (await comTrecho(tr, (t) => dql(qApdexLugares(idsLugar, jan, t), { contexto: "apdex/APX-04", maxRecords: 3000 }), (x, l) => juntarLugares(x, l, idsLugar))).map(linhaLugar);
        gravarCache(chaveLug, ls, { desde: tr ? Math.min(lidoDesde, tr.lidoEm) : lidoDesde });
        return ls;
      } catch { return []; }
    };
    const lerWeb = async (): Promise<Apdex | null> => {
      try {
        const hit = forcar ? null : await lerCache<Apdex>(chave, TTL_PADRAO_MS);
        if (hit) return hit.dados;
        const nh = forcar ? null : await lerCache<ParApdex[]>("apdex-nomes", 3600000);
        const lidoDesde = Date.now();
        const pares = nh?.dados ?? (await dql(qApdexNomes(), { contexto: "apdex/APX-01", maxRecords: 2000 })).map(parApdex);
        if (!nh) gravarCache("apdex-nomes", pares, { desde: lidoDesde, validadeMs: 3600000 });
        const n = nomesDoEscopo(pares, escopo);
        const tr = consultarApdex(n, escopo) ? await trecho() : null;
        const comCarga = apdexComCarga();
        const linhas = consultarApdex(n, escopo) ? (await comTrecho(tr, (t) => dql(qApdex(n.nomes, jan, t), { contexto: "apdex/APX-02", maxRecords: 400 }), (x, l) => (comCarga ? juntarApdexCarga(x, l, n.nomes) : x))).map(linhaApdex) : [];
        const a = montarApdex(linhas, n, escopo);
        gravarCache(chave, a, { desde: tr ? Math.min(lidoDesde, tr.lidoEm) : lidoDesde });
        return a;
      } catch { return null; }
    };
    // mobile: só com app mobile no escopo; uma consulta (APX-03: agregados "amob" e a abertura pela métrica nativa), cache
    // próprio com a mesma validade
    const lerMobile = async (): Promise<ApdexMobile | null> => {
      if (!mob.apps.length) return null;
      try {
        const hit = forcar ? null : await lerCache<ApdexMobile>(chaveMob, TTL_PADRAO_MS);
        if (hit) return hit.dados;
        const lidoDesde = Date.now();
        const tr = await trecho(), so = sistemaDoSegmento();
        const ls = await comTrecho(tr, (t) => dql(qApdexMobile(mob.apps, mob.entidades, jan, t), { contexto: "apdex/APX-03", maxRecords: 1000 }), (x, l) => juntarApdexMobile(x, l, mob.apps, so));
        // sem medição no período: as medições de 7 dias dizem se é "sem medição agora" ou "a regra não grava nada" (1 h de cache)
        if (!ls.some((l) => l.linha === "base")) {
          const c7 = `apdex-mobile-7d|${resumoChave(mob.apps.join(","))}|${so ?? "-"}`;
          const hit7 = await lerCache<Record<string, unknown>[]>(c7, 3600000);
          const e7 = hit7?.dados ?? await dql(qApdexMobileEscopo7d(mob.apps, so), { contexto: "apdex/APX-03E", maxRecords: 1 });
          if (!hit7) gravarCache(c7, e7, { validadeMs: 3600000 });
          ls.push(...e7);
        }
        const m = montarApdexMobile(ls.map(linhaApdexMobile));
        gravarCache(chaveMob, m, { desde: tr ? Math.min(lidoDesde, tr.lidoEm) : lidoDesde });
        return m;
      } catch { return null; }
    };
    (async () => {
      try {
        const [a, m, lg] = await Promise.all([lerWeb(), lerMobile(), lerLugares()]);
        if (vivo) { setApdex(a); setApdexMobile(m); setApdexLugares(lg); }
      } finally { if (vivo) setCarregandoApdex(false); }
    })();
    return () => { vivo = false; setCarregandoApdex(false); };
  }, [tela, fonte, app, janela, janelaApdex, segApdex, atualizacao, chaveApps]);   // eslint-disable-line react-hooks/exhaustive-deps
  const apdexNaTela = useMemo(() => (apdex ? { ...apdex, ignorados: apdexIgnorados() } : null), [apdex, segmento]);   // eslint-disable-line react-hooks/exhaustive-deps
  // Oportunidades de melhoria: as jornadas salvas do escopo com o funil que o FUN-T já leu (sem consulta a mais)
  const jornadasOp = useMemo<JornadaOp[]>(() => jornadas
    .filter((j) => j.passos.length > 0 && funis[j.id] && (app === TODAS || j.passos.some((p) => p.app === app)))
    .map((j) => ({ nome: j.nome, passos: j.passos.map((p) => ({ app: p.app, view: p.view })), funil: funis[j.id]! })), [jornadas, funis, app]);

  // clique num lugar dos mapas da visão geral: aplica o filtro de país/região; o mesmo lugar de novo (ou null) tira.
  // Custa como trocar o filtro no menu: a visão geral relê aquele recorte (fica no cache de 5 min, compartilhado).
  const filtrarLugar = (f: { pais: string; regiao?: string } | null) => setSegmento((s) => {
    const mesmo = !!f && s.pais === f.pais && (s.regiao ?? undefined) === (f.regiao ?? undefined);
    return !f || mesmo ? { ...s, pais: undefined, regiao: undefined } : { ...s, pais: f.pais, regiao: f.regiao };
  });
  const chaveLugaresAtual = `inicio2|${app}|${janela}|${robos}|q${quadros ? 1 : 0}|${passosEmUso() ?? "-"}|${chaveSegmentoDe({ ...segmento, pais: undefined, regiao: undefined })}`;
  // só junto de números lidos até 5 min antes ou depois (a validade do cache): sem isso, os mapas mostram só o lugar filtrado
  const lugaresSemFiltro = (segmento.pais || segmento.regiao) && inicio && lugaresBase?.chave === chaveLugaresAtual
    && Math.abs(inicio.geradoEm - lugaresBase.geradoEm) <= TTL_PADRAO_MS ? lugaresBase.lugares : null;

  const grafoBase = useMemo(() => montarGrafo({ apps: appsTela, arestas: visiveis.arestas, views: visiveis.views, backend: visiveis.backend, servicos: visiveis.servicos, chamadas: visiveis.chamadas, paginas: visiveis.paginas, pctMinimo }), [appsTela, visiveis, pctMinimo]);
  // "Analisar com LLM" (app/api/analise-llm.function.ts): a coleta dos dossiês de evidências das
  // oportunidades na ordem da tela (lib/dossie.ts, sob demanda, com a identidade de quem pede) e a regra de uso pelo status;
  // as chamadas da função (oportunidades em paralelo e síntese) ficam em lib/llmCliente.ts. Só para a lista de
  // liberados: a função decide pelo status e nenhuma política de acesso libera para outros; precisa
  // da lista de conexões externas do AppEngine e da chave no pacote da função (docs/llm.md)
  const llm = useMemo<FabricaLlm | null>(() => {
    if (!inicio) return null;
    const dadosInicio = inicio;
    const versaoApp = (() => { try { return getAppVersion(); } catch { return null; } })();
    return {
      coletar: async ({ oportunidades, jornadas: js, chamadas: ch }, aoProgresso) => {
        const { from, to } = intervaloDe(janela, dadosInicio.geradoEm);
        // o custo das leituras pelo preço de consulta em uso (Configuração > Consumo do app: o de lista ou o do contrato)
        const tarifaRsPorGiB = precosEfetivos(await lerPrecos()).consulta;
        return coletarDossies({ orcamento: { tarifaRsPorGiB },
          oportunidades, inicio: dadosInicio, apps: apps.map((a) => ({ id: a.id, nome: a.nome, canal: a.canal })), periodo: { de: from, ate: to, rotulo: textoPeriodo(dadosInicio.geradoEm, janela) },
          escopo: app === TODAS ? t("Todas as aplicações", "All applications") : apps.find((a) => a.id === app)?.nome ?? app, robos, chamadas: ch, jornadas: js, idioma, versaoApp, aoProgresso,
        });
      },
      statusLlm: () => statusLlm(idioma),
      idioma,
    };
  }, [inicio, janela, robos, apps, app, idioma]);   // eslint-disable-line react-hooks/exhaustive-deps
  const noIsolado = isolado ? grafoBase.nos.find((n) => n.id === isolado.id) ?? null : null;
  const chaveIsolado = noIsolado ? `${noIsolado.id}|${janela}|${robos}|${passosEmUso() ?? "-"}|${chaveSegmento()}` : null;
  // números por sessão: grafo remontado só com as navegações das sessões que passaram pelo nó (quando a consulta já voltou)
  const grafoSessao = useMemo(() => (fluxoIsolado && chaveIsolado && fluxoIsolado.chave === chaveIsolado
    ? montarGrafo({ apps: appsTela, arestas: fluxoIsolado.arestas, views: visiveis.views, backend: visiveis.backend, servicos: visiveis.servicos, chamadas: visiveis.chamadas, paginas: visiveis.paginas, pctMinimo })
    : null), [fluxoIsolado, chaveIsolado, appsTela, dados, pctMinimo]);
  // carregamento de canal grande: só o caminho dominante (isolar e "mostrar tudo" ignoram o limite)
  const dominante = useMemo(() => caminhoDominante(grafoBase, mostrarTudo ? Infinity : LIMITE_PAGINAS), [grafoBase, mostrarTudo]);
  const grafoRecorte = useMemo(() => (isolado ? isolarGrafo(grafoSessao ?? grafoBase, isolado.id, isolado.niveis) : dominante.grafo), [isolado, grafoSessao, grafoBase, dominante]);
  const grafo = useMemo(() => ocultarTipos(grafoRecorte, ocultos), [grafoRecorte, ocultos]);
  const contagens = useMemo(() => ({ servico: grafoRecorte.nos.filter((n) => n.tipo === "servico").length, banco: grafoRecorte.nos.filter((n) => n.tipo === "banco").length }), [grafoRecorte]);
  const fonteIsolado: "sessoes" | "trafego" | "carregando" = grafoSessao ? "sessoes" : carregandoIsolado ? "carregando" : "trafego";
  const janelaIsolar = limitarJanelaFiltro(janela, true), isolarUltimaHora = janelaIsolar !== janela;

  // consulta por sessão do nó isolado (só páginas, e só quando o Grail está barato ou foi autorizado)
  useEffect(() => {
    if (!noIsolado || noIsolado.tipo !== "view" || !noIsolado.app || !passosEmUso()) return;
    if (fluxoIsolado && fluxoIsolado.chave === chaveIsolado) return;
    let vivo = true;
    setCarregandoIsolado(true);
    // cache compartilhado de 5 min (lib/compartilhado.ts); texto e chave montados agora, com o filtro de agora. Ligações e
    // sessões numa leitura (ISO-U, lib/juntas.ts)
    // 1.46.3: em período maior que 1 hora, as sessões que passaram pela página são as da última hora (24 h liam bem mais
    // por uso); o painel e a barra dizem
    const ler = planoIsolar(noIsolado.app, noIsolado.nome, janelaIsolar, robos);
    const escopoIso = chaveBloco(noIsolado.app, noIsolado.nome, janelaIsolar, robos);
    (async () => {
      try {
        const b = await lerCompartilhado("isolar", escopoIso, () => ler(),
          { desistir: () => !vivo, aceitar: (x) => listas(x[0], x[1]) });
        if (!vivo || !b) return;
        const [a, sess] = b.dados;
        const arestas = a.map((l) => ({ app: texto(l.app) ?? "", de: texto(l.de), para: texto(l.para) ?? "", tipo: texto(l.tipo), n: num(l.n), sessoes: num(l.sessoes) }));
        setFluxoIsolado({ id: noIsolado.id, chave: chaveIsolado!, arestas, sessoes: num(sess[0]?.sessoes) });
        deCache("isolar", b.deCache ? b.desde : null);
      } catch (e) { if (vivo) setErro(e instanceof Error ? e.message : String(e)); }
      finally { if (vivo) setCarregandoIsolado(false); }
    })();
    return () => { vivo = false; };
  }, [noIsolado?.id, noIsolado?.tipo, noIsolado?.app, noIsolado?.nome, chaveIsolado, fluxoIsolado, janela, robos, fonte]);   // eslint-disable-line react-hooks/exhaustive-deps

  // rótulo "dados de hh:mm" (DadosDe, ao lado do Atualizar): os blocos do App na tela que vieram do cache compartilhado
  useEffect(() => {
    const naVisao = tela === "inicio" && !telaConfig && !telaSobre, noFlow = tela === "fluxo" && !telaConfig && !telaSobre;
    marcarNaTela("app:inicio", naVisao ? desdeCache.inicio ?? null : null);
    marcarNaTela("app:base", naVisao || noFlow ? desdeCache.base ?? null : null);
    marcarNaTela("app:backend", noFlow && dados.comBackend ? desdeCache.backend ?? null : null);
    marcarNaTela("app:qualidade", naVisao || noFlow ? desdeCache.qualidade ?? null : null);
    marcarNaTela("app:isolar", noFlow && !!grafoSessao ? desdeCache.isolar ?? null : null);
  }, [tela, telaConfig, telaSobre, desdeCache, dados.comBackend, grafoSessao]);

  const alternarIsolado = (id: string) => {
    setIsolado((atual) => (atual?.id === id ? null : { id, niveis: atual?.niveis ?? "tudo" }));
    setVersaoReposicionar((v) => v + 1);
  };
  const sairIsolado = () => { if (isolado) { setIsolado(null); setVersaoReposicionar((v) => v + 1); } };
  useEffect(() => {
    if (!isolado) return;
    const aoTecla = (ev: KeyboardEvent) => { if (ev.key === "Escape") sairIsolado(); };
    window.addEventListener("keydown", aoTecla);
    return () => window.removeEventListener("keydown", aoTecla);
  }, [isolado]);   // eslint-disable-line react-hooks/exhaustive-deps
  const no = selecionado ? grafo.nos.find((n) => n.id === selecionado) ?? null : null;
  // Flow aberto esperando o backend: o painel diz "carregando" em vez de "sem backend". aguardandoNo = o nó escolhido é
  // um serviço ou banco que só chega com o backend (páginas e aplicações têm "|" no id e já estão no grafo)
  // aviso do backend na tela: some durante a recarga (o grafo na tela é do escopo anterior)
  const avisoTela = !erro && !carregando && avisoBackend && dados.comBackend && dados.arestas.length > 0 ? avisoBackend : null;
  // 1.45.9: aplicação habilitada sem nenhuma navegação no período (não aparece no grafo): o aviso diz qual. O nome sai do
  // grafo ou, para a que não está nele, do modelo de entidades (nomesHabilitadas, consulta de entidade: R$ 0). Fecha por escopo.
  const [avisoColetaFechado, setAvisoColetaFechado] = useState<string | null>(null);
  const [nomesHabilitadas, setNomesHabilitadas] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    if (!habilitadas?.size) return;
    let vivo = true;
    (async () => {
      try {
        const ents = await entidadesHabilitadas(habilitadas);
        const q = qNomesEntidades([...ents.values()]);
        if (!q) return;
        const ls = await dql(q, { contexto: "base/BAS-13", maxRecords: 500 });
        const porEntidade = new Map(ls.map((l) => [texto(l.id) ?? "", texto(l.nome) ?? ""]));
        if (vivo) setNomesHabilitadas(new Map([...ents].map(([id, e]) => [id, porEntidade.get(e) ?? ""]).filter(([, n]) => !!n) as [string, string][]));
      } catch { /* sem os nomes, o aviso diz só quantas */ }
    })();
    return () => { vivo = false; };
  }, [habilitadas]);
  const semColeta = useMemo(() => {
    if (tela !== "fluxo" || carregando || erro || !habilitadas?.size) return null;
    const comNav = new Set(visiveis.arestas.filter((a) => a.n > 0).map((a) => a.app));
    const ids0 = [...habilitadas].filter((id) => (app === TODAS || id === app) && !comNav.has(id));
    if (!ids0.length) return null;
    const apps0 = ids0.map((id) => appsTela.find((a) => a.id === id)?.nome || nomesHabilitadas.get(id)).filter((n): n is string => !!n);
    return { apps: apps0, total: ids0.length, chave: `${dados.escopo?.chave ?? ""}|${ids0.join(",")}` };
  }, [tela, carregando, erro, visiveis.arestas, appsTela, dados.escopo?.chave, habilitadas, nomesHabilitadas, app]);
  const backendPendente = (tela === "fluxo" && dados.arestas.length > 0 && !dados.comBackend && !erro)
    || (tela === "fluxo" && !erro && carregando && !!avisoBackend && dados.comBackend);
  const aguardandoNo = !!selecionado && !no && backendPendente && !selecionado.includes("|");
  // backend carregou com falha (aviso no grafo): o painel diz que não carregou, em vez de "nenhuma ligação"
  const backendFalhou = avisoTela ? avisoTela.tipo : null;
  const jornada = jornadas.find((j) => j.id === jornadaAtiva) ?? null;
  // destaque clicado no painel (laço com erro, abandono...): acende só aquele trecho; a jornada ativa tem prioridade
  const [destaqueAtivo, setDestaqueAtivo] = useState<Destaque | null>(null);
  useEffect(() => { setDestaqueAtivo(null); }, [app, janela]);
  const destaque = useMemo(() => (jornada ? nosDaJornada(jornada) : destaqueAtivo ? new Set(destaqueAtivo.nos) : null), [jornada, destaqueAtivo]);
  const destacar = (d: Destaque) => { setDestaqueAtivo(d); setSelecionado(d.foco); setPainelAberto(true); };
  const limparDestaque = () => { setDestaqueAtivo(null); setSelecionado(null); };
  const ordemJornada = useMemo(() => (jornada ? new Map(jornada.passos.map((p, i) => [idView(p.app, p.view), i])) : null), [jornada]);
  const entidades = useMemo(() => new Map(apps.filter((a) => a.entidade).map((a) => [a.id, a.entidade!])), [apps]);
  const qtdSegmento = Object.values(segmento).filter(Boolean).length;

  const aoClicarNo = (id: string | null) => {
    if (modoSelecao) { if (id) setSelecao((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id])); return; }
    setSelecionado(id);                                              // como no Smartscape: o clique abre o menu; "Open details" abre o painel
  };
  const abrirDetalhes = (id: string) => { setSelecionado(id); setPainelAberto(true); };
  const iniciarSelecao = () => { setModoSelecao(true); setSelecao([]); setSelecionado(null); setJornadaAtiva(null); setEditando(null); };
  const cancelarSelecao = () => { setModoSelecao(false); setSelecao([]); setEditando(null); };
  // editar: reabre o compositor com as páginas e serviços da jornada já marcados; salvar grava por cima (mesmo id)
  const editarJornada = (j: Jornada) => {
    setEditando(j.id); setModoSelecao(true); setSelecionado(null); setJornadaAtiva(null);
    setSelecao([...j.passos.map((p) => idView(p.app, p.view)), ...j.servicos]);
  };
  const salvarJornada = async (nome: string) => {
    const base = jornadaDaSelecao(nome, selecao, grafo);
    const original = editando ? jornadas.find((j) => j.id === editando) : null;
    const nova = original ? { ...base, id: original.id, criadaEm: original.criadaEm } : base;
    const lista = original ? jornadas.map((j) => (j.id === original.id ? nova : j)) : [...jornadas, nova];
    setJornadas(lista); setModoSelecao(false); setSelecao([]); setEditando(null); setJornadaAtiva(nova.id); setSelecionado(null);
    setArmazenamento(await salvarJornadas(lista));
  };
  const excluirJornada = async (id: string) => {
    const j = jornadas.find((x) => x.id === id);
    if (!j || !window.confirm(t(`Excluir a jornada "${j.nome}"?`, `Delete the journey "${j.nome}"?`))) return;
    const lista = jornadas.filter((x) => x.id !== id);
    setJornadas(lista); if (jornadaAtiva === id) setJornadaAtiva(null);
    setArmazenamento(await salvarJornadas(lista));
  };
  const abrirFluxo = () => { setTela("fluxo"); setTelaConfig(false); setTelaSobre(false); };
  const destacarNoFluxo = (d: Destaque) => { destacar(d); abrirFluxo(); };
  // aba do painel ao abrir uma página vinda da visão geral (ex.: Erros, quando a etapa do fluxo teve erro)
  const [abaDetalhe, setAbaDetalhe] = useState<{ id: string; aba: AbaPagina } | null>(null);
  const abrirPaginaNoFluxo = (appPagina: string, view: string, aba?: AbaPagina) => {
    const id = idView(appPagina, view);
    setAbaDetalhe(aba ? { id, aba } : null); setSelecionado(id); setPainelAberto(true); abrirFluxo();
  };

  // barra de escopo (aplicação, filtro, período, refresh) e menu de filtros: os mesmos no Overview e no Flow
  const controlesEscopo = (
    <>
      <label className="sc-barra-campo" title={t("Aplicação", "Application")}>
        <ApplicationsIcon size={16} />
        <select value={app} onChange={(e) => { setApp(e.target.value); setSelecionado(null); }} aria-label={t("Aplicação", "Application")}>
          <option value={TODAS}>{t("Todas as aplicações", "All applications")}</option>
          {apps.map((a) => <option key={a.id} value={a.id}>{a.nome}</option>)}
        </select>
      </label>
      {passosEmUso() && <>
        <span className="sc-barra-separador" />
        <button className={`sc-barra-botao${filtroAberto || qtdSegmento > 0 ? " ativo" : ""}`} onClick={() => setFiltroAberto((v) => !v)}
                title={t("Filtrar por sistema operacional, navegador, versão do app, país e região", "Filter by operating system, browser, app version, country and region")} aria-label={t("Filtro", "Filter")} aria-expanded={filtroAberto}>
          <FilterIcon size={18} />{qtdSegmento > 0 && <span className="sc-contador">{qtdSegmento}</span>}
        </button>
      </>}
      <span className="sc-barra-separador" />
      <label className="sc-barra-campo" title={t("Período", "Timeframe")}>
        <ClockIcon size={16} />
        <select value={janelaEscolhida} onChange={(e) => setJanela(e.target.value)} aria-label={t("Período", "Timeframe")}>
          {JANELAS.map((j) => <option key={j.valor} value={j.valor}>{t(j.pt, j.en)}</option>)}
        </select>
      </label>
      {janelaLimitada && <span className="sc-aviso-periodo" title={t("Com filtro, sessões de robôs ou frames, os números saem dos eventos de cada sessão, e não dos totais já somados: o período vai até a última hora. Sem eles, vale o período escolhido.", "With a filter, robot sessions or frames, numbers come from each session's events, not from the totals already added up: the timeframe goes up to the last hour. Without them, the chosen timeframe applies.")}>{t("com filtro: última hora", "with filter: last hour")}</span>}
      <span className="sc-barra-separador" />
      <button className="sc-barra-botao" onClick={atualizar} disabled={carregando || carregandoInicio || carregandoBackend} title={t("Atualizar: ler os dados de novo agora (reaproveita o que foi lido no último minuto)", "Refresh: read the data again now (reuses what was read in the last minute)")} aria-label={t("Atualizar", "Refresh")}>
        <RefreshIcon size={18} className={carregando || carregandoInicio || carregandoBackend ? "girando" : ""} />
      </button>
      <DadosDe />
    </>
  );
  const menuFiltro = filtroAberto && passosEmUso() && (
    <div className="sc-filtro-menu" role="dialog" aria-label={t("Filtros", "Filters")}>
      <h3>{t("Filtro", "Filter")}</h3>
      <div className="segmento">
        {FILTROS_SEGMENTO.map(({ chave, rotulo }) => {
          const atual = segmento[chave] ?? "";
          const opcoes = [...new Set([...(valoresSegmento?.[chave] ?? []), ...(atual ? [atual] : [])])].sort();
          return (
            <label key={chave} className="segmento-campo">
              <span>{t(rotulo[0], rotulo[1])}</span>
              <select value={atual} disabled={opcoes.length === 0} onChange={(e) => setSegmento({ ...segmento, [chave]: e.target.value || undefined })}>
                <option value="">{opcoes.length === 0 ? t("Sem dados", "No data") : t("Todos", "All")}</option>
                {opcoes.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </label>
          );
        })}
        {qtdSegmento > 0 && <button className="botao-leve" onClick={() => setSegmento({})}>{t("Limpar filtros", "Clear filters")}</button>}
      </div>
    </div>
  );

  return (
    <div className="app">
      <header className="cabecalho">
        <div className="marca">
          <span className="marca-icone" aria-hidden="true"><MarcaIcone /></span>
          <h1>Digital Experience Flow</h1>
          {ehPreview && <span className="selo-preview" title={t("Versão de testes com as novidades (id com .preview)", "Test version with the new features (id ending in .preview)")}>Preview</span>}
        </div>
        <nav className="topo-abas" aria-label={t("Telas", "Views")}>
          <button className={tela === "inicio" && !telaConfig && !telaSobre ? "ativa" : ""} onClick={() => { setTela("inicio"); setTelaConfig(false); setTelaSobre(false); }}>{t("Visão geral", "Overview")}</button>
          <button className={tela === "fluxo" && !telaConfig && !telaSobre ? "ativa" : ""} onClick={abrirFluxo}>Flow</button>
          <button className={telaSobre && !telaConfig ? "ativa" : ""} onClick={() => { setTelaSobre(true); setTelaConfig(false); }}>{t("Documentação", "Documentation")}</button>
        </nav>
        {/* só o estado de "isolar" fica no cabeçalho; o nome da aplicação e as contagens saíram por decisão de produto */}
        {isolado && noIsolado && <div className="sub">{t("Isolado", "Isolated")}: <b>{noIsolado.nome}</b>{fonteIsolado === "sessoes" && fluxoIsolado ? t(` · ${formatarInt(fluxoIsolado.sessoes)} sessões passaram aqui${isolarUltimaHora ? " na última hora" : ""}`, ` · ${formatarInt(fluxoIsolado.sessoes)} sessions went through here${isolarUltimaHora ? " in the last hour" : ""}`) : ""}</div>}
        <div className="controles">
          {(carregando || carregandoBackend) && <span className="carregando">{t("atualizando…", "updating…")}</span>}
          <div className="idioma" role="group" aria-label={t("Idioma", "Language")}>
            <button className={idioma === "pt" ? "ativo" : ""} onClick={() => mudarIdioma("pt")} aria-pressed={idioma === "pt"} title="Português">PT</button>
            <button className={idioma === "en" ? "ativo" : ""} onClick={() => mudarIdioma("en")} aria-pressed={idioma === "en"} title="English">EN</button>
          </div>
          <button className={`botao-icone${telaSobre && subDocs === "sobre" ? " ativo" : ""}`} onClick={() => { if (telaSobre && subDocs === "sobre") { setTelaSobre(false); } else { setSubDocs("sobre"); setTelaSobre(true); setTelaConfig(false); } }} title={t("Sobre o Digital Experience Flow", "About Digital Experience Flow")} aria-label={t("Sobre", "About")}>
            <InformationIcon />
          </button>
          {admin && (
            <button className={`botao-icone${telaConfig ? " ativo" : ""}`} onClick={() => { setTelaConfig((v) => !v); setTelaSobre(false); }} title={t("Configuração do tenant (administradores)", "Tenant configuration (administrators)")} aria-label={t("Configuração", "Configuration")}>
              <SettingIcon />
            </button>
          )}
        </div>
      </header>
      {telaConfig && admin && <ConfigPanel aoFechar={() => setTelaConfig(false)} aoAplicar={(ids) => setHabilitadas(new Set(ids))} />}
      {telaSobre && !telaConfig && <DocsPanel aba={subDocs} aoMudar={setSubDocs} aoAbrirConfig={admin ? () => { setTelaSobre(false); setTelaConfig(true); } : undefined} />}
      {!telaConfig && !telaSobre && preReq.agregados === false && preReq.bucket === false && (
        <div className="prereq alerta" role="alert">
          <span>{t("O Digital Experience Flow ainda não está configurado neste ambiente: falta a cópia das sessões e o workflow de agregação.", "Digital Experience Flow is not configured in this environment yet: the session copy and the aggregation workflow are missing.")}</span>
          {admin && <button className="botao-leve" onClick={() => { setTelaConfig(true); setTelaSobre(false); }}>{t("Abrir a Configuração", "Open the Configuration")}</button>}
        </div>
      )}
      {!telaConfig && !telaSobre && tela === "inicio" && (
        <div className="inicio-area">
          <Inicio lerLentas={lerLentasVG} assist={assistLigado} apps={appsTela} app={app} todas={TODAS} janela={janela} robos={robos} versao={atualizacao} barra={controlesEscopo} dados={inicio} carregando={carregandoInicio || (!fonte && preReq.bucket !== false)} erro={erroInicio}
                  semCopia={preReq.bucket === false} grafo={grafoBase} qualidade={qualidade} aoEscolherApp={(id) => { setApp(id); setSelecionado(null); }}
                  aoAbrirFluxo={abrirFluxo} aoDestacar={destacarNoFluxo} aoAbrirPagina={abrirPaginaNoFluxo}
                  apdex={apdexNaTela} apdexMobile={apdexMobile} carregandoApdex={carregandoApdex} appsApdex={appsApdex} janelaApdex={janelaApdex ?? janela} aoTrocarJanelaApdex={setJanelaApdex}
                  filtroLugar={{ pais: segmento.pais, regiao: segmento.regiao }} lugaresBase={lugaresSemFiltro} apdexLugares={apdexLugares} aoFiltrarLugar={filtrarLugar}
                  jornadas={jornadasOp} chamadas={chamadasOp.chamadas} terceiros={chamadasOp.terceiros} llm={llm} />
          {menuFiltro}
        </div>
      )}
      {!telaConfig && !telaSobre && tela === "fluxo" && <JourneyBar jornadas={jornadas} funis={funis} ativa={jornadaAtiva} aoAtivar={(id) => { setJornadaAtiva(id); setSelecionado(null); if (id) setPainelAberto(true); }}
                  modoSelecao={modoSelecao} selecao={selecao} grafo={grafo} aoIniciar={iniciarSelecao} aoCancelar={cancelarSelecao} aoSalvar={salvarJornada} armazenamento={armazenamento}
                  editando={editando ? jornadas.find((j) => j.id === editando) ?? null : null} aoMudarSelecao={setSelecao} />}
      {!telaConfig && !telaSobre && tela === "fluxo" && <div className="corpo">
        <main className="area-grafo">
          <ControlPanel grafo={grafo} modo={modo} aoMudarModo={setModo} pctMinimo={pctMinimo} aoMudarPctMinimo={setPctMinimo}
                        robos={robos} aoMudarRobos={setRobos} quadros={quadros} aoMudarQuadros={setQuadros} busca={busca} aoMudarBusca={setBusca}
                        soHabilitadas={soHabilitadas} aoMudarSoHabilitadas={habilitadas ? setSoHabilitadas : undefined}
                        isolado={isolado && noIsolado ? { nome: noIsolado.nome, niveis: isolado.niveis, fonte: fonteIsolado, sessoes: fluxoIsolado?.sessoes ?? null, ultimaHora: isolarUltimaHora } : null}
                        aoMudarNiveis={(n) => { setIsolado((a) => (a ? { ...a, niveis: n } : a)); setVersaoReposicionar((v) => v + 1); }} aoSairIsolado={sairIsolado}
                        ocultos={ocultos} aoMudarOcultos={(o) => { setOcultos(o); setVersaoReposicionar((v) => v + 1); }} contagens={contagens}
                        dominante={!isolado && (dominante.limitado || mostrarTudo) ? { porApp: caminhoDominante(grafoBase, LIMITE_PAGINAS).porApp.filter((x) => x.total > LIMITE_PAGINAS), mostrarTudo } : null}
                        aoMostrarTudo={(v) => { setMostrarTudo(v); setVersaoReposicionar((x) => x + 1); }}
                        realce={realce} aoMudarRealce={setRealce} selecionado={selecionado} aoSelecionarNo={(id) => setSelecionado(id)} />
          <div className="sc-barra-superior" role="toolbar" aria-label={t("Escopo do fluxo", "Flow scope")}>{controlesEscopo}
            {(contagens.servico > 0 || contagens.banco > 0) && <>
              <span className="sc-barra-separador" />
              <button className={`sc-barra-botao texto${ocultos.has("servico") ? "" : " ativo"}`} onClick={() => { const o = new Set(ocultos); if (o.has("servico")) { o.delete("servico"); o.delete("banco"); } else o.add("servico"); setOcultos(o); setVersaoReposicionar((v) => v + 1); }}
                      title={ocultos.has("servico") ? t(`Mostrar os ${formatarInt(contagens.servico + contagens.banco)} serviços e bancos do backend no grafo; o vermelho marca os que tiveram requisições com falha`, `Show the ${formatarInt(contagens.servico + contagens.banco)} backend services and databases in the graph; red marks the ones with failed requests`) : t("Esconder o backend do grafo", "Hide the backend from the graph")}>
                {ocultos.has("servico") ? t("+ Backend", "+ Backend") : t("− Backend", "− Backend")}
              </button>
            </>}
          </div>
          {menuFiltro}
          {erro ? (semPermissao(erro)
              ? <div className="estado erro" title={erro}>{t(`Sem permissão para ler os dados do grafo (${permissaoNegada(erro, "storage:entities:read")}): o Flow não carregou. A Visão geral continua funcionando. Peça a permissão ao administrador do Dynatrace; depois de liberada, clique em Atualizar.`,
                  `No permission to read the graph data (${permissaoNegada(erro, "storage:entities:read")}): the Flow did not load. The Overview still works. Ask your Dynatrace administrator for the permission; once granted, click Refresh.`)}</div>
              : <div className="estado erro">{t("Erro", "Error")}: {erro}</div>)
            : !fonte ? <div className="estado">{preReq.agregados === null ? t("Conferindo os pré-requisitos…", "Checking prerequisites…") : t("O Digital Experience Flow ainda não está configurado neste ambiente.", "Digital Experience Flow is not configured in this environment yet.")}</div>
            : carregando && dados.arestas.length === 0 ? <div className="estado">{fonte === "agregados" ? t("Somando as fatias de 5 minutos…", "Adding up the 5-minute slices…") : t("Lendo a cópia das sessões…", "Reading the session copy…")}</div>
            : dados.arestas.length === 0 ? <div className="estado">{t("Nenhuma navegação neste período para a aplicação escolhida.", "No navigation in this timeframe for the selected application.")}</div>
            : !dados.comBackend ? <div className="estado">{t("Ligando as páginas aos serviços do backend…", "Linking pages to backend services…")}</div>
            : <FlowGraph grafo={grafo} modo={modo} busca={busca} versaoReposicionar={versaoReposicionar} selecionado={selecionado} aoSelecionar={aoClicarNo}
                         aoAbrirDetalhes={abrirDetalhes} aoIsolar={alternarIsolado} isoladoId={isolado?.id ?? null} aoReposicionar={() => setVersaoReposicionar((v) => v + 1)}
                         entidades={entidades} realceTipo={realce}
                         destaque={destaque} ordemJornada={ordemJornada} selecao={modoSelecao ? selecao : null} modoSelecao={modoSelecao} />}
          <div className="avisos-grafo">
            {destaqueAtivo && !jornada && (
              <div className={`destaque-chip${destaqueAtivo.impacto ? " impacto" : ""}`} role="status">
                <span className="dp-destaque-ponto" aria-hidden="true" /><b>{destaqueAtivo.titulo}</b><span className="destaque-chip-detalhe">{destaqueAtivo.detalhe}</span>
                <button className="painel-link" onClick={limparDestaque} title={t("Mostrar o fluxo inteiro de novo", "Show the whole flow again")}>{t("Limpar", "Clear")}</button>
              </div>
            )}
            {avisoTela && (
              <div className="aviso-backend" title={avisoTela.msg}>{textoAvisoBackend(avisoTela, dados.escopo?.janela ?? janela)}</div>
            )}
            {semColeta && avisoColetaFechado !== semColeta.chave && (() => {
              const NO_PERIODO: Record<string, [string, string]> = { "10m": ["nos últimos 10 minutos", "in the last 10 minutes"], "30m": ["nos últimos 30 minutos", "in the last 30 minutes"],
                "60m": ["na última hora", "in the last hour"], "24h": ["nas últimas 24 horas", "in the last 24 hours"], "7d": ["nos últimos 7 dias", "in the last 7 days"] };
              const [pt, en] = NO_PERIODO[janela] ?? ["no período escolhido", "in the chosen timeframe"];
              return (
                <div className="aviso-coleta" role="status">
                  <InformationIcon size={16} />
                  <span>{semColeta.apps.length ? <>{t(`Sem coleta ${pt}: `, `No data collected ${en}: `)}<b>{semColeta.apps.join(", ")}</b>. </> : t(`Sem coleta ${pt} em ${semColeta.total} aplicação(ões) habilitada(s). `, `No data collected ${en} in ${semColeta.total} enabled application(s). `)}{t("O grafo mostra só o que teve navegação no período.",
                    "The graph shows only what had navigation in the timeframe.")}</span>
                  <button className="aviso-coleta-fechar" onClick={() => setAvisoColetaFechado(semColeta.chave)} title={t("Fechar o aviso", "Close the notice")} aria-label={t("Fechar", "Close")}>×</button>
                </div>
              );
            })()}
          </div>
          <button className={`painel-alternar${painelAberto ? "" : " fechado"}`} onClick={() => setPainelAberto((v) => !v)}
                  title={painelAberto ? t("Esconder o painel de detalhes", "Hide the details panel") : t("Mostrar o painel de detalhes", "Show the details panel")} aria-label={painelAberto ? t("Esconder o painel", "Hide panel") : t("Mostrar o painel", "Show panel")}>
            <span aria-hidden="true">{painelAberto ? "›" : "‹"}</span>
          </button>
        </main>
        {!painelAberto ? null : jornada && !no && !aguardandoNo
          ? <JourneyPanel jornada={jornada} funil={funis[jornada.id]} erroFunil={erroFunil} grafo={grafo} apps={apps} janela={janela} robos={robos} aoSelecionarNo={setSelecionado}
                          aoExcluir={() => excluirJornada(jornada.id)} aoFechar={() => setJornadaAtiva(null)} aoEditar={() => editarJornada(jornada)}
                          funilRecente={(q) => funilRecente(jornada, q)} aoFunilDoDrill={(linha, desde) => funilDoDrill(jornada, linha, desde)}
                          backendPendente={backendPendente} backendFalhou={backendFalhou} />
          : <DetailPanel quadros={dados.quadros} abaInicial={abaDetalhe} janela={janela} robos={robos} grafo={grafo} apps={apps} no={no} aoSelecionar={setSelecionado} aoIsolar={alternarIsolado} isoladoId={isolado?.id ?? null} versao={atualizacao} aoDestacar={destacar} destaqueAtivo={destaqueAtivo?.id ?? null} qualidade={qualidade}
                          backendPendente={backendPendente} aguardandoNo={aguardandoNo} backendFalhou={backendFalhou} baseFalhou={!!erro} />}
      </div>}
    </div>
  );
};

const FILTROS_SEGMENTO: { chave: keyof Segmento; rotulo: [string, string] }[] = [
  { chave: "os", rotulo: ["Sistema operacional", "Operating system"] }, { chave: "navegador", rotulo: ["Navegador", "Browser"] }, { chave: "versao", rotulo: ["Versão do app", "App version"] },
  { chave: "pais", rotulo: ["País", "Country"] }, { chave: "regiao", rotulo: ["Região", "Region"] },
];
