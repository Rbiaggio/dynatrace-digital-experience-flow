/* Leitura compartilhada (etapa 3 do plano de DPS): cada escopo é lido do Grail uma vez a cada 5 min para todos os
   usuários e abas. Ordem de cada leitura:
   1) memória da aba (e a mesma leitura já em andamento nesta aba);
   2) App State (lib/cache.ts): a entrada do mesmo escopo e do mesmo perfil de acesso;
   3) marcador "andamento|<chave>" no App State: se outra aba já está lendo o mesmo escopo, espera o resultado dela em vez
      de ler de novo. É o padrão do lib/assistIA.ts, endurecido, porque o App State não tem gravação condicional: grava o
      próprio token, espera 300 ms, relê e só segue quem ficou com o token (a última gravação vence); quem lê bate o
      marcador a cada 15 s; marcador sem batida há 75 s é de aba morta ou adormecida (o navegador roda os timers de aba
      oculta uma vez por minuto); quem espera sonda o cache a 1, 2 e 4 s e depois a cada 5 s, por no máximo 330 s. O
      marcador só entra quando a última leitura do tipo passou de 1 GiB (scannedBytes): para leitura barata a espera não
      compensa. A última leitura de cada tipo fica na aba, no navegador e numa entrada do App State (custo-leituras, 24 h);
      sem nenhuma (o tipo não foi lido no ambiente nas últimas 24 h), o marcador entra;
   4) o tenant. Quem lê vai até o fim e grava mesmo que a tela tenha saído: a leitura já paga serve quem vier depois.
   O Atualizar fixa o "fim mínimo" da aba (marcarAtualizar): dali em diante só vale leitura começada até 1 min antes do clique.
   A chave leva o escopo inteiro (chaveBloco: aplicação, página, janela, robôs, cópia, frames, cliques por métrica e o
   filtro de segmento em ordem fixa) e o perfil de acesso: só quem tem as mesmas permissões de leitura do Grail, sem
   condição, reaproveita a leitura de outro usuário; com permissão condicional (bucket, registro ou campo) ou sem resposta,
   o cache é só daquele usuário. Guarda o resultado cru das consultas (linhas), nunca texto traduzido. */
import { lerCache, gravarCache, resumo, TTL_PADRAO_MS } from "./cache";
import { consumoDql, passosEmUso, chaveSegmento, quadrosEmUso } from "./dql";
import { effectivePermissionsClient } from "@dynatrace-sdk/client-platform-management-service";
import { getCurrentUserDetails } from "@dynatrace-sdk/app-environment";

/** O que é lido (o tipo dá a validade, o marcador e a conta de bytes). base, inicio e backend têm fluxo próprio no App e
    usam só esperarOuAssumir; os outros passam por lerCompartilhado. */
/** O Atualizar reaproveita o que foi lido há menos disto. */
export const REAPROVEITAR_ATUALIZAR_MS = 60_000;
export type TipoLeitura = "base" | "inicio" | "backend" | "valores" | "qualidade" | "painel" | "isolar" | "porque" | "sessoes" | "ondefalha" | "ia" | "funil" | "volume";
/** Funcionalidades do dt-client-context (lib/dql.ts) cujos bytes contam como leitura do tipo. Tipo sem nenhuma (volume
    dos serviços: métrica, R$ 0) não usa o marcador nem entra na conta de custo. */
const FUNCIONALIDADES: Record<TipoLeitura, string[]> = {
  base: ["base"], inicio: ["inicio"], backend: ["backend"], valores: ["filtros"], qualidade: ["qualidade"], painel: ["painel"],
  isolar: ["isolar"], porque: ["porque"], sessoes: ["sessoes"], ondefalha: ["ondefalha", "ia"], ia: ["ia"], funil: ["funil"], volume: [],
};

