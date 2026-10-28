/* As dependências reais da função "analise-llm": App State do app (@dynatrace-sdk/client-state), identidade e
   ambiente da plataforma (@dynatrace-sdk/app-environment: na app function vêm do token de quem chamou, não do
   navegador), configuração local do LLM (llm.local.ts, fora do git) e o envio de e-mail da plataforma (desligado). */
import { stateClient } from "@dynatrace-sdk/client-state";
import { getAppVersion, getCurrentUserDetails, getEnvironmentId, getEnvironmentUrl } from "@dynatrace-sdk/app-environment";
import { httpClient } from "@dynatrace-sdk/http-client";
import { LLM } from "./llm.local";
import type { Dependencias } from "./analiseLlm";
import type { ConfigLLM } from "./chamadaLlm";
import type { Estado } from "./usoLlm";

const naoEncontrado = (e: unknown) => {
  const x = e as { name?: string; isNotFound?: boolean; response?: { status?: number }; statusCode?: number; body?: { error?: { code?: number } } };
  return x?.name === "NotFound" || x?.isNotFound === true || x?.response?.status === 404 || x?.statusCode === 404 || x?.body?.error?.code === 404;
};
const iso = (d: unknown) => (d instanceof Date ? d.toISOString() : typeof d === "string" ? d : null);

/** App State do app pela regra de uso. Só "não existe" vira null; qualquer outra falha sobe. */
export const estadoAppState: Estado = {
  async ler(chave) {
    try {
      const r = await stateClient.getAppState({ key: chave });
      return { valor: r.value ?? "", modificadoEm: iso(r.modificationInfo?.lastModifiedTime) };
    } catch (e) {
      if (naoEncontrado(e)) return null;
      throw e;
    }
  },
  async gravar(chave, valor, validade) {
    await stateClient.setAppState({ key: chave, body: validade ? { value: valor, validUntilTime: validade } : { value: valor } });
  },
  async listar(prefixo) {
    const lista = await stateClient.getAppStates({ filter: `key starts-with '${prefixo.replace(/'/g, "\\'")}'`, addFields: "value,modificationInfo" });
    return lista.map((x) => ({ chave: x.key, valor: x.value ?? "", modificadoEm: iso(x.modificationInfo?.lastModifiedTime) }));
  },
};

/** E-mail pela API da plataforma (POST /platform/email/v1/emails, escopo email:emails:send). Só é chamado com
    EMAIL_ADMINS.habilitado = true. Validar o formato do corpo no tenant antes de ligar. */
export async function enviarEmailPlataforma(para: string[], assunto: string, corpo: string): Promise<void> {
  const r = await httpClient.send({
    url: "/platform/email/v1/emails", method: "POST", requestBodyType: "json", statusValidator: () => true,
    headers: { "content-type": "application/json" },
    body: { toRecipients: { emailAddresses: para }, subject: assunto, body: { contentType: "text/plain", body: corpo } },
  });
  if (r.status >= 300) throw new Error(`e-mail: HTTP ${r.status}`);
}

export function dependenciasReais(): Dependencias {
  return {
    estado: estadoAppState,
    usuario: () => { const u = getCurrentUserDetails(); return { id: u.id, nome: u.name, email: u.email }; },
    ambiente: () => ({ id: getEnvironmentId(), url: getEnvironmentUrl() }),
    versaoApp: () => getAppVersion(),
    llm: LLM as ConfigLLM,
    enviarEmail: enviarEmailPlataforma,
    log: (m) => console.log(m),
  };
}
