/* Jornadas de negócio: nome + telas em ordem (passos do funil) + serviços de backend relacionados.
   Guardadas no App State da plataforma (compartilhado entre usuários). Fora da plataforma, ou se o App State
   falhar, caem no armazenamento local do navegador, e o carregamento reconcilia os dois lados. */
import { stateClient } from "@dynatrace-sdk/client-state";
import { Grafo, NoFluxo, idEntrada, idView } from "./graph";

export interface PassoJornada { app: string; view: string }
export interface Jornada { id: string; nome: string; passos: PassoJornada[]; servicos: string[]; criadaEm: string }
export interface PassoFunil extends PassoJornada { sessoes: number; pctAnterior: number; pctInicio: number; dropOff: number; dropOffComErro: number; erros: number }   // dropOffComErro: dos que não seguiram, quantos tiveram erro na tela anterior
export interface Funil { passos: PassoFunil[]; entraram: number; concluiram: number; conversao: number; erros: number }
export type Origem = "app-state" | "local";
export interface Armazenamento { origem: Origem; erro: string | null }

const CHAVE = "rum-flow.jornadas.v1";

const descreverErro = (e: unknown) => {
  const err = e as { name?: string; message?: string; body?: { error?: { message?: string } }; response?: { status?: number } };
  return [err?.name, err?.body?.error?.message ?? err?.message, err?.response?.status ? `HTTP ${err.response.status}` : ""].filter(Boolean).join(" · ");
};
const ehNaoEncontrado = (e: unknown) => /notfound|not found|404/i.test(descreverErro(e));

function lerLocal(): Jornada[] {
  try { return validar(JSON.parse(localStorage.getItem(CHAVE) || "[]")); } catch { return []; }
}
function gravarLocal(j: Jornada[]) {
  try { localStorage.setItem(CHAVE, JSON.stringify(j)); } catch { /* sem armazenamento */ }
}

/** Lê do App State; se lá não houver nada mas o navegador tiver (gravação anterior que falhou), usa o local e tenta regravar. */
export async function carregarJornadas(): Promise<{ jornadas: Jornada[]; armazenamento: Armazenamento }> {
  const local = lerLocal();
  try {
    const estado = await stateClient.getAppState({ key: CHAVE });
    const remotas = validar(JSON.parse(estado.value || "[]"));
    if (remotas.length === 0 && local.length > 0) {
      const arm = await salvarJornadas(local);
      return { jornadas: local, armazenamento: arm };
    }
    gravarLocal(remotas);
    return { jornadas: remotas, armazenamento: { origem: "app-state", erro: null } };
  } catch (e) {
    if (ehNaoEncontrado(e)) {
      if (local.length > 0) { const arm = await salvarJornadas(local); return { jornadas: local, armazenamento: arm }; }
      return { jornadas: [], armazenamento: { origem: "app-state", erro: null } };
    }
    console.error("[RUM Flow] App State indisponível; usando o armazenamento do navegador", e);
    return { jornadas: local, armazenamento: { origem: "local", erro: descreverErro(e) } };
  }
}

/** Grava no App State (tentando variantes de validade) e sempre também no navegador. */
export async function salvarJornadas(jornadas: Jornada[]): Promise<Armazenamento> {
  const valor = JSON.stringify(jornadas);
  gravarLocal(jornadas);
  let ultimo: unknown = null;
  for (const body of [{ value: valor }, { value: valor, validUntilTime: "now+90d" }, { value: valor, validUntilTime: "now+30d" }]) {
    try {
      await stateClient.setAppState({ key: CHAVE, body });
      return { origem: "app-state", erro: null };
    } catch (e) { ultimo = e; }
  }
  console.error("[RUM Flow] não consegui gravar as jornadas no App State", ultimo);
  return { origem: "local", erro: descreverErro(ultimo) };
}

function validar(x: unknown): Jornada[] {
  if (!Array.isArray(x)) return [];
  return x.filter((j): j is Jornada => !!j && typeof j === "object" && typeof (j as Jornada).nome === "string" && Array.isArray((j as Jornada).passos))
          .map((j) => ({ ...j, servicos: Array.isArray(j.servicos) ? j.servicos : [] }));
}

/** Monta a jornada a partir dos nós clicados, na ordem do clique: telas viram passos, serviços/bancos viram relacionados. */
export function jornadaDaSelecao(nome: string, selecao: string[], grafo: Grafo): Jornada {
  // id de página é "app|view" (idView); se o nó não está no grafo da janela atual (ex.: ao editar uma jornada
  // antiga), o passo é reconstruído pelo id em vez de ser descartado
  const passos: PassoJornada[] = [], servicos: string[] = [];
  for (const id of selecao) {
    const n = grafo.nos.find((x) => x.id === id);
    if (n ? n.tipo === "view" && n.app : !id.startsWith("app|") && !id.startsWith("db|") && !id.startsWith("SERVICE-") && id.includes("|")) {
      passos.push(n ? { app: n.app!, view: n.nome } : { app: id.slice(0, id.indexOf("|")), view: id.slice(id.indexOf("|") + 1) });
    } else if (n ? n.tipo === "servico" || n.tipo === "banco" : id.startsWith("db|") || id.startsWith("SERVICE-")) {
      servicos.push(id);
    }
  }
  return { id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, nome: nome.trim(), passos, servicos, criadaEm: new Date().toISOString() };
}

/** Ids dos nós que a jornada destaca no grafo: entradas das aplicações, telas e serviços. */
export function nosDaJornada(j: Jornada): Set<string> {
  const s = new Set<string>();
  for (const p of j.passos) { s.add(idEntrada(p.app)); s.add(idView(p.app, p.view)); }
  for (const id of j.servicos) s.add(id);
  return s;
}

/** Converte a linha única da consulta de funil (p0..pN, q1..qN e erros0..errosN) em passos com percentuais. */
export function montarFunil(j: Jornada, linha: Record<string, unknown> | undefined): Funil {
  const n = (v: unknown) => (v == null || v === "" ? 0 : Number(v));
  const contagens = j.passos.map((_, i) => n(linha?.[`p${i}`]));
  const passos: PassoFunil[] = j.passos.map((p, i) => ({
    ...p,
    sessoes: contagens[i],
    pctAnterior: i === 0 ? 100 : contagens[i - 1] ? (100 * contagens[i]) / contagens[i - 1] : 0,
    pctInicio: contagens[0] ? (100 * contagens[i]) / contagens[0] : 0,
    dropOff: i === 0 ? 0 : Math.max(0, contagens[i - 1] - contagens[i]),
    dropOffComErro: i === 0 ? 0 : Math.min(n(linha?.[`q${i}`]), Math.max(0, contagens[i - 1] - contagens[i])),
    erros: n(linha?.[`erros${i}`]),
  }));
  const entraram = contagens[0] ?? 0, concluiram = contagens[contagens.length - 1] ?? 0;
  return { passos, entraram, concluiram, conversao: entraram ? (100 * concluiram) / entraram : 0, erros: passos.reduce((s, p) => s + p.erros, 0) };
}
