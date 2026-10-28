/* Quem pode ver a engrenagem: quem tem permissão de escrever no OpenPipeline e nas definições de bucket.
   (Para permissões de Settings a resolução sempre volta "condition", por isso não são usadas aqui.) */
import { effectivePermissionsClient } from "@dynatrace-sdk/client-platform-management-service";
import { clientePlataforma } from "./plataforma";

/** O Dynatrace Assist do app aparece para quem tem a permissão de IA generativa da plataforma, a mesma que o Dynatrace
    Assist exige (a política de acesso decide, não o ambiente nem o e-mail). A análise por LLM NÃO usa esta permissão:
    a função dela no servidor só aceita a lista de liberados do llm.local.ts. Sem o escopo de resolução ou com erro: desligado (nada de IA
    por engano). "condition" conta como concedida (a permissão não tem condição). */
export const PERMISSAO_IA = "davis-copilot:conversations:execute";
export async function podeUsarIA(): Promise<boolean> {
  try {
    const r = await effectivePermissionsClient.resolveEffectivePermissions({ body: { permissions: [{ permission: PERMISSAO_IA }] } });
    const lista = (r as any)?.effectivePermissions ?? (r as any)?.permissions ?? r;
    return Array.isArray(lista) && lista.some((p: any) => p.permission === PERMISSAO_IA && (p.granted === true || p.granted === "true" || p.granted === "condition"));
  } catch { return false; }
}

export async function podeConfigurar(): Promise<boolean> {
  try {
    const r = await effectivePermissionsClient.resolveEffectivePermissions({
      body: { permissions: [{ permission: "openpipeline:configurations:write" }, { permission: "storage:bucket-definitions:write" }] },
    });
    const lista = (r as any)?.effectivePermissions ?? (r as any)?.permissions ?? r;
    if (Array.isArray(lista) && lista.length) return lista.every((p: any) => p.granted === true || p.granted === "true");
  } catch { /* sem o escopo de resolução: cai na verificação abaixo */ }
  // reserva: testa a GRAVAÇÃO sem gravar nada (validação de um pipeline vazio; corpo de bucket inválido). 403 = sem
  // permissão. Antes testava só a leitura de buckets e mostrava a engrenagem para quem só lê.
  try {
    const s = await clientePlataforma.chamar("POST", "/platform/classic/environment-api/v2/settings/objects", [{ schemaId: "builtin:openpipeline.user.events.pipelines", scope: "environment", value: {} }], { validateOnly: "true" });
    const b = await clientePlataforma.chamar("POST", "/platform/storage/management/v1/bucket-definitions", {});
    return s.status !== 403 && s.status !== 401 && b.status !== 403 && b.status !== 401;
  } catch { return false; }
}
