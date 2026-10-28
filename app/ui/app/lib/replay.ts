/* Session Replay: o botão de cada sessão segue a configuração de replay da aplicação (1.41, 20/10/2026).

   Desde a 1.41 o app não lê user.sessions (Digital Experience Monitoring - Query: grátis só no Early Access; na versão
   final, sem o item no contrato, é desativado). O botão "Replay" fica ativo quando a aplicação grava replay (ou não se
   sabe) e abre a sessão no Users & Sessions, que mostra o replay se ele foi gravado. Fica cinza, sem ação, com o motivo
   na dica, quando a aplicação não grava. Até a 1.40 ele seguia o has_replay de cada sessão (user.sessions):
     - a aplicação está com o Session Replay desligado (Settings, "Enablement and cost control": web
       builtin:rum.web.enablement, mobile builtin:rum.mobile.enablement; a aplicação sem objeto próprio herda o do
       ambiente), ou gravando só em crash (mobile);
     - a sessão não tem replay (has_replay = false: não gravado, amostragem, navegador sem suporte);
     - a sessão ainda não está no user.sessions (o Dynatrace grava a sessão quando ela termina, com atraso; no LAB,
       19/10, nenhuma sessão dos últimos 20 min estava gravada): "ainda não disponível".
   Antes (até a 1.38.5) o botão aparecia ativo quando a sessão ainda não estava no user.sessions, e abria o Session
   Replay vazio. A leitura das configurações é uma chamada por sessão de uso (cache de 5 min, compartilhada pelas telas);
   sem permissão de leitura de Settings o estado da aplicação fica "desconhecido" e vale só o has_replay. */
import { useEffect, useState } from "react";
import { clientePlataforma } from "./plataforma";
import type { AppInfo } from "./graph";
import { t } from "./i18n";

/** Como a aplicação grava replay: ligado, desligado, só em crash (mobile) ou desconhecido (sem leitura). */
export type ReplayDaApp = "ligado" | "desligado" | "so_crash" | "desconhecido";
export interface ReplayApps { porEscopo: Map<string, ReplayDaApp>; padraoWeb: ReplayDaApp; padraoMobile: ReplayDaApp; lido: boolean }

const SETTINGS = "/platform/classic/environment-api/v2/settings/objects";
const SCHEMA_WEB = "builtin:rum.web.enablement";
const SCHEMA_MOBILE = "builtin:rum.mobile.enablement";
const VALIDADE_MS = 5 * 60 * 1000;
const DESCONHECIDO: ReplayApps = { porEscopo: new Map(), padraoWeb: "desconhecido", padraoMobile: "desconhecido", lido: false };

const replayWeb = (v: any): ReplayDaApp => (v?.sessionReplay?.enabled === true ? "ligado" : v?.sessionReplay?.enabled === false ? "desligado" : "desconhecido");
const replayMobile = (v: any): ReplayDaApp => (v?.sessionReplay?.fullSessionReplay === true ? "ligado" : v?.sessionReplay?.onCrash === true ? "so_crash" : v?.sessionReplay ? "desligado" : "desconhecido");

/** Lê os objetos de habilitação (web e mobile) e monta o mapa escopo → estado. Qualquer erro vira "desconhecido". */
export async function lerReplayApps(cliente = clientePlataforma): Promise<ReplayApps> {
  const porEscopo = new Map<string, ReplayDaApp>();
  let padraoWeb: ReplayDaApp = "desconhecido", padraoMobile: ReplayDaApp = "desconhecido", lido = false;
  for (const [schema, interpretar, mobile] of [[SCHEMA_WEB, replayWeb, false], [SCHEMA_MOBILE, replayMobile, true]] as const) {
    try {
      const r = await cliente.chamar("GET", SETTINGS, undefined, { schemaIds: schema, fields: "scope,value", pageSize: "500" });
      if (r.status !== 200 || !Array.isArray(r.dados?.items)) continue;
      lido = true;
      for (const o of r.dados.items as { scope?: string; value?: unknown }[]) {
        const estado = interpretar(o.value);
        if (o.scope === "environment") { if (mobile) padraoMobile = estado; else padraoWeb = estado; }
        else if (o.scope) porEscopo.set(o.scope, estado);
      }
    } catch { /* sem permissão ou fora da plataforma: desconhecido */ }
  }
  return { porEscopo, padraoWeb, padraoMobile, lido };
}

