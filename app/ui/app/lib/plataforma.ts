/* Cliente HTTP da plataforma com a identidade do usuário logado (SDK do dt-app). As chamadas vão para
   /platform/... do próprio tenant; o que o usuário pode fazer depende das políticas IAM dele (README, Permissões). */
import { httpClient } from "@dynatrace-sdk/http-client";
import { ClienteHttp, RespostaHttp } from "./prerequisitos";

export const clientePlataforma: ClienteHttp = {
  async chamar(metodo: string, url: string, corpo?: unknown, params?: Record<string, string>): Promise<RespostaHttp> {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    const resposta = await httpClient.send({
      url: url + qs, method: metodo,
      headers: corpo !== undefined ? { "content-type": "application/json" } : {},
      body: corpo !== undefined ? corpo : undefined,
      requestBodyType: "json",
      statusValidator: () => true,                 // tratamos o status nós mesmos (400 traz a mensagem do servidor)
    });
    let dados: any = null;
    try { dados = await resposta.body("json"); } catch { try { dados = await resposta.body("text"); } catch { dados = null; } }
    return { status: resposta.status, dados };
  },
};
