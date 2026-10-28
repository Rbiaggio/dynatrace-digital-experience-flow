/* UUID de cada aplicação mobile (1.45.3). O RUM grava em dt.rum.application.id o applicationId (UUID) da aplicação
   mobile, não o id da entidade (MOBILE_APPLICATION-...) como na web, e nenhuma fonte grátis tem o par. O UUID não muda:
   achado uma vez (na cópia do DEF ou, ao marcar a aplicação, no user.events), fica no App State do app e a Configuração
   não o procura de novo. */
import { stateClient } from "@dynatrace-sdk/client-state";

export const CHAVE_IDS_MOBILE = "rum-flow.ids-mobile.v1";
/** id da entidade -> UUID */
export type IdsMobile = Record<string, string>;

export async function lerIdsMobile(): Promise<IdsMobile> {
  try {
    const v = JSON.parse((await stateClient.getAppState({ key: CHAVE_IDS_MOBILE })).value) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => typeof x === "string" && x)) as IdsMobile : {};
  } catch { return {}; }
}
export async function gravarIdsMobile(m: IdsMobile): Promise<void> {
  try { await stateClient.setAppState({ key: CHAVE_IDS_MOBILE, body: { value: JSON.stringify(m) } }); }
  catch { /* sem permissão de gravar: a Configuração procura de novo na próxima vez */ }
}
