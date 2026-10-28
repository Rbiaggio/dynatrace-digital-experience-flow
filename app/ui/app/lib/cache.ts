/* Cache compartilhado de resultados no App State da plataforma: o segundo usuário que abrir o app na mesma
   janela não repete a varredura do Grail. Fora da plataforma (pré-visualização) cai no sessionStorage.
   v2: envelope {v: 2, t, d | z}. t = quando a LEITURA começou (a idade conta do dado, não da gravação). Acima de 20 mil
   caracteres o dado vai comprimido (gzip do navegador + base64, em z) e o limite de 800 mil vale sobre o texto gravado.
   A entrada sai do App State 1 min depois de vencer (t + validade + 1 min), em vez de ocupar a cota do app por 1 dia.
   A entrada da v1 ({t, dados}) continua legível; as análises da IA gravadas pela v1 (24 h) são lidas pela chave antiga. */
import { stateClient } from "@dynatrace-sdk/client-state";

export const TTL_PADRAO_MS = 5 * 60 * 1000;
const PREFIXO = "rum-flow.cache.v2.";
/** 1.46.0: o modo de atualização (lib/atualizacao.ts) entra na chave, para uma leitura em tempo real não servir a tela do modo
    a cada 5 minutos, nem o contrário, depois que o administrador troca. Tempo real = "" (as chaves de antes). */
let variante = "";
export const usarVarianteCache = (v: string) => { variante = v ? `${v}.` : ""; };
const PREFIXO_V1 = "rum-flow.cache.v1.";
export const LIMITE_CHARS = 800_000;          // margem abaixo do limite do App State, sobre o texto gravado
export const COMPRIMIR_ACIMA = 20_000;        // até aqui o dado vai em texto (comprimir não compensa)
const FOLGA_MS = 60_000;
/** Nomes que a migração da v1 não esvazia (análises da IA: 24 h e cada uma custa uma chamada à IA); a leitura procura a
    chave antiga quando não acha a nova. */
const LEGADO_V1 = "assist.";

interface EnvelopeV1<T> { t: number; dados: T }
interface EnvelopeV2<T> { v: 2; t: number; d?: T; z?: string }

/** Registro desta aba (memória, só para depuração: no console, __defCache). */
export const estadoCache = {
  gravadas: 0, comprimidas: 0, charsAntes: 0, charsGravados: 0, grandesDemais: 0,
  cotaCheia: 0, entradaGrande: 0, falhasGravacao: 0, falhasLeitura: 0, ultimoErro: "", migradasV1: 0,
};
try { (globalThis as unknown as { __defCache?: typeof estadoCache }).__defCache = estadoCache; } catch { /* sem globalThis */ }

/** Resumo (hash) de um texto em base 36: duas somas de 32 bits. Também dá a chave das análises de IA. */
export function resumo(s: string): string {
  let a = 5381, b = 52711;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a = ((a << 5) + a + c) | 0; b = ((b << 5) + b) ^ c; b |= 0; }
  return (a >>> 0).toString(36) + (b >>> 0).toString(36);
}
/** Nome no App State: até 120 caracteres legíveis. Nome maior vira os 100 primeiros + o resumo do nome inteiro, para
    escopos que só diferem no fim (filtros de segmento longos, tipo do dado) não caírem na mesma chave na prática. */
const chave = (prefixo: string, nome: string) => {
  const limpo = nome.replace(/[^a-zA-Z0-9._-]/g, "_");
  return prefixo + (limpo.length <= 120 ? limpo : `${limpo.slice(0, 100)}.h${resumo(nome)}`);
};

