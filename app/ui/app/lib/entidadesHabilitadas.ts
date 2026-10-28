/* Entidades das aplicações habilitadas, sem consulta paga (1.45.9). Web: a entidade é o próprio id em maiúsculas
   (APPLICATION-<ID>). Mobile: a entidade sai do UUID que a Configuração guarda no App State (lib/idsMobile.ts); sem ele, a
   aplicação fica de fora (a cadeia do backend dela é lida por escopo, pelo modelo de entidades, a 0 bytes). Substitui a
   leitura de 7 dias dos agregados que o backend global fazia só para listar as entidades (BCK-06, GiBs por abertura do
   Flow num ambiente grande). Os nomes saem do modelo de entidades (consulta de entidade não é cobrada). */
import { lerIdsMobile } from "./idsMobile";

export async function entidadesHabilitadas(ids: Iterable<string>): Promise<Map<string, string>> {
  const porUuid = new Map(Object.entries(await lerIdsMobile()).map(([entidade, uuid]) => [uuid, entidade]));
  const out = new Map<string, string>();   // id da aplicação -> entidade
  for (const id of ids) {
    if (!id) continue;
    if (!id.includes("-")) out.set(id, `APPLICATION-${id.toUpperCase()}`);
    else { const e = porUuid.get(id); if (e) out.set(id, e); }
  }
  return out;
}

/** Nomes das entidades (web e mobile), do modelo de entidades: uma linha por entidade (id, nome). */
export const qNomesEntidades = (entidades: string[]) => {
  const web = entidades.filter((e) => e.startsWith("APPLICATION-")), mob = entidades.filter((e) => e.startsWith("MOBILE_APPLICATION-"));
  const lista = (xs: string[]) => `array(${xs.map((x) => `"${x.replace(/[^A-Z0-9_-]/gi, "")}"`).join(", ")})`;
  const partes = [web.length ? `fetch dt.entity.application, from: now()-30d | filter in(id, ${lista(web)}) | fields id, nome = entity.name` : "",
                  mob.length ? `fetch dt.entity.mobile_application, from: now()-30d | filter in(id, ${lista(mob)}) | fields id, nome = entity.name` : ""].filter(Boolean);
  return partes.length === 2 ? `${partes[0]}\n| append [${partes[1]}]` : partes[0] ?? null;
};
