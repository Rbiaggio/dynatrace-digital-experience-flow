/* Como os números se atualizam (1.46.0): escolha do administrador na Configuração, guardada no App State do app e igual
   para todos os usuários.
   - "tempo-real" (padrão): erros, Apdex e os números do grafo vão até agora. Cada abertura lê, além das fatias de 5 min
     gravadas pelo workflow, a cópia dos minutos que ainda não viraram fatia (cabeça e cauda, lib/aovivo.ts).
   - "5min": os mesmos números vão até a última fatia gravada (de 5 a 10 min atrás). A abertura lê só o que o workflow já
     agregou; nada da cópia ao vivo. O workflow, as fatias e as horas analisadas são os mesmos nos dois modos.
   O que lê a cópia por sessão (lista de sessões, funis com filtro, "Por quê?", robôs, frames, filtro de segmento) continua
   lendo a cópia do período nos dois modos. */
import { stateClient } from "@dynatrace-sdk/client-state";
import { usarSemTempoReal } from "./agregados";
import { usarVarianteCache } from "./cache";

export const CHAVE_ATUALIZACAO = "rum-flow.atualizacao.v1";
export type ModoAtualizacao = "tempo-real" | "5min";

export async function lerModoAtualizacao(): Promise<ModoAtualizacao> {
  try {
    const v = JSON.parse((await stateClient.getAppState({ key: CHAVE_ATUALIZACAO })).value) as { modo?: unknown };
    return v?.modo === "5min" ? "5min" : "tempo-real";
  } catch { return "tempo-real"; }
}
/** Grava a escolha; false = sem permissão de gravar o App State do app (a tela avisa). */
export async function gravarModoAtualizacao(modo: ModoAtualizacao): Promise<boolean> {
  try { await stateClient.setAppState({ key: CHAVE_ATUALIZACAO, body: { value: JSON.stringify({ v: 1, modo }) } }); return true; }
  catch { return false; }
}
/** Liga o modo nas leituras desta aba (antes da primeira leitura de dado). */
export function aplicarModoAtualizacao(modo: ModoAtualizacao) {
  usarSemTempoReal(modo === "5min");
  usarVarianteCache(modo === "5min" ? "f5" : "");
}