export interface ConfigCompartilhado {
  /** marcador só para o tipo cuja última leitura passou disto (scannedBytes) */
  limiarBytes: number;
  confirmarMs: number; batidaMs: number; mortoMs: number;
  /** instantes da sondagem de quem espera, contados do início da espera; depois do último, a cada sondagemMs */
  sondagensMs: number[]; sondagemMs: number; esperaMaxMs: number;
  /** validade do dado (5 min, como o cache da base, da Visão geral e do backend) */
  validadeMs: number;
  memoriaMax: number;
}
export const CONFIG_PADRAO: ConfigCompartilhado = {
  limiarBytes: 2 ** 30, confirmarMs: 300, batidaMs: 15_000, mortoMs: 75_000,
  sondagensMs: [1000, 2000, 4000], sondagemMs: 5000, esperaMaxMs: 330_000, validadeMs: TTL_PADRAO_MS, memoriaMax: 60,
};

/** O que a leitura usa de fora (troca no teste de corrida: App State falso, relógio virtual, várias abas). */
export interface Dependencias {
  lerCache: <T>(nome: string, ttlMs: number) => Promise<{ dados: T; idadeMs: number; t: number } | null>;
  gravarCache: <T>(nome: string, dados: T, op: { desde?: number; validadeMs?: number }) => Promise<void>;
  /** scannedBytes lidos até agora por esta aba na funcionalidade (lib/dql.ts) */
  bytesLidos: (funcionalidade: string) => number;
  perfil: () => Promise<string>;
  agora: () => number;
  espera: (ms: number) => Promise<void>;
  /** roda f a cada ms; devolve o cancelamento */
  aCada: (f: () => void, ms: number) => () => void;
  token: () => string;
  local?: { ler: (k: string) => string | null; gravar: (k: string, v: string) => void };
}

/** Resultado de um bloco: o dado, quando a leitura dele começou (desde) e se veio de cache (desta aba, de outra aba ou
    de outro usuário) em vez de uma leitura desta aba. */
export interface Bloco<T> { dados: T; desde: number; deCache: boolean }
export interface ContextoLeitura {
  /** a leitura saiu incompleta (uma parte opcional falhou): mostra, mas não guarda para os outros */
  naoGuardar: () => void;
}
export interface OpcoesLeitura<T> {
  validadeMs?: number;
  /** quem pediu já saiu (outra tela, outro escopo): não espera nem começa leitura por ele */
  desistir?: () => boolean;
  /** a entrada do cache tem o formato esperado */
  aceitar?: (d: T) => boolean;
}
export type Pronto<T> = { dados: T; t: number };
export interface Lider {
  comMarcador: boolean;
  /** bytes lidos pela aba no tipo desde que assumiu */
  bytes: () => number;
  /** fim da leitura (depois de gravar o cache): para a batida, solta o marcador e guarda o custo se ok */
  soltar: (ok: boolean) => Promise<void>;
}
export type Vez<T> = { pronto: Pronto<T>; lider?: undefined; desistiu?: undefined }
  | { lider: Lider; pronto?: undefined; desistiu?: undefined }
  | { desistiu: true; pronto?: undefined; lider?: undefined };

/** desde = quando a aba assumiu; leitura = quando a leitura no tenant começou (sem ela, ainda não começou: vai começar
    depois de agora, e portanto depois de qualquer Atualizar já clicado) */
interface Marcador { token: string; desde: number; ativo: boolean; leitura?: number }
interface Entrada<T> { d: T; sb?: number }
const K_CUSTOS = "custo-leituras";

