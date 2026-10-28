/* A análise da IA da Dynatrace (API de conversa do Davis CoPilot, generativa) como o usuário que clicou: sem workflow,
   sem abrir o chat. Uma análise por CENÁRIO (página + o erro: lib/inicio.ts ErroCliente.chave), não por pessoa, janela
   ou filtro: quem fez primeiro deixa pronta para todos por 24 horas (App State do DEF), e ninguém gera outra para o
   mesmo cenário nesse tempo. Se alguém já está gerando, quem chega espera a resposta dessa pessoa. */
import { httpClient } from "@dynatrace-sdk/http-client";
import { lerCache, gravarCache, resumo } from "./cache";
import { finalizarRelatorio, type PerguntaAssist } from "./assist";
import { t } from "./i18n";

const URL = "/platform/davis/copilot/v1/skills/conversations:message";
export const VALIDADE_ANALISE_MS = 24 * 3600e3;
const TTL_ANDAMENTO = 3 * 60000, ESPERA_MS = 4000;

export interface AnaliseIA {
  texto: string; quando: number; segundos: number;
  /** quem gerou e o período dos dados que ela viu (a tela de quem abre depois pode ter outra janela) */
  por: string; periodo: string;
  cenario: string;
}
export type FaseIA = "evidencias" | "ia" | "aguardando";

/** Chave das análises: "assist." + resumo (lib/cache.ts) do cenário inteiro. É a mesma da 1.30.2: as análises guardadas
    continuam valendo: a troca do cache para a v2 não as esvazia e a leitura procura a chave da v1 quando não acha a nova. */
const kAnalise = (cenario: string) => `assist.${resumo(cenario)}`;
const kAndamento = (cenario: string) => `assist-andamento.${resumo(cenario)}`;

/** A análise pronta deste cenário (se alguém já fez nas últimas 24 h). */
export async function analiseGuardada(cenario: string): Promise<AnaliseIA | null> {
  const c = await lerCache<AnaliseIA>(kAnalise(cenario), VALIDADE_ANALISE_MS);
  return c && c.dados.cenario === cenario ? c.dados : null;
}

const espera = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

async function perguntar(p: PerguntaAssist): Promise<string> {
  const r = await httpClient.send({
    url: URL, method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
    body: { text: p.prompt, context: [{ type: "supplementary", value: p.contexto }, { type: "instruction", value: p.instrucao }] },
    requestBodyType: "json", statusValidator: () => true,
  });
  let d: { text?: string; status?: string; error?: { message?: string } } | string | null = null;
  try { d = await r.body("json"); } catch { try { d = await r.body("text"); } catch { d = null; } }
  const msg = typeof d === "string" ? d : d?.error?.message ?? "";
  if (r.status === 403) throw new Error(t("Sem permissão para usar a IA da Dynatrace: peça davis-copilot:conversations:execute (e IA generativa ligada no ambiente).", "No permission to use Dynatrace AI: ask for davis-copilot:conversations:execute (and generative AI enabled in the environment)."));
  if (r.status === 429) throw new Error(t("Limite de pedidos de IA atingido (25 por pessoa a cada 15 minutos). Tente de novo em alguns minutos.", "AI request limit reached (25 per person every 15 minutes). Try again in a few minutes."));
  if (r.status !== 200) throw new Error(`${t("A IA da Dynatrace não respondeu", "Dynatrace AI did not answer")}: HTTP ${r.status}${msg ? ` · ${msg}` : ""}`);
  const o = (typeof d === "object" && d) || {};
  if (o.status === "FAILED" || !o.text?.trim()) throw new Error(t("A IA da Dynatrace não conseguiu montar a análise. Tente de novo.", "Dynatrace AI could not build the analysis. Try again."));
  return o.text;
}

/** A análise do cenário: a pronta, a que outra pessoa está gerando, ou uma nova (só se não houver nenhuma das duas). */
export async function analisarComIA(cenario: string, montar: () => Promise<PerguntaAssist>, quem: { por: string; periodo: string }, aoFase: (f: FaseIA, por?: string) => void): Promise<AnaliseIA & { reaproveitada: boolean }> {
  const pronta = await analiseGuardada(cenario);
  if (pronta) return { ...pronta, reaproveitada: true };
  const a = await lerCache<{ ativo: boolean; por: string }>(kAndamento(cenario), TTL_ANDAMENTO);
  if (a?.dados.ativo) {
    aoFase("aguardando", a.dados.por);
    const limite = Date.now() + TTL_ANDAMENTO - a.idadeMs;
    while (Date.now() < limite) {
      await espera(ESPERA_MS);
      const p2 = await analiseGuardada(cenario);
      if (p2) return { ...p2, reaproveitada: true };
      const a2 = await lerCache<{ ativo: boolean }>(kAndamento(cenario), TTL_ANDAMENTO);
      if (!a2?.dados.ativo) break;                       // a outra análise falhou: gera a nossa
    }
  }
  await gravarCache(kAndamento(cenario), { ativo: true, por: quem.por }, { validadeMs: TTL_ANDAMENTO });
  const inicio = Date.now();
  try {
    aoFase("evidencias");
    const p = await montar();
    aoFase("ia");
    const texto = finalizarRelatorio(await perguntar(p));
    const res: AnaliseIA = { texto, quando: Date.now(), segundos: Math.round((Date.now() - inicio) / 1000), por: quem.por, periodo: quem.periodo, cenario };
    // pronta para todos por 24 h (a validade padrão do cache é de 5 min), contadas de quando a análise começou
    await gravarCache(kAnalise(cenario), res, { desde: inicio, validadeMs: VALIDADE_ANALISE_MS });
    await gravarCache(kAndamento(cenario), { ativo: false, por: quem.por }, { validadeMs: TTL_ANDAMENTO });
    return { ...res, reaproveitada: false };
  } catch (e) {
    await gravarCache(kAndamento(cenario), { ativo: false, por: quem.por }, { validadeMs: TTL_ANDAMENTO }).catch(() => undefined);
    throw e;
  }
}
