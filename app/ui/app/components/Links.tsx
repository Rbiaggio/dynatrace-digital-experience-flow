import React from "react";
import { getIntentLink } from "@dynatrace-sdk/navigation";
import { t, localidade } from "../lib/i18n";
import { estadoReplay, type ReplayDaApp } from "../lib/replay";
import { BugReportIcon, ReplayIcon, UserSessionsIcon } from "@dynatrace/strato-icons";

/** Links nativos do Dynatrace (intents), usados pelo painel de detalhes, pela análise de abandono da jornada e pela lista
    de sessões da visão geral. As chaves vêm do manifesto dos apps no registry do tenant:
    Distributed Tracing: "view-trace" exige `trace.id`; Error Inspector: "inspect-errors-of-frontend" (aplicação, página,
    tipo, período) e "inspect-errors-of-session"; Users & Sessions: replay e detalhe da sessão por `dt.rum.session.id`.
    Fora da plataforma getIntentLink lança; aí não há link. */
export function linkIntent(payload: Record<string, unknown>, appId?: string, intentId?: string): string | null {
  try {
    const p = payload as Parameters<typeof getIntentLink>[0];
    return appId && intentId ? getIntentLink(p, appId, intentId) : getIntentLink(p);
  } catch { return null; }
}

/** Janela do app ("30m", "2h", "ini/fim") como intervalo absoluto, para os links nativos. Janela relativa termina em
    `agora` (por padrão, neste instante; para descrever números já lidos, passe o momento da leitura). */
export const intervaloDe = (janela: string, agora = Date.now()) => {
  const m = /^(\d+)([smhd])$/.exec(janela);
  if (m) { const ms = +m[1] * ({ s: 1e3, m: 6e4, h: 36e5, d: 864e5 } as Record<string, number>)[m[2]]; const fim = new Date(agora); return { from: new Date(fim.getTime() - ms).toISOString(), to: fim.toISOString() }; }
  const [ini, fim] = janela.split("/");
  return { from: ini, to: fim ?? new Date().toISOString() };
};

/** Hora local (HH:MM:SS) no formato do idioma. */
export const hora = (iso: string | null) => { if (!iso) return ""; const d = new Date(iso); return isNaN(d.getTime()) ? iso : d.toLocaleTimeString(localidade(), { hour: "2-digit", minute: "2-digit", second: "2-digit" }); };

/** Entidade da aplicação RUM (o Error Inspector filtra por ela): a da lista ou, na web, APPLICATION-<id>. */
export const entidadeDaApp = (apps: { id: string; entidade?: string | null }[], app: string | null) =>
  apps.find((a) => a.id === app)?.entidade ?? (app && /^[0-9a-f]{16}$/.test(app) ? `APPLICATION-${app.toUpperCase()}` : null);

/** Erros do NAVEGADOR de uma página no Error Inspector (aplicação, página, tipo e período). */
export const hrefErrosPagina = (entidade: string | null, view: string, janela: string, tipo?: string) =>
  entidade ? linkIntent({ "dt.rum.application.entity": entidade, "view.name": view, ...(tipo ? { "error.type": tipo } : {}), "dt.timeframe": intervaloDe(janela) }, "dynatrace.error.inspector", "inspect-errors-of-frontend") : null;

/** Erro do NAVEGADOR (JS ou requisição) abre no Error Inspector, filtrado pela aplicação, página e tipo. (Antes abria as
    exceções do Distributed Tracing, que são do backend: em aplicações reais a tela vinha com erro e sem o erro do navegador.) */
export const LinkErroInspector: React.FC<{ entidade: string | null; view: string; tipo?: string; janela: string; children: React.ReactNode; titulo?: string }> = ({ entidade, view, tipo, janela, children, titulo }) => {
  const href = hrefErrosPagina(entidade, view, janela, tipo);
  return href ? <a className="painel-link erro" href={href} target="_blank" rel="noreferrer" title={titulo ?? t("Abrir no Error Inspector (esta aplicação, página e tipo de erro)", "Open in Error Inspector (this application, page and error type)")}>{children} ↗</a> : <span className="erro">{children}</span>;
};

/** Link externo; fora da plataforma vira texto. */
export const Acao: React.FC<{ href: string | null; rotulo: string; titulo: string; icone?: React.ReactNode }> = ({ href, rotulo, titulo, icone }) =>
  href ? <a className="painel-link acao-icone" href={href} target="_blank" rel="noreferrer" title={titulo}>{icone}{rotulo} ↗</a> : <span className="sem acao-icone" title={t("fora da plataforma", "outside the platform")}>{icone}{rotulo}</span>;

/** Replay, Sessão e Erros de uma sessão (Users & Sessions e Error Inspector). O Replay segue a configuração de replay da
    aplicação: ativo quando ela grava (ou não se sabe), cinza com o motivo quando não grava (lib/replay.ts). */
export const LinksSessao: React.FC<{ id: string; inicio: string | null; fim: string | null; hasReplay: boolean | null; temErro: boolean; replayDaApp?: ReplayDaApp; temCrash?: boolean }> = ({ id, inicio, fim, hasReplay, temErro, replayDaApp = "desconhecido", temCrash = false }) => {
  const estado = estadoReplay(hasReplay, replayDaApp, temCrash);
  const replay = estado.ativo ? linkIntent({ "dt.rum.session.id": id, start_time: inicio, end_time: fim }, "dynatrace.users.sessions", "open-session-replay-classic-page") : null;
  const sessao = linkIntent({ "dt.rum.session.id": id, start_time: inicio }, "dynatrace.users.sessions", "session-details-from-event");
  const erros = temErro ? linkIntent({ "dt.rum.session.id": id }, "dynatrace.error.inspector", "inspect-errors-of-session") : null;
  return (
    <span className="jf-sessao-acoes">
      {estado.ativo
        ? <Acao href={replay} icone={<ReplayIcon size={14} />} rotulo="Replay" titulo={estado.motivo ?? t("Abrir o Session Replay desta sessão", "Open the Session Replay of this session")} />
        : <span className="acao-icone sem-replay" aria-disabled="true" title={estado.motivo ?? undefined}><ReplayIcon size={14} />Replay</span>}
      <Acao href={sessao} icone={<UserSessionsIcon size={14} />} rotulo={t("Sessão", "Session")} titulo={t("Abrir a sessão em Users & Sessions", "Open the session in Users & Sessions")} />
      {temErro && <Acao href={erros} icone={<BugReportIcon size={14} />} rotulo={t("Erros", "Errors")} titulo={t("Abrir os erros desta sessão no Error Inspector", "Open this session's errors in Error Inspector")} />}
    </span>
  );
};