export function criarCompartilhado(dep: Dependencias, cfg0: Partial<ConfigCompartilhado> = {}) {
  const cfg: ConfigCompartilhado = { ...CONFIG_PADRAO, ...cfg0 };
  let fimMin = 0;
  const memoria = new Map<string, { t: number; dados: unknown }>();
  const emVoo = new Map<string, { inicio: number; p: Promise<Bloco<unknown> | null> }>();
  const custos = new Map<string, number>();
  let compartilhados: Record<string, { sb: number; t: number }> = {};
  let carga: Promise<void> | null = null;
  /** registro desta aba (memória, para depuração e testes) */
  const estado = { acertosMemoria: 0, acertosAppState: 0, mesmaLeituraNaAba: 0, esperas: 0, acertosAposEspera: 0, assumiu: 0, perdeuVez: 0,
    semMarcador: 0, esgotou: 0, leiturasTenant: 0, desistiu: 0 };

  const bytesDoTipo = (tipo: TipoLeitura) => FUNCIONALIDADES[tipo].reduce((s, f) => s + (dep.bytesLidos(f) || 0), 0);
  const lembrar = (nome: string, t: number, dados: unknown) => {
    memoria.delete(nome);
    memoria.set(nome, { t, dados });
    while (memoria.size > cfg.memoriaMax) memoria.delete(memoria.keys().next().value as string);
  };

  // ---- custo da última leitura de cada tipo (decide o marcador) ----
  function carregarCustos(): Promise<void> {
    return (carga ??= (async () => {
      try { const v = dep.local?.ler("def.custo-leituras"); if (v) for (const [k, x] of Object.entries(JSON.parse(v) as Record<string, number>)) if (!custos.has(k) && typeof x === "number") custos.set(k, x); } catch { /* sem armazenamento */ }
      try {
        const c = await dep.lerCache<Record<string, { sb: number; t: number }>>(K_CUSTOS, 86_400_000);
        if (c?.dados && typeof c.dados === "object") {
          compartilhados = c.dados;
          for (const [k, x] of Object.entries(c.dados)) if (typeof x?.sb === "number") custos.set(k, x.sb);
        }
      } catch { /* sem App State */ }
    })());
  }
  function registrarCusto(tipo: TipoLeitura, sb: number) {
    custos.set(tipo, sb);
    try { dep.local?.gravar("def.custo-leituras", JSON.stringify(Object.fromEntries(custos))); } catch { /* sem armazenamento */ }
    const antes = compartilhados[tipo];
    // a entrada compartilhada muda só quando o tipo cruza o limiar, ou de hora em hora
    if (antes && (antes.sb > cfg.limiarBytes) === (sb > cfg.limiarBytes) && dep.agora() - antes.t < 3_600_000) return;
    void (async () => {
      const atual = await dep.lerCache<Record<string, { sb: number; t: number }>>(K_CUSTOS, 86_400_000).catch(() => null);
      compartilhados = { ...(atual?.dados ?? compartilhados), [tipo]: { sb, t: dep.agora() } };
      await dep.gravarCache(K_CUSTOS, compartilhados, { validadeMs: 86_400_000 });
    })().catch(() => { /* fica só na aba */ });
  }

  // ---- marcador "andamento" ----
  const kMarcador = (tipo: TipoLeitura, nome: string) => `andamento|${tipo}|${resumo(nome)}`;
  // tempo de ida e volta das últimas operações do marcador nesta aba: com o App State lento, a confirmação espera mais
  // que 300 ms (a gravação de outra aba que leu o marcador vazio pode chegar até uma ida e volta depois da nossa)
  const rtts: number[] = [];
  const medir = async <R>(f: () => Promise<R>): Promise<R> => {
    const t0 = dep.agora();
    try { return await f(); } finally { rtts.push(dep.agora() - t0); if (rtts.length > 20) rtts.shift(); }
  };
  const confirmarMs = () => Math.max(cfg.confirmarMs, 2 * rtts.reduce((a, b) => Math.max(a, b), 0));
  async function lerMarcador(km: string): Promise<Marcador | null> {
    const c = await medir(() => dep.lerCache<Marcador>(km, cfg.mortoMs)).catch(() => null);   // sem batida há 75 s: morto
    return c?.dados && typeof c.dados.token === "string" ? c.dados : null;
  }
  const escreverMarcador = (km: string, m: Marcador) => medir(() => dep.gravarCache(km, m, { validadeMs: cfg.mortoMs })).catch(() => { /* sem App State */ });
  /** O marcador serve a quem espera: ativo e com a leitura começada depois do Atualizar desta aba (ou ainda por começar). */
  const serve = (m: Marcador) => m.ativo && (m.leitura == null || m.leitura >= fimMin);
  async function soltarSeMeu(km: string, token: string, desde: number) {
    const m = await lerMarcador(km);
    if (m && m.token === token) await escreverMarcador(km, { token, desde, ativo: false });
  }
  function novoLider(tipo: TipoLeitura, km: string, marca: { token: string; desde: number } | null): Lider {
    const bytes0 = bytesDoTipo(tipo);
    let solto = false, batida: Promise<void> = Promise.resolve();
    let parar: (() => void) | null = null;
    // a leitura começa agora: o marcador passa a dizer quando (quem clicou Atualizar antes disso pode esperar por ela)
    const m0: Marcador | null = marca ? { ...marca, ativo: true, leitura: dep.agora() } : null;
    if (m0) {
      batida = escreverMarcador(km, m0);
      parar = dep.aCada(() => {
        batida = batida.then(async () => {
          if (solto) return;
          const m = await lerMarcador(km);
          // outra aba assumiu (esta ficou sem batida): segue a leitura, mas o marcador agora é dela
          if (m && m.ativo && m.token !== m0.token) { parar?.(); parar = null; return; }
          if (!solto) await escreverMarcador(km, m0);
        }).catch(() => { /* a próxima batida tenta de novo */ });
      }, cfg.batidaMs);
    }
    return {
      comMarcador: !!marca,
      bytes: () => Math.max(0, bytesDoTipo(tipo) - bytes0),
      async soltar(ok: boolean) {
        if (solto) return;
        solto = true;
        parar?.(); parar = null;
        if (ok && FUNCIONALIDADES[tipo].length) registrarCusto(tipo, Math.max(0, bytesDoTipo(tipo) - bytes0));
        await batida;                                     // a batida em voo não regrava o marcador depois de soltar
        if (marca) await soltarSeMeu(km, marca.token, marca.desde);
      },
    };
  }

  /** Quem espera: sonda o cache (pronto) e o marcador. "livre" = o marcador morreu, foi solto sem resultado ou é de antes
      do Atualizar; "esgotou" = passou da espera máxima. */
  async function esperar<T>(km: string, inicioTotal: number, pronto: () => Promise<Pronto<T> | null>, desistir?: () => boolean): Promise<Vez<T> | "livre" | "esgotou"> {
    const inicio = dep.agora();
    for (let i = 0; ; i++) {
      const n = cfg.sondagensMs.length;
      const alvo = i < n ? cfg.sondagensMs[i] : (n ? cfg.sondagensMs[n - 1] : 0) + (i - n + 1) * cfg.sondagemMs;
      if (inicio + alvo - inicioTotal > cfg.esperaMaxMs) return "esgotou";
      await dep.espera(Math.max(0, inicio + alvo - dep.agora()));
      if (desistir?.()) return { desistiu: true };
      const h = await pronto();
      if (h) return { pronto: h };
      const m = await lerMarcador(km);
      if (!m || !serve(m)) return "livre";
    }
  }

  /** Para leituras com fluxo próprio (base, Visão geral, backend) e para lerCompartilhado: se a leitura do tipo é cara e
      outra aba já está lendo este nome, espera a entrada que ela gravar (pronto lê e confere a entrada: formato, validade
      e fim mínimo); senão assume a leitura (o Lider solta o marcador no fim). */
  async function esperarOuAssumir<T>(tipo: TipoLeitura, nome: string, pronto: () => Promise<Pronto<T> | null>, op: { desistir?: () => boolean } = {}): Promise<Vez<T>> {
    await carregarCustos();
    const km = kMarcador(tipo, nome);
    // custo desconhecido (ninguém leu o tipo nas últimas 24 h): usa o marcador, para a primeira leva de abas não ler junto
    const sb = custos.get(tipo);
    if (!FUNCIONALIDADES[tipo].length || (sb != null && !(sb > cfg.limiarBytes))) { estado.semMarcador++; return { lider: novoLider(tipo, km, null) }; }
    const inicio = dep.agora();
    for (let tentativa = 0; tentativa < 4; tentativa++) {
      const m = await lerMarcador(km);
      if (m && serve(m)) {
        estado.esperas++;
        const r = await esperar(km, inicio, pronto, op.desistir);
        if (r === "esgotou") { estado.esgotou++; return { lider: novoLider(tipo, km, null) }; }
        if (r !== "livre") { if (r.pronto) estado.acertosAposEspera++; else estado.desistiu++; return r; }
      }
      if (op.desistir?.()) { estado.desistiu++; return { desistiu: true }; }
      // assume: grava o próprio token, espera e relê; a última gravação vence
      const token = dep.token(), desde = dep.agora();
      await escreverMarcador(km, { token, desde, ativo: true });
      await dep.espera(confirmarMs());
      const m2 = await lerMarcador(km);
      if (!m2 || m2.token === token) {
        const h = await pronto();                     // outra aba pode ter gravado entre a primeira olhada e agora
        if (h) { await soltarSeMeu(km, token, desde); estado.acertosAposEspera++; return { pronto: h }; }
        if (op.desistir?.()) { await soltarSeMeu(km, token, desde); estado.desistiu++; return { desistiu: true }; }
        estado.assumiu++;
        return { lider: novoLider(tipo, km, { token, desde }) };
      }
      estado.perdeuVez++;                             // outra aba ficou com a vez: espera a leitura dela
      if (dep.agora() - inicio > cfg.esperaMaxMs) break;
    }
    estado.esgotou++;
    return { lider: novoLider(tipo, km, null) };
  }

  /** Um bloco (valores dos filtros, qualidade, painel, isolar, "Por quê?", lista de sessões, "Onde falha"...) pelas 4
      camadas. escopo = chaveBloco(...) montado junto com o texto das consultas (antes de qualquer espera). ler = a leitura
      no tenant, com o texto já montado. null só se quem pediu desistiu. */
  async function lerCompartilhado<T>(tipo: TipoLeitura, escopo: string, ler: (c: ContextoLeitura) => Promise<T>, op: OpcoesLeitura<T> = {}): Promise<Bloco<T> | null> {
    const validade = op.validadeMs ?? cfg.validadeMs;
    const vale = (t: number) => t >= fimMin && dep.agora() - t <= validade;
    // o mesmo bloco pedido de novo nesta aba enquanto o primeiro pedido anda (dois componentes, remontagem): espera o
    // mesmo, desde o primeiro instante (antes de qualquer espera), para a aba não disputar o marcador com ela mesma
    const kVoo = `${tipo}|${escopo}`;
    const v = emVoo.get(kVoo);
    if (v && v.inicio >= fimMin) {
      const r = (await v.p) as Bloco<T> | null;
      if (r && vale(r.desde)) { if (!r.deCache) estado.mesmaLeituraNaAba++; return r; }
      if (op.desistir?.()) return null;
      if (emVoo.get(kVoo) === v) emVoo.delete(kVoo);
      return lerCompartilhado(tipo, escopo, ler, op);   // quem pediu primeiro desistiu: este segue
    }
    const inicioVoo = dep.agora();
    const p = lerCamadas(tipo, escopo, ler, op, validade, vale);
    const voo = { inicio: inicioVoo, p: p as Promise<Bloco<unknown> | null> };
    emVoo.set(kVoo, voo);
    const limpar = () => { if (emVoo.get(kVoo) === voo) emVoo.delete(kVoo); };
    p.then(limpar, limpar);
    return p;
  }
  async function lerCamadas<T>(tipo: TipoLeitura, escopo: string, ler: (c: ContextoLeitura) => Promise<T>, op: OpcoesLeitura<T>, validade: number, vale: (t: number) => boolean): Promise<Bloco<T> | null> {
    const nome = `${tipo}|${await dep.perfil()}|${resumo(escopo)}`;
    const m = memoria.get(nome);
    if (m && vale(m.t)) { estado.acertosMemoria++; return { dados: m.dados as T, desde: m.t, deCache: true }; }
    const pronto = async (): Promise<Pronto<T> | null> => {
      const c = await dep.lerCache<Entrada<T>>(nome, validade).catch(() => null);
      if (!c || !c.dados || typeof c.dados !== "object" || !("d" in c.dados) || !vale(c.t)) return null;
      if (op.aceitar && !op.aceitar(c.dados.d)) return null;
      if (typeof c.dados.sb === "number" && !custos.has(tipo)) custos.set(tipo, c.dados.sb);   // aprende o custo do tipo
      return { dados: c.dados.d, t: c.t };
    };
    const h = await pronto();
    if (h) { estado.acertosAppState++; lembrar(nome, h.t, h.dados); return { dados: h.dados, desde: h.t, deCache: true }; }
    const vez = await esperarOuAssumir<T>(tipo, nome, pronto, op);
    if (vez.desistiu) return null;
    if (vez.pronto) { lembrar(nome, vez.pronto.t, vez.pronto.dados); return { dados: vez.pronto.dados, desde: vez.pronto.t, deCache: true }; }
    const lider = vez.lider;
    let guardar = true, dados: T;
    const desde = dep.agora();
    estado.leiturasTenant++;
    try { dados = await ler({ naoGuardar: () => { guardar = false; } }); }
    catch (e) { void lider.soltar(false).catch(() => { /* ok */ }); throw e; }
    // a tela recebe já; a gravação segue e o marcador só sai depois dela (quem espera acha a entrada)
    if (guardar) lembrar(nome, desde, dados);
    void (async () => {
      if (!guardar) return;
      // sem gravação condicional: não troca por esta uma entrada mais nova que outra aba já gravou
      const atual = await dep.lerCache<Entrada<T>>(nome, validade).catch(() => null);
      if (!(atual && atual.t > desde)) await dep.gravarCache<Entrada<T>>(nome, { d: dados, sb: lider.bytes() }, { desde, validadeMs: validade });
    })().catch(() => { /* fica na memória da aba */ }).finally(() => lider.soltar(true).catch(() => { /* ok */ }));
    return { dados, desde, deCache: false };
  }

  return {
    lerCompartilhado, esperarOuAssumir,
    /** ao abrir: o perfil e o custo de cada tipo já ficam prontos antes das primeiras leituras */
    preparar: () => { void dep.perfil().catch(() => { /* resolve na 1a leitura */ }); void carregarCustos(); },
    /** Atualizar: dali em diante esta aba só aceita leitura começada depois do clique (cache, marcador e memória) */
    // o Atualizar aceita a leitura começada até REAPROVEITAR_ATUALIZAR_MS antes do clique:
    // dois cliques seguidos, ou o clique logo depois de abrir, não pagam a mesma leitura duas vezes
    marcarAtualizar: () => { fimMin = Math.max(fimMin, dep.agora() - REAPROVEITAR_ATUALIZAR_MS); },
    fimMinimo: () => fimMin,
    configurar: (c: Partial<ConfigCompartilhado>) => { Object.assign(cfg, c); },
    estado, custos,
  };
}

