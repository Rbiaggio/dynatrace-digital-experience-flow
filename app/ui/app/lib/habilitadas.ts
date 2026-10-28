/* Aplicações habilitadas no DEF (as marcadas na tela de Configuração): para o fluxo mostrar só elas, e não toda
   aplicação que ainda tem dado na janela (uma aplicação desligada continua nas métricas até a janela passar).
   Fonte: a regra de roteamento de user.events (Settings); quem não tem permissão de ler Settings usa a cópia que o
   "Aplicar" grava no App State. Sem nenhuma das duas, null (o app mostra tudo). */
import { stateClient } from "@dynatrace-sdk/client-state";
import { clientePlataforma } from "./plataforma";
import { lerAppsHabilitadas } from "./prerequisitos";

const CHAVE = "rum-flow.apps-habilitadas.v1";

export async function carregarHabilitadas(): Promise<Set<string> | null> {
  try {
    const ids = await lerAppsHabilitadas(clientePlataforma);
    if (ids) return new Set(ids);
  } catch { /* sem permissão de Settings: tenta o App State */ }
  try {
    const estado = await stateClient.getAppState({ key: CHAVE });
    const ids = JSON.parse(estado.value);
    if (Array.isArray(ids)) return new Set(ids.map(String));
  } catch { /* nunca gravado */ }
  return null;
}

/** Grava a lista depois de um "Aplicar" bem-sucedido (lida por quem não pode ler Settings). */
export async function salvarHabilitadas(ids: string[]): Promise<void> {
  try { await stateClient.setAppState({ key: CHAVE, body: { value: JSON.stringify(ids) } }); } catch { /* sem permissão de App State */ }
}
