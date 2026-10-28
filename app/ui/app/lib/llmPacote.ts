/* O que sai do ambiente na análise por LLM ("Analisar com LLM"): um DOSSIÊ de evidências por oportunidade
   (montado no navegador por lib/dossie.ts, sob demanda, com a identidade de quem pediu) e o contexto da análise. Este
   arquivo é o formato, a sanitização e a verificação de privacidade, usados dos dois lados: o navegador sanitiza e
   verifica antes de enviar; a função do app (app/api) valida o que chegou, sanitiza de novo (o navegador não é
   confiável) e verifica outra vez antes de chamar o LLM. Sem consulta, sem estado e sem import de valor da plataforma.

   Nunca vai: id de sessão (dt.rum.session.id), IP, user tag, e-mail, CPF/CNPJ, cartão, telefone, token, parâmetro de
   URL, id numérico de caminho (vira {id}), trace id, span id, id de entidade, corpo de resposta de servidor. Mensagens de
   exceção e pilhas vão mascaradas (máscara do DEF, lib/assist.ts) e cortadas.

   Formato do dossiê: campos de topo fixos (id, título, tipo, canal, aplicações, regras do motor, o que a tela mostra,
   janelas, cortes) e as SEÇÕES de evidência (negócio, backend, por estado, saúde por métrica, início do problema,
   mudanças, Davis, frontend, mobile) em JSON livre, mas restrito: chaves em minúsculas com _ (até 48 caracteres), até 40
   itens por lista e 40 chaves por objeto, profundidade até 8, texto até 400 caracteres, números finitos. A montagem mira
   14 KB por dossiê (corta as listas maiores primeiro e anota em `cortes`); a função recusa acima de 20 KB. */
import { mascarar } from "./assist";

export const VERSAO_DOSSIE = 1;
/** Até quantas oportunidades a análise leva (as primeiras da priorização do motor, lib/oportunidades.ts). */
export const MAX_OPORTUNIDADES = 8;
/** Alvo da montagem de cada dossiê (cerca de 3,5 mil tokens). */
export const MAX_BYTES_DOSSIE = 14_000;
/** A função recusa um dossiê acima disso. */
export const MAX_BYTES_DOSSIE_ACEITO = 20_000;

/* ---- Formato ---------------------------------------------------------------------------------------------------------- */
export type TipoDossie = "falha-backend" | "lentidao-pagina" | "chamada-lenta" | "erro-javascript" | "mobile" | "terceiro" | "outro";
export const TIPOS_DOSSIE: readonly TipoDossie[] = ["falha-backend", "lentidao-pagina", "chamada-lenta", "erro-javascript", "mobile", "terceiro", "outro"];
export interface DossieLlm {
  versao: 1;
  /** "o1", "o2"... na ordem da priorização do motor */
  id: string;
  titulo: string;
  tipo: TipoDossie;
  canal: "web" | "mobile";
  aplicacoes: string[];
  /** regras do motor que acharam a oportunidade (W3, M4...) */
  regras: string[];
  /** o que a Visão geral já mostra: impacto, evidência, ação sugerida e os números do motor */
  o_que_a_tela_mostra: { impacto: string; evidencia: string; acao_sugerida: string; numeros: Record<string, number> };
  /** janelas de cada leitura, em texto (fuso do navegador) */
  janelas: Record<string, string>;
  /** as evidências (JSON restrito: ver o cabeçalho) */
  secoes: Record<string, unknown>;
  /** o que a montagem cortou para caber */
  cortes: string[];
}
/** O contexto da análise (vai uma vez, no início): período, escopo e a medida da coleta. */
export interface ContextoAnalise {
  versao: 1;
  periodo: { de: string; ate: string; rotulo: string };
  escopo: string;
  aplicacoes: { nome: string; canal: string | null }[];
  idioma: "pt" | "en";
  versaoApp: string | null;
  /** sessões por dia por aplicação (entradas dos agregados por fatia, último dia inteiro) */
  sessoesPorDia: Record<string, number>;
  /** a coleta: consultas, bytes lidos no Grail e o custo pelo preço de consulta em uso */
  coleta: { consultas: number; bytes: number; custoRs: number; duracaoMs: number; porFonte: Record<string, { consultas: number; bytes: number }> };
}