// ---- perfil de acesso ----
/** Permissões de leitura do Grail que os blocos usam (todas declaradas no app.config.json). */
const LEITURAS = ["storage:buckets:read", "storage:bizevents:read", "storage:user.events:read", "storage:user.sessions:read",
  "storage:spans:read", "storage:entities:read", "storage:events:read", "storage:metrics:read"];
let perfil: Promise<string> | null = null;
const perfilProprio = () => {
  try { const id = getCurrentUserDetails()?.id; if (id) return `u${resumo(String(id))}`; } catch { /* fora da plataforma */ }
  return `a${Math.random().toString(36).slice(2, 10)}`;   // nem o usuário: só esta aba
};
async function resolverPerfil(): Promise<string> {
  try {
    const r = await effectivePermissionsClient.resolveEffectivePermissions({ body: { permissions: LEITURAS.map((permission) => ({ permission })) } });
    const lista = ((r as unknown as { effectivePermissions?: unknown })?.effectivePermissions ?? r) as { permission?: string; granted?: unknown }[];
    if (Array.isArray(lista)) {
      const por = new Map(lista.map((p) => [String(p?.permission), String(p?.granted)]));
      const g = LEITURAS.map((p) => por.get(p));
      // sem condição em nenhuma: o mesmo conjunto de sim/não vê os mesmos dados
      if (g.every((x) => x === "true" || x === "false")) return `p${resumo(g.join(","))}`;
    }
  } catch { /* sem o escopo de resolução ou sem resposta */ }
  return perfilProprio();
}
/** Perfil de acesso de quem usa: "p<resumo>" para permissões de leitura sem condição (compartilhado com quem tem as
    mesmas), "u<resumo do usuário>" com permissão condicional ou sem resposta. Uma consulta por aba. */
