/* Frames das últimas 24 h no App State (1.45.10): a ação grava a cada hora analisada (lib/quadros.ts, juntarHoraQuadros)
   e a tela lê ao montar o grafo. Leitura e gravação de App State não são cobradas. */
import { stateClient } from "@dynatrace-sdk/client-state";
import { componentesDe, type EstadoQuadros } from "./quadros";
import { usarComponentes } from "./queries";

export const CHAVE_QUADROS = "rum-flow.quadros.v1";

export async function lerQuadros(): Promise<EstadoQuadros | null> {
  try {
    const v = JSON.parse((await stateClient.getAppState({ key: CHAVE_QUADROS })).value) as EstadoQuadros;
    return v && v.v === 1 && v.horas && typeof v.horas === "object" ? v : null;
  } catch { return null; }
}
export async function gravarQuadros(e: EstadoQuadros): Promise<void> {
  await stateClient.setAppState({ key: CHAVE_QUADROS, body: { value: JSON.stringify(e), validUntilTime: "now+2d" } });
}

/** Os frames das 24 h (componentesDe) para a tela, relidos no máximo a cada 5 min; também valem para as leituras por
    sessão (usarComponentes, lib/queries.ts). */
let memo: { em: number; m: Map<string, string> } | null = null;
export async function carregarComponentes(): Promise<Map<string, string>> {
  if (memo && Date.now() - memo.em < 5 * 60000) return memo.m;
  const m = componentesDe(await lerQuadros(), Date.now());
  memo = { em: Date.now(), m };
  usarComponentes(m);
  return m;
}