let cacheReplay: { em: number; valor: Promise<ReplayApps> } | null = null;
/** A mesma leitura para todas as telas, válida por 5 min. */
export function replayAppsCompartilhado(): Promise<ReplayApps> {
  if (!cacheReplay || Date.now() - cacheReplay.em > VALIDADE_MS) {
    const valor = lerReplayApps().catch(() => DESCONHECIDO);
    cacheReplay = { em: Date.now(), valor };
  }
  return cacheReplay.valor;
}
/** Só para testes e para a prévia: substitui a leitura. */
export function definirReplayApps(valor: ReplayApps | null) { cacheReplay = valor ? { em: Date.now(), valor: Promise.resolve(valor) } : null; }

/** Escopo de Settings da aplicação: web = APPLICATION-<id>; mobile (id em UUID) = a entidade da lista de aplicações. */
export const escopoDaApp = (app: string, apps: AppInfo[]): { escopo: string | null; mobile: boolean } => {
  const mobile = app.includes("-");
  const entidade = apps.find((a) => a.id === app)?.entidade ?? null;
  if (entidade) return { escopo: entidade, mobile: entidade.startsWith("MOBILE_APPLICATION-") };
  return { escopo: mobile ? null : /^[0-9a-f]{16}$/i.test(app) ? `APPLICATION-${app.toUpperCase()}` : null, mobile };
};

/** Estado do replay num escopo de Settings (objeto próprio, senão o padrão do ambiente do tipo da aplicação). */
export function replayPorEscopo(escopo: string | null, mobile: boolean, mapa: ReplayApps | null): ReplayDaApp {
  if (!mapa || !mapa.lido) return "desconhecido";
  if (escopo && mapa.porEscopo.has(escopo)) return mapa.porEscopo.get(escopo)!;
  return mobile ? mapa.padraoMobile : mapa.padraoWeb;
}
/** Estado do replay na aplicação (pelo id da aplicação RUM e a lista de aplicações da tela). */
export function replayDaApp(app: string, apps: AppInfo[], mapa: ReplayApps | null): ReplayDaApp {
  const { escopo, mobile } = escopoDaApp(app, apps);
  return replayPorEscopo(escopo, mobile, mapa);
}

/** O botão Replay de uma sessão: ativo só com has_replay = true; senão cinza, com o motivo. */
export interface EstadoReplay { ativo: boolean; motivo: string | null }
export function estadoReplay(hasReplay: boolean | null, daApp: ReplayDaApp, temCrash = false): EstadoReplay {
  if (hasReplay === true) return { ativo: true, motivo: null };
  if (daApp === "desligado") return { ativo: false, motivo: t("Session Replay desligado nesta aplicação (Settings › Web and mobile monitoring › Enablement and cost control)", "Session Replay is turned off for this application (Settings › Web and mobile monitoring › Enablement and cost control)") };
  if (daApp === "so_crash" && !temCrash) return { ativo: false, motivo: t("Esta aplicação grava replay só em crash, e esta sessão não teve crash", "This application records replay only on crash, and this session had no crash") };
  if (hasReplay === false) return { ativo: false, motivo: t("Esta sessão não tem replay (não gravado pelo agente, amostragem de custo ou navegador sem suporte)", "This session has no replay (not recorded by the agent, cost sampling or unsupported browser)") };
  return { ativo: true, motivo: t("Abre a sessão no Users & Sessions. O replay aparece lá quando foi gravado; o Dynatrace grava a sessão alguns minutos depois que ela termina.", "Opens the session in Users & Sessions. The replay shows there when it was recorded; Dynatrace records the session a few minutes after it ends.") };
}

/** Rótulo dos botões que abrem a lista de sessões: "e Replay" só quando a aplicação grava replay (ou não se sabe). */
export const rotuloVerSessoes = (daApp: ReplayDaApp) => (daApp === "desligado" ? t("Ver sessões", "See sessions") : t("Ver sessões e Replay", "See sessions and Replay"));

/** Hook: o mapa compartilhado (null enquanto lê). */
export function useReplayApps(): ReplayApps | null {
  const [mapa, setMapa] = useState<ReplayApps | null>(null);
  useEffect(() => { let vivo = true; replayAppsCompartilhado().then((m) => { if (vivo) setMapa(m); }); return () => { vivo = false; }; }, []);
  return mapa;
}
