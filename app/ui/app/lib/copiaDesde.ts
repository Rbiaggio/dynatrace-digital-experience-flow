/* Quando a cópia das sessões começou neste ambiente (1.47.4): o "Aplicar" da Configuração grava a hora em que criou os
   buckets da cópia (instalação nova). A ação não analisa as horas que terminaram antes disso (a cópia estava vazia, e a
   primeira execução lia os spans de 23 horas à toa) e a Visão geral diz quando sai a primeira hora analisada. Sem o
   registro (instalação de antes da 1.47.4, ou buckets que já existiam), tudo segue como antes. App State: leitura e
   gravação não são cobradas; vale 2 dias (depois disso nenhuma hora conferida é anterior à cópia). */
import { stateClient } from "@dynatrace-sdk/client-state";

export const CHAVE_COPIA = "rum-flow.copia.v1";

export async function lerCopiaDesde(): Promise<number | null> {
  try {
    const v = JSON.parse((await stateClient.getAppState({ key: CHAVE_COPIA })).value) as { desde?: unknown };
    return typeof v?.desde === "number" && v.desde > 0 ? v.desde : null;
  } catch { return null; }
}

export async function gravarCopiaDesde(desde: number): Promise<void> {
  try { await stateClient.setAppState({ key: CHAVE_COPIA, body: { value: JSON.stringify({ desde }), validUntilTime: "now+2d" } }); } catch { /* sem permissão de App State */ }
}