async function comprimir(s: string): Promise<string | null> {
  if (typeof CompressionStream === "undefined") return null;
  const buf = await new Response(new Blob([s]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
  const u8 = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(bin);
}
async function descomprimir(b64: string): Promise<string> {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
}

/** O texto gravado no App State para o dado lido a partir de t (exportado para o teste). */
export async function codificar<T>(dados: T, t: number): Promise<string> {
  const json = JSON.stringify(dados);
  if (json !== undefined && json.length > COMPRIMIR_ACIMA) {
    try {
      const z = await comprimir(json);
      if (z != null) { estadoCache.comprimidas++; estadoCache.charsAntes += json.length; estadoCache.charsGravados += z.length; return JSON.stringify({ v: 2, t, z } as EnvelopeV2<T>); }
    } catch { /* sem compressão no navegador: segue em texto */ }
  }
  return json === undefined ? JSON.stringify({ v: 2, t } as EnvelopeV2<T>) : `{"v":2,"t":${JSON.stringify(t)},"d":${json}}`;
}
/** O dado de um texto do App State (v2, comprimido ou não, ou v1), a idade e quando a leitura dele começou (t); null se
    não serve. Só descomprime depois de conferir a idade (ttlMs). */
export async function decodificar<T>(bruto: string | null | undefined, ttlMs = Infinity, agora = Date.now()): Promise<{ dados: T; idadeMs: number; t: number } | null> {
  if (!bruto) return null;
  try {
    const env = JSON.parse(bruto) as Partial<EnvelopeV2<T>> & Partial<EnvelopeV1<T>>;
    if (!env || typeof env.t !== "number") return null;
    const idade = agora - env.t;
    if (!(idade <= ttlMs)) return null;
    if (env.v === 2) return { dados: (env.z != null ? JSON.parse(await descomprimir(env.z)) : env.d) as T, idadeMs: idade, t: env.t };
    return { dados: env.dados as T, idadeMs: idade, t: env.t };
  } catch { return null; }
}
/** validUntilTime da entrada lida a partir de t: t + validade + 1 min, contado de agora em minutos (o App State aceita
    de now+1m a now+90d). */
export const validadeAppState = (t: number, validadeMs: number, agora = Date.now()) =>
  `now+${Math.min(129_600, Math.max(1, Math.ceil((t + validadeMs + FOLGA_MS - agora) / 60000)))}m`;

const naoExiste = (e: unknown) => {
  const x = e as { name?: string; isNotFound?: boolean; message?: string; response?: { status?: number }; body?: { error?: { code?: number } } };
  return x?.isNotFound === true || x?.name === "NotFound" || x?.response?.status === 404 || x?.body?.error?.code === 404 || /\b404\b|not ?found/i.test(String(x?.message ?? ""));
};
const codigoErro = (e: unknown) => (e as { body?: { error?: { details?: { errorCode?: string } } } })?.body?.error?.details?.errorCode;
const descrever = (e: unknown) => String(codigoErro(e) ?? (e as { name?: string })?.name ?? (e as { message?: string })?.message ?? e).slice(0, 200);

/** Valor da chave no App State; 404 = ausência. Fora da plataforma (ou com falha), a cópia desta aba no sessionStorage. */
async function lerBruto(k: string): Promise<string | null> {
  try { return (await stateClient.getAppState({ key: k })).value ?? null; }
  catch (e) {
    if (!naoExiste(e)) { estadoCache.falhasLeitura++; estadoCache.ultimoErro = descrever(e); }
    try { return sessionStorage.getItem(k); } catch { return null; }
  }
}

export async function lerCache<T>(nome: string, ttlMs = TTL_PADRAO_MS): Promise<{ dados: T; idadeMs: number; t: number } | null> {
  void migrarV1();
  let bruto = await lerBruto(chave(PREFIXO + variante, nome));
  // análise da IA gravada pela versão anterior: continua valendo até vencer
  if (!bruto && nome.startsWith(LEGADO_V1)) bruto = await lerBruto(chave(PREFIXO_V1, nome));
  return decodificar<T>(bruto, ttlMs);
}

export interface OpcoesGravar {
  /** quando a leitura do dado começou (padrão: agora); a idade e a validade contam daqui */
  desde?: number;
  /** por quanto tempo o dado serve (padrão: 5 min); a entrada sai do App State 1 min depois */
  validadeMs?: number;
}
export async function gravarCache<T>(nome: string, dados: T, opcoes: OpcoesGravar = {}): Promise<void> {
  void migrarV1();
  const k = chave(PREFIXO + variante, nome);
  const t = opcoes.desde ?? Date.now();
  let valor: string;
  try { valor = await codificar(dados, t); } catch { return; }
  if (valor.length > LIMITE_CHARS) { estadoCache.grandesDemais++; return; }   // grande demais mesmo comprimido: não cacheia
  try {
    await stateClient.setAppState({ key: k, body: { value: valor, validUntilTime: validadeAppState(t, opcoes.validadeMs ?? TTL_PADRAO_MS) } });
    estadoCache.gravadas++;
  } catch (e) {
    estadoCache.falhasGravacao++; estadoCache.ultimoErro = descrever(e);
    const codigo = codigoErro(e);
    if (codigo === "AppStateSizeLimitExceeded") estadoCache.entradaGrande++;
    if (codigo === "AppStateOverallSizeLimitExceeded") {
      estadoCache.cotaCheia++;
      if (estadoCache.cotaCheia === 1) console.warn("[RUM Flow] App State do app cheio (AppStateOverallSizeLimitExceeded): o cache compartilhado não gravou; esta aba guarda só para ela.");
    }
    try { sessionStorage.setItem(k, valor); } catch { /* sem armazenamento */ }
  }
}

let migracao: Promise<void> | null = null;
/** Libera a cota ocupada pela v1, que gravava as entradas de 5 min com validade de 1 dia: sobrescreve cada uma com
    valor vazio e validade de 1 min (apagar exigiria state:app-states:delete, que o app não pede). Uma vez por aba, só as
    que ainda não foram esvaziadas. As análises da IA (24 h) ficam: continuam legíveis até vencer. */
export function migrarV1(): Promise<void> {
  return (migracao ??= (async () => {
    try {
      const corte = new Date(Date.now() + 2 * 60000).toISOString();
      const lista = await stateClient.getAppStates({ filter: `key starts-with '${PREFIXO_V1}' and not (key starts-with '${PREFIXO_V1}${LEGADO_V1}') and validUntilTime > '${corte}'` });
      for (const e of lista ?? []) {
        if (!e?.key?.startsWith(PREFIXO_V1) || e.key.startsWith(PREFIXO_V1 + LEGADO_V1)) continue;
        try { await stateClient.setAppState({ key: e.key, body: { value: "", validUntilTime: "now+1m" } }); estadoCache.migradasV1++; }
        catch {
          try { await stateClient.setAppState({ key: e.key, body: { value: "{}", validUntilTime: "now+1m" } }); estadoCache.migradasV1++; } catch { /* outra aba já esvaziou, ou sem permissão */ }
        }
      }
    } catch { /* sem App State (pré-visualização) ou sem permissão de listar */ }
  })());
}
