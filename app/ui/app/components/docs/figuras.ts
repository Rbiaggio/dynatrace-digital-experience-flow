/* Manifesto das figuras da aba Documentação: prints de um laboratório (Banco Demo PF e PJ, tráfego simulado; nenhum dado
   de cliente), reduzidos a 1400 px de largura (JPEG) em ui/assets/docs/ (e, para os prints mais largos que isso, a versão
   em tamanho original em ui/assets/docs/grande/, aberta ao clicar na figura), que o dt-app copia para assets/ do app. As
   chaves são usadas pelas sub-abas (<Figura id="..." />); uma chave sem arquivo não renderiza nada. Prints da versão
   atual: o App inteiro fora da plataforma, com os dados do laboratório ao vivo e só leitura. Visão geral e Flow em
   "Última hora"; a análise por LLM com a coleta real no laboratório e o LLM simulado (aceite, progresso e resultado).
   FIGURAS_EN (1.47.10): os mesmos prints com a tela em inglês, em assets/docs/en/ (a documentação em inglês usa estes). */
export interface FiguraDoc { src: string; largura: number; altura: number; grande?: { src: string; largura: number; altura: number } }
/** URL do arquivo estático do app: assets/docs/<nome>, resolvida pela base do documento (o dt-app injeta o <base href>). */
const urlAsset = (nome: string) => { try { return new URL(`assets/docs/${nome}`, document.baseURI).toString(); } catch { return `assets/docs/${nome}`; } };
const f = (nome: string, largura: number, altura: number, grande?: [number, number]): FiguraDoc => ({ src: urlAsset(nome), largura, altura, ...(grande ? { grande: { src: urlAsset(`grande/${nome}`), largura: grande[0], altura: grande[1] } } : {}) });
export const FIGURAS: Record<string, FiguraDoc> = {
  "visao-geral": f("visao-geral.jpg", 1400, 2309, [2400, 3959]),
  "faixa-indicadores": f("faixa-indicadores.jpg", 1400, 84, [2384, 143]),
  "experiencia-apdex": f("experiencia-apdex.jpg", 685, 471),
  "mapas": f("mapas.jpg", 1400, 384, [1718, 471]),
  "aplicacoes": f("aplicacoes.jpg", 1400, 116, [2384, 198]),
  "afetando-clientes": f("afetando-clientes.jpg", 1400, 664, [2384, 1131]),
  "oportunidades": f("oportunidades.jpg", 1400, 264, [2384, 450]),
  "oportunidades-detalhes": f("oportunidades-detalhes.jpg", 1400, 332, [2384, 566]),
  "principais-fluxos": f("principais-fluxos.jpg", 1400, 667, [2384, 1135]),
  "paginas-mais-visitadas": f("paginas-mais-visitadas.jpg", 1400, 220, [2384, 374]),
  "lista-sessoes": f("lista-sessoes.jpg", 1400, 693, [2384, 1180]),
  "flow-grafo": f("flow-grafo.jpg", 1400, 758, [2400, 1300]),
  "flow-painel-pagina": f("flow-painel-pagina.jpg", 1400, 758, [2400, 1300]),
  "flow-jornada": f("flow-jornada.jpg", 1400, 758, [2400, 1300]),
  "configuracao": f("configuracao.jpg", 1400, 1152, [1600, 1317]),
  "llm-aceite": f("llm-aceite.jpg", 694, 757),
  "llm-progresso": f("llm-progresso.jpg", 1054, 372),
  "llm-resultado": f("llm-resultado.jpg", 1070, 1511),
};
/** Os prints da tela em inglês (1.47.10). */
export const FIGURAS_EN: Record<string, FiguraDoc> = {
  "visao-geral": f("en/visao-geral.jpg", 1400, 2309, [2400, 3958]),
  "faixa-indicadores": f("en/faixa-indicadores.jpg", 1400, 84, [2384, 143]),
  "experiencia-apdex": f("en/experiencia-apdex.jpg", 685, 471),
  "mapas": f("en/mapas.jpg", 1400, 384, [1718, 471]),
  "aplicacoes": f("en/aplicacoes.jpg", 1400, 116, [2384, 198]),
  "afetando-clientes": f("en/afetando-clientes.jpg", 1400, 664, [2384, 1131]),
  "oportunidades": f("en/oportunidades.jpg", 1400, 264, [2384, 449]),
  "oportunidades-detalhes": f("en/oportunidades-detalhes.jpg", 1400, 331, [2384, 564]),
  "principais-fluxos": f("en/principais-fluxos.jpg", 1400, 667, [2384, 1135]),
  "paginas-mais-visitadas": f("en/paginas-mais-visitadas.jpg", 1400, 220, [2384, 374]),
  "lista-sessoes": f("en/lista-sessoes.jpg", 1400, 693, [2384, 1180]),
  "flow-grafo": f("en/flow-grafo.jpg", 1400, 758, [2400, 1300]),
  "flow-painel-pagina": f("en/flow-painel-pagina.jpg", 1400, 758, [2400, 1300]),
  "flow-jornada": f("en/flow-jornada.jpg", 1400, 758, [2400, 1300]),
  "configuracao": f("en/configuracao.jpg", 1400, 1167, [1600, 1334]),
  "llm-aceite": f("en/llm-aceite.jpg", 694, 738),
  "llm-progresso": f("en/llm-progresso.jpg", 1054, 372),
  "llm-resultado": f("en/llm-resultado.jpg", 1070, 1491),
};
