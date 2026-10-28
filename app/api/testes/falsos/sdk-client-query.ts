/* @dynatrace-sdk/client-query falso: os testes da análise por LLM injetam o executor das consultas (lib/dossie.ts);
   uma consulta que chegue aqui é erro do teste. */
export const queryExecutionClient = {
  queryExecute: async () => { throw new Error("consulta sem executor injetado (teste)"); },
  queryPoll: async () => { throw new Error("consulta sem executor injetado (teste)"); },
};