/* ---- Sanitização de texto (helpers também usados pelo relatório e pelos testes) ------------------------------------- */
const cortar = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
/** Texto livre: máscara do DEF, sem quebra de linha e sem < > (o dado vai entre marcadores no pedido ao modelo). */
export function limparTexto(s: string): string {
  return mascarar(String(s)).replace(/[<>]/g, (c) => (c === "<" ? "‹" : "›")).replace(/\s+/g, " ").trim();
}
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Um pedaço do caminho: id numérico (com ou sem pontuação), UUID, hexadecimal longo, código com muitos dígitos, e-mail
    e token viram marcadores; o resto fica. */
function segmentoSeguro(seg: string): string {
  let d = seg;
  try { d = decodeURIComponent(seg); } catch { /* fica o cru */ }
  if (!d || /^\{[\w-]+\}$/.test(d)) return d;
  if (/@/.test(d)) return "{email}";
  const digitos = (d.match(/\d/g) ?? []).length;
  if (/^[\d.\-_:]+$/.test(d) && digitos >= 4) return "{id}";
  if (RE_UUID.test(d) || (/^[0-9a-f]{12,}$/i.test(d) && digitos > 0)) return "{id}";
  if (d.length >= 6 && digitos >= 4 && digitos / d.length >= 0.4 && /^[\w.-]+$/.test(d)) return "{id}";
  if (d.length >= 20 && /^[\w+=.~%-]+$/.test(d) && /[A-Z]/.test(d) && /[a-z]/.test(d) && /\d/.test(d)) return "{token}";
  return d;
}
/** Domínio sem esquema, credencial, porta de IP e caminho; IP vira [ip]. */
export function sanitizarDominio(bruto: string): string {
  const s = String(bruto).trim().toLowerCase().replace(/^[a-z][\w+.-]*:\/\//, "").replace(/^[^@/]*@/, "").split(/[/?#]/)[0];
  if (/^(\d{1,3}\.){3}\d{1,3}(:\d+)?$/.test(s) || /^\[?[0-9a-f]{0,4}(:[0-9a-f]{0,4}){2,7}\]?(:\d+)?$/i.test(s)) return "[ip]";
  return cortar(limparTexto(s), 100);
}
/** Caminho de URL (endpoint ou página): sem query string, fragmento e parâmetro de matriz (;jsessionid=...), ids
    trocados por {id}, e-mail por {email}; URL completa fica host + caminho. */
export function normalizarCaminho(bruto: string, max = 200): string {
  let s = String(bruto).replace(/[\x00-\x1f\x7f]+/g, " ").trim();
  let host = "";
  const url = /^(?:[a-z][\w+.-]*:)?\/\/([^/?#]*)(.*)$/i.exec(s);
  if (url) { host = sanitizarDominio(url[1]); s = url[2] || "/"; }
  s = s.split(/[?#;]/)[0];
  return cortar(limparTexto(host + s.split("/").map(segmentoSeguro).join("/")), max);
}
/** Nome de página: caminho quando parece URL; senão, texto mascarado (nome de tela de app, título). */
export function sanitizarPagina(bruto: string, max = 160): string {
  const s = String(bruto);
  if (s === "(no name)") return s;
  return /[/?#]/.test(s) ? normalizarCaminho(s, max) : cortar(limparTexto(s), max);
}
/** Frase (título, evidência, mensagem de exceção, pilha): a máscara do texto livre e, em cada caminho ou URL dentro dela,
    a mesma limpeza do endpoint (sem query string, ids viram {id}). Caminho = começa com "/" e uma letra (ou "{"), depois
    de espaço ou parêntese: datas e frações ("17/10", "1/2") ficam. */
export function sanitizarFrase(bruto: string, max = 400): string {
  const s = String(bruto).replace(/[a-z][\w+.-]*:\/\/[^\s"'<>]+|(^|[\s(])(\/[A-Za-z{][^\s"'<>,;)]*)/gi, (m: string, antes?: string, caminho?: string) =>
    caminho ? `${antes ?? ""}${normalizarCaminho(caminho.replace(/[.:]+$/, ""), 200)}${/[.:]+$/.exec(caminho)?.[0] ?? ""}` : normalizarCaminho(m, 200));
  return cortar(limparTexto(s), max);
}
/** Descrição de filtro: filtro por usuário, sessão, IP, e-mail ou documento leva só o nome do filtro, nunca o valor. */
export function sanitizarFiltro(bruto: string, max = 120): string {
  return cortar(limparTexto(String(bruto).replace(/\b(usu[aá]rios?|users?(?:\s*tags?)?|sess(?:[aã]o|ões|oes|ions?)|ips?|e-?mails?|clientes?|cpf|cnpj|documentos?)\b\s*[:=]?\s*.*$/i, "$1 […]")), max);
}
/** Mensagem de erro (tela, exceção, crash): mascarada, aspas simples e, se chegou cortada (a consulta corta), sem o
    pedaço final, que pode ser metade de um CPF ou e-mail. */
export function sanitizarMensagem(bruto: string, max = 200, cortadaEm = 135): string {
  const m = String(bruto);
  const s = sanitizarFrase(m, 100_000);
  return cortar(m.length >= cortadaEm ? s.replace(/(?:\s+[\d.()/+*-]+)*\s*\S*$/, " …") : s, max).replace(/"/g, "'");
}

/** Texto do dossiê: a frase sanitizada e, por cima, o que a verificação recusaria e não tem por que sair (trace e span id,
    id de entidade, número com 6 ou mais dígitos). */
const RE_ENTIDADE = /\b(?:SERVICE|HOST|PROCESS_GROUP_INSTANCE|PROCESS_GROUP|APPLICATION|MOBILE_APPLICATION)-[0-9A-F]{8,}\b/g;
export function textoDossie(bruto: string, max = 400): string {
  return cortar(sanitizarFrase(String(bruto).replace(RE_ENTIDADE, "[id]"), 100_000).replace(RE_ENTIDADE, "[id]")
    .replace(/\b[0-9a-f]{32}\b/gi, "[id]").replace(/\b[0-9a-f]{16}\b/gi, "[id]").replace(/\d{6,}/g, "[n]"), max);
}

/* ---- Sanitização e validação do dossiê -------------------------------------------------------------------------------- */
const RE_CHAVE = /^[a-z][a-z0-9_]{0,47}$/;
const LIM = { itens: 40, chaves: 40, profundidade: 8, texto: 400 };
const numero = (x: number) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : null);
/** JSON livre restrito: texto pela máscara (e caminhos normalizados), chave fora do padrão sai, listas e objetos cortados. */
export function sanitizarLivre(x: unknown, nivel = 0): unknown {
  if (x == null) return null;
  if (typeof x === "string") return textoDossie(x, LIM.texto);
  if (typeof x === "number") return numero(x);
  if (typeof x === "boolean") return x;
  if (nivel >= LIM.profundidade) return "[…]";
  if (Array.isArray(x)) return x.slice(0, LIM.itens).map((v) => sanitizarLivre(v, nivel + 1));
  if (typeof x === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(x as Record<string, unknown>).filter(([k]) => RE_CHAVE.test(k)).slice(0, LIM.chaves)) o[k] = sanitizarLivre(v, nivel + 1);
    return o;
  }
  return null;
}
const textos = (x: unknown, max: number, n = 12) => (Array.isArray(x) ? x.filter((v) => typeof v === "string").slice(0, n).map((v) => textoDossie(v as string, max)) : []);
const SECOES = ["negocio", "backend", "por_estado", "saude_metricas", "inicio_do_problema", "mudancas", "davis", "frontend", "mobile", "terceiros", "nota"] as const;
/** Sanitiza o dossiê inteiro (topo pelo tipo de cada campo, seções pelo JSON restrito) e descarta o que não está no formato.
    Idempotente: roda no navegador e de novo na função. */
export function sanitizarDossie(d: DossieLlm): DossieLlm {
  const t = d.o_que_a_tela_mostra ?? ({} as DossieLlm["o_que_a_tela_mostra"]);
  const numeros: Record<string, number> = {};
  for (const [k, v] of Object.entries(t.numeros ?? {}).filter(([k, v]) => RE_CHAVE.test(k) && typeof v === "number" && Number.isFinite(v)).slice(0, 12)) numeros[k] = numero(v as number)!;
  const secoes: Record<string, unknown> = {};
  for (const k of SECOES) if (d.secoes && k in d.secoes) secoes[k] = sanitizarLivre(d.secoes[k], 1);
  const janelas: Record<string, string> = {};
  for (const [k, v] of Object.entries(d.janelas ?? {}).filter(([k, v]) => RE_CHAVE.test(k) && typeof v === "string").slice(0, 8)) janelas[k] = textoDossie(v, 120);
  return {
    versao: 1, id: /^o\d{1,2}$/.test(String(d.id)) ? d.id : "o1", titulo: textoDossie(String(d.titulo ?? ""), 200),
    tipo: TIPOS_DOSSIE.includes(d.tipo) ? d.tipo : "outro", canal: d.canal === "mobile" ? "mobile" : "web",
    aplicacoes: textos(d.aplicacoes, 80, 6), regras: (Array.isArray(d.regras) ? d.regras : []).filter((r) => typeof r === "string" && /^[A-Z]\d{1,2}c?$/.test(r)).slice(0, 8),
    o_que_a_tela_mostra: { impacto: textoDossie(String(t.impacto ?? ""), 300), evidencia: textoDossie(String(t.evidencia ?? ""), 500), acao_sugerida: textoDossie(String(t.acao_sugerida ?? ""), 400), numeros },
    janelas, secoes, cortes: textos(d.cortes, 80, 20),
  };
}
export function sanitizarContexto(c: ContextoAnalise): ContextoAnalise {
  const iso = (s: unknown) => (typeof s === "string" && !isNaN(Date.parse(s)) ? new Date(s).toISOString() : new Date(0).toISOString());
  const nums = (o: unknown, max = 20) => Object.fromEntries(Object.entries(o && typeof o === "object" ? o : {}).filter(([, v]) => typeof v === "number" && Number.isFinite(v)).slice(0, max).map(([k, v]) => [textoDossie(k, 80), numero(v as number)]));
  const porFonte: ContextoAnalise["coleta"]["porFonte"] = {};
  for (const [k, v] of Object.entries(c.coleta?.porFonte ?? {}).slice(0, 12)) if (v && typeof v === "object") porFonte[textoDossie(k, 40)] = { consultas: numero(Number((v as { consultas: number }).consultas)) ?? 0, bytes: numero(Number((v as { bytes: number }).bytes)) ?? 0 };
  return {
    versao: 1, periodo: { de: iso(c.periodo?.de), ate: iso(c.periodo?.ate), rotulo: textoDossie(String(c.periodo?.rotulo ?? ""), 60) },
    escopo: textoDossie(String(c.escopo ?? ""), 120),
    aplicacoes: (Array.isArray(c.aplicacoes) ? c.aplicacoes : []).slice(0, 20).map((a) => ({ nome: textoDossie(String(a?.nome ?? ""), 80), canal: typeof a?.canal === "string" ? textoDossie(a.canal, 10) : null })),
    idioma: c.idioma === "en" ? "en" : "pt", versaoApp: typeof c.versaoApp === "string" ? textoDossie(c.versaoApp, 24) : null,
    sessoesPorDia: nums(c.sessoesPorDia) as Record<string, number>,
    coleta: { consultas: numero(Number(c.coleta?.consultas)) ?? 0, bytes: numero(Number(c.coleta?.bytes)) ?? 0, custoRs: numero(Number(c.coleta?.custoRs)) ?? 0, duracaoMs: numero(Number(c.coleta?.duracaoMs)) ?? 0, porFonte },
  };
}

export const bytesDe = (x: unknown) => new TextEncoder().encode(JSON.stringify(x)).length;
/** Confere o formato do dossiê (campos de topo, tipos, tamanhos e as regras do JSON livre) e o tamanho total. */
export function validarDossie(x: unknown): { ok: true; dossie: DossieLlm; bytes: number } | { ok: false; erros: string[] } {
  let bytes = 0;
  try { bytes = bytesDe(x); } catch { return { ok: false, erros: ["dossiê: não é JSON"] }; }
  if (bytes > MAX_BYTES_DOSSIE_ACEITO) return { ok: false, erros: [`dossiê: ${bytes} bytes, acima do limite de ${MAX_BYTES_DOSSIE_ACEITO}`] };
  const erros: string[] = [];
  const d = x as Record<string, unknown>;
  if (!d || typeof d !== "object" || Array.isArray(d)) return { ok: false, erros: ["dossiê: objeto esperado"] };
  const permitidos = ["versao", "id", "titulo", "tipo", "canal", "aplicacoes", "regras", "o_que_a_tela_mostra", "janelas", "secoes", "cortes"];
  for (const k of Object.keys(d)) if (!permitidos.includes(k)) erros.push(`dossiê: campo não permitido: ${k.slice(0, 40)}`);
  if (d.versao !== 1) erros.push("dossiê.versao: 1 esperado");
  if (typeof d.id !== "string" || !/^o\d{1,2}$/.test(d.id)) erros.push("dossiê.id: o1 a o99 esperado");
  if (typeof d.titulo !== "string" || !d.titulo.trim() || d.titulo.length > 300) erros.push("dossiê.titulo: texto de 1 a 300");
  if (!TIPOS_DOSSIE.includes(d.tipo as TipoDossie)) erros.push("dossiê.tipo: fora da lista");
  if (d.canal !== "web" && d.canal !== "mobile") erros.push("dossiê.canal: web ou mobile");
  for (const k of ["aplicacoes", "regras", "cortes"]) if (!Array.isArray(d[k]) || (d[k] as unknown[]).some((v) => typeof v !== "string")) erros.push(`dossiê.${k}: lista de textos`);
  const t = d.o_que_a_tela_mostra as Record<string, unknown> | undefined;
  if (!t || typeof t !== "object" || ["impacto", "evidencia", "acao_sugerida"].some((k) => typeof t[k] !== "string") || !t.numeros || typeof t.numeros !== "object") erros.push("dossiê.o_que_a_tela_mostra: impacto, evidencia, acao_sugerida e numeros");
  if (!d.janelas || typeof d.janelas !== "object" || Array.isArray(d.janelas)) erros.push("dossiê.janelas: objeto esperado");
  const s = d.secoes as Record<string, unknown> | undefined;
  if (!s || typeof s !== "object" || Array.isArray(s)) erros.push("dossiê.secoes: objeto esperado");
  else {
    for (const k of Object.keys(s)) if (!(SECOES as readonly string[]).includes(k)) erros.push(`dossiê.secoes: seção não permitida: ${k.slice(0, 40)}`);
    const andar = (v: unknown, onde: string, nivel: number) => {
      if (erros.length >= 20) return;
      if (v == null || typeof v === "boolean") return;
      if (typeof v === "number") { if (!Number.isFinite(v)) erros.push(`${onde}: número inválido`); return; }
      if (typeof v === "string") { if (v.length > 2 * LIM.texto) erros.push(`${onde}: texto maior que ${2 * LIM.texto}`); return; }
      if (nivel > LIM.profundidade + 1) { erros.push(`${onde}: profundidade acima de ${LIM.profundidade}`); return; }
      if (Array.isArray(v)) { if (v.length > 2 * LIM.itens) erros.push(`${onde}: lista maior que ${2 * LIM.itens}`); v.forEach((x2, i) => andar(x2, `${onde}[${i}]`, nivel + 1)); return; }
      if (typeof v === "object") {
        const ks = Object.keys(v as object);
        if (ks.length > 2 * LIM.chaves) erros.push(`${onde}: objeto com mais de ${2 * LIM.chaves} chaves`);
        for (const k of ks) { if (!RE_CHAVE.test(k)) erros.push(`${onde}: chave não permitida: ${k.slice(0, 40)}`); andar((v as Record<string, unknown>)[k], `${onde}.${k}`, nivel + 1); }
        return;
      }
      erros.push(`${onde}: tipo não permitido`);
    };
    andar(s, "dossiê.secoes", 0);
  }
  return erros.length ? { ok: false, erros: erros.slice(0, 20) } : { ok: true, dossie: x as DossieLlm, bytes };
}

/** Rede de segurança depois da sanitização: procura em todo texto (e nas chaves) o que não pode sair. Devolve onde achou
    (nunca o valor). */
const DETECTORES: [string, RegExp][] = [
  ["e-mail", /[\p{L}\p{N}._%+-]+(?:@|%40)[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}/u],
  ["cpf", /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/],
  ["cnpj", /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/],
  ["ip", /\b(?:\d{1,3}\.){3}\d{1,3}\b/],
  ["número longo", /\d{6,}/],
  ["token", /\beyJ[\w-]{5,}\.[\w-]{5,}|\b[Bb]earer\s+[\w.~+/=-]{8,}/],
  ["parâmetro de URL", /[?&][^\s=&?]+=[^\s&]*/],
  ["trace id", /\b[0-9a-f]{32}\b/i],
  ["span ou entidade", /\b[0-9a-f]{16}\b/i],
  ["id de entidade", /\b(?:SERVICE|HOST|PROCESS_GROUP_INSTANCE|PROCESS_GROUP|APPLICATION|MOBILE_APPLICATION)-[0-9A-F]{8,}\b/],
];
export function verificarTextos(p: unknown, ignorar: string[] = []): { onde: string; tipo: string }[] {
  const achados: { onde: string; tipo: string }[] = [];
  const andar = (x: unknown, onde: string) => {
    if (typeof x === "string") { for (const [tipo, re] of DETECTORES) if (re.test(x)) achados.push({ onde, tipo }); return; }
    if (Array.isArray(x)) { x.forEach((v, i) => andar(v, `${onde}[${i}]`)); return; }
    if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) {
      if (ignorar.includes(k)) continue;
      for (const [tipo, re] of DETECTORES) if (re.test(k)) achados.push({ onde: `${onde}.<chave>`, tipo });
      andar(v, onde ? `${onde}.${k}` : k);
    }
  };
  andar(p, "");
  return achados;
}
export const verificarDossie = (d: unknown) => verificarTextos(d);
/** O contexto tem datas ISO no período (de, ate): ficam de fora da busca por número longo. */
export const verificarContexto = (c: unknown) => verificarTextos(c, ["de", "ate"]);

/** Corta até caber: a maior lista das seções pela metade (no mínimo 2 itens), de novo e de novo; depois as seções menos
    importantes inteiras. Cada corte fica anotado em `cortes`. */
export function ajustarDossie(d: DossieLlm, max = MAX_BYTES_DOSSIE): DossieLlm {
  const q: DossieLlm = JSON.parse(JSON.stringify(d));
  const listas = (x: unknown, caminho: string, out: { caminho: string; dono: Record<string, unknown> | unknown[]; chave: string | number; tam: number }[]) => {
    if (Array.isArray(x)) x.forEach((v, i) => { if (Array.isArray(v) && v.length > 2) out.push({ caminho: `${caminho}[${i}]`, dono: x, chave: i, tam: bytesDe(v) }); listas(v, `${caminho}[${i}]`, out); });
    else if (x && typeof x === "object") for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
      if (Array.isArray(v) && v.length > 2) out.push({ caminho: `${caminho}.${k}`, dono: x as Record<string, unknown>, chave: k, tam: bytesDe(v) });
      listas(v, `${caminho}.${k}`, out);
    }
  };
  for (let volta = 0; volta < 60 && bytesDe(q) > max; volta++) {
    const out: Parameters<typeof listas>[2] = [];
    listas(q.secoes, "secoes", out);
    const maior = out.sort((a, b) => b.tam - a.tam)[0];
    if (!maior) break;
    const lista = (maior.dono as Record<string | number, unknown[]>)[maior.chave];
    const n = Math.max(2, Math.floor(lista.length / 2));
    (maior.dono as Record<string | number, unknown[]>)[maior.chave] = lista.slice(0, n);
    q.cortes.push(`${maior.caminho.replace(/\[\d+\]/g, "[]")}: até ${n}`);
  }
  for (const s of ["nota", "terceiros", "saude_metricas", "davis", "mudancas", "inicio_do_problema", "por_estado", "mobile", "frontend", "negocio"]) {
    if (bytesDe(q) <= max) break;
    if (s in q.secoes) { delete q.secoes[s]; q.cortes.push(`secoes.${s}: fora (tamanho)`); }
  }
  q.cortes = [...new Set(q.cortes)].slice(0, 20);
  return q;
}