export function perfilAcesso(): Promise<string> {
  return (perfil ??= Promise.race([resolverPerfil(), new Promise<string>((ok) => setTimeout(() => ok(perfilProprio()), 8000))]));
}

/** Escopo de um bloco: as partes (aplicação, página, janela, robôs...) e o estado do módulo de consultas que muda o texto
    delas (cópia, frames, cliques por métrica e o filtro de segmento em ordem fixa). Montar junto com o texto das consultas,
    antes de qualquer espera: o que é guardado é do escopo da chave. */
export const chaveBloco = (...partes: (string | number | boolean | null | undefined)[]) =>
  JSON.stringify([...partes.map((p) => (p == null ? null : String(p))), passosEmUso() ?? "-", quadrosEmUso() ? 1 : 0, "ag", chaveSegmento()]);

// ---- instância da aba ----
const leitor = criarCompartilhado({
  lerCache, gravarCache,
  bytesLidos: (f) => consumoDql().porFuncionalidade[f]?.scannedBytes ?? 0,
  perfil: perfilAcesso,
  agora: () => Date.now(),
  espera: (ms) => new Promise((ok) => setTimeout(ok, ms)),
  aCada: (f, ms) => { const h = setInterval(f, ms); return () => clearInterval(h); },
  token: () => `${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`,
  local: {
    ler: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    gravar: (k, v) => { try { localStorage.setItem(k, v); } catch { /* sem armazenamento */ } },
  },
});
try { (globalThis as unknown as { __defCompartilhado?: unknown }).__defCompartilhado = leitor; } catch { /* sem globalThis */ }
export const lerCompartilhado = leitor.lerCompartilhado;
export const esperarOuAssumir = leitor.esperarOuAssumir;
export const marcarAtualizar = leitor.marcarAtualizar;
export const fimMinimo = leitor.fimMinimo;
export const configurarCompartilhado = leitor.configurar;
export const prepararCompartilhado = leitor.preparar;

// ---- o que está na tela veio de cache (rótulo "dados de hh:mm") ----
const naTela = new Map<string, number>();
const ouvintes = new Set<() => void>();
/** O bloco id está na tela com dado de cache lido a partir de desde (null = saiu da tela, ou o dado é desta aba). */
export function marcarNaTela(id: string, desde: number | null) {
  if (desde == null) { if (!naTela.delete(id)) return; }
  else { if (naTela.get(id) === desde) return; naTela.set(id, desde); }
  for (const f of [...ouvintes]) f();
}
/** Início da leitura mais antiga entre os blocos de cache na tela. */
export const dadoMaisAntigoNaTela = (): number | null => (naTela.size ? Math.min(...naTela.values()) : null);
export const ouvirTela = (f: () => void) => { ouvintes.add(f); return () => { ouvintes.delete(f); }; };
