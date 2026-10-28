/* Leitura das horas analisadas e das sessões da última hora no app (1.43; consultas e montagem em lib/horaria.ts, que não
   depende do SDK). Uma leitura das horas analisadas por minuto na aba, compartilhada pela Visão geral, o Flow e o painel. */
import { dql } from "./dql";
import { fimMinimo, lerCompartilhado } from "./compartilhado";
import { lerAgendado, type UltimaHora } from "./agendado";
import { LIMITE_LIGACAO_GLOBAL } from "./queries";
import { qHorasAnalisadas, periodosDasHoras, qLigacao24, qUltimaHora, ultimaHoraParaLinhas, qSessoes24, qReq24, sessoes24ParaPartes, req24ParaPartes, MS_HORA,
         type PeriodoHoras, type ParteHora, type PartesSessoes24, type PartesReq24, type HorasAnalisadas } from "./horaria";
import { t } from "./i18n";

/** A chave das jornadas salvas (a mesma da ação, lib/horaria.ts chaveJornadas): os funis das 24 h são os desta lista. */
let chaveFunis: string | null = null;
export const usarChaveFunis = (k: string | null) => { chaveFunis = k; };
export const chaveFunisEmUso = () => chaveFunis;
let lidas: { em: number; chave: string; p: Partial<Record<ParteHora, PeriodoHoras>> } | null = null;
/** As horas analisadas de cada parte: do App State que a tarefa "hora" grava a cada execução (1.44.4, sem leitura no
    Grail); sem ele (workflow parado há mais de 40 min) ou com outra chave de jornadas, H-00 no bucket de horas. Relidas no
    máximo a cada minuto (e depois do Atualizar). */
export async function lerHoras(): Promise<Partial<Record<ParteHora, PeriodoHoras>>> {
  const k = chaveFunis ?? "-";
  if (lidas && lidas.chave === k && Date.now() - lidas.em < 60000 && lidas.em >= fimMinimo()) return lidas.p;
  const a = await lerAgendado<HorasAnalisadas>("horas");
  if (a && (a.d?.funis ?? null) === (chaveFunis ?? null) && a.d?.periodos) {
    lidas = { em: Date.now(), chave: k, p: a.d.periodos };
    return a.d.periodos;
  }
  try {
    const p = periodosDasHoras(await dql(qHorasAnalisadas(chaveFunis), { contexto: "prereq/H-00", maxRecords: 10 }));
    lidas = { em: Date.now(), chave: k, p };
    return p;
  } catch { return lidas?.p ?? {}; }
}
/** As sessões da última hora: do workflow (App State, até 20 min) ou lidas na hora (cache compartilhado de 5 min). */
export async function lerUltimaHora(): Promise<{ t: number } & UltimaHora> {
  const a = await lerAgendado<UltimaHora>("ultimahora");
  if (a && a.t >= fimMinimo() && Array.isArray(a.d?.fins)) return { t: a.t, ...a.d };
  const b = await lerCompartilhado("inicio", JSON.stringify(["ultimahora"]), async () => {
    const agora = Date.now();
    return { t: agora, ...ultimaHoraParaLinhas(await dql(qUltimaHora(agora - MS_HORA, agora), { contexto: "inicio/INI-H", maxRecords: 30000 })) };
  }, { aceitar: (x) => !!x && Array.isArray((x as UltimaHora).fins) });
  if (!b) throw new Error(t("Sem as sessões da última hora.", "No sessions from the last hour."));
  return b.dados;
}
/** A ligação página -> serviço das 24 horas analisadas (H-08); sem hora analisada, lança (quem chama lê na hora). */
export async function lerLigacao24() {
  const p = (await lerHoras()).ligacao;
  if (!p) throw new Error("sem hora analisada");
  return dql(qLigacao24(p), { contexto: "backend/H-08", maxRecords: LIMITE_LIGACAO_GLOBAL });
}

/** As 24 horas analisadas guardadas nesta aba por 5 min (e relidas depois do Atualizar): todas as aplicações numa leitura,
    a tela filtra o escopo. */
const naAba = new Map<string, { em: number; p: Promise<unknown> }>();
function lerNaAba<T>(chave: string, ler: () => Promise<T>): Promise<T> {
  const e = naAba.get(chave);
  if (e && Date.now() - e.em < 5 * 60000 && e.em >= fimMinimo()) return e.p as Promise<T>;
  const p = ler();
  naAba.set(chave, { em: Date.now(), p });
  p.catch(() => { if (naAba.get(chave)?.p === p) naAba.delete(chave); });
  return p;
}
/** Sessões das 24 h (fins, caminhos e páginas de todas as aplicações); null sem hora analisada. */
export async function lerSessoes24(): Promise<(PartesSessoes24 & { periodo: PeriodoHoras }) | null> {
  const p = (await lerHoras()).sessoes;
  if (!p) return null;
  return lerNaAba(`ses|${p.ate}`, async () => ({ ...sessoes24ParaPartes(await dql(qSessoes24(p), { contexto: "inicio/H-SES", maxRecords: 30000 })), periodo: p }));
}
/** Requisições das 24 h (qualidade, mais lentas, valores) e o funil das jornadas de agora; null sem hora analisada. */
export async function lerReq24(): Promise<(PartesReq24 & { periodo: PeriodoHoras; funisDe: string | null }) | null> {
  const ph = await lerHoras(), p = ph.req;
  if (!p) return null;
  const pf = chaveFunis ? ph.funis ?? null : null;
  return lerNaAba(`req|${p.ate}|${pf?.ate ?? "-"}|${chaveFunis ?? "-"}`, async () => ({ ...req24ParaPartes(await dql(qReq24(p, pf, chaveFunis), { contexto: "qualidade/H-REQ", maxRecords: 30000 })), periodo: p, funisDe: pf ? chaveFunis : null }));
}
