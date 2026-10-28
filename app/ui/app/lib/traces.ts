/* Atalho de trace só quando o trace existe (1.45.6). O agente do RUM põe trace id em toda requisição, mas só a que chega a
   um serviço monitorado NESTE ambiente gera spans. É comum a maior parte dos traces mostrados pelo app não
   tinham span nenhum (chamadas a terceiros como Firebase e Crashlytics, e a um backend sem monitoramento), e o
   Distributed Tracing abria "Trace not found". Conferir todos ao mostrar sairia caro num ambiente grande (a consulta de spans paga
   por GB lido); por isso a conferência é no clique, só do trace clicado, em 10 min em volta da requisição.
   Sem dependência do SDK. */

/** Minutos para cada lado da requisição em que os spans do trace são procurados. */
export const MINUTOS_TRACE = 5;
const ehTrace = (t: string) => /^[0-9a-f]{32}$/i.test(t);

/** O trace tem spans? (uma linha, n > 0). null = id que não é de trace (não consulta). */
export function qTraceTemSpans(trace: string, quando: string): string | null {
  const t = new Date(quando).getTime();
  if (!ehTrace(trace) || isNaN(t)) return null;
  const de = new Date(t - MINUTOS_TRACE * 60000).toISOString(), ate = new Date(t + MINUTOS_TRACE * 60000).toISOString();
  return `fetch spans, from: "${de}", to: "${ate}"
| filter trace.id == toUid("${trace.toLowerCase()}")
| summarize n = count()`;
}

/** Resultado por trace nesta aba (não consulta duas vezes o mesmo). */
export const tracesConferidos = new Map<string, boolean>();
