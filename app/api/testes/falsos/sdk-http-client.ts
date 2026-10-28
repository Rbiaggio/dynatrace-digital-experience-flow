/* @dynatrace-sdk/http-client falso: guarda os envios (e-mail da plataforma) e responde 202. */
const g = globalThis as unknown as { __DEF_HTTP?: { url: string; body: unknown }[] };
export const enviados = (g.__DEF_HTTP ??= []);
export const httpClient = {
  async send(o: { url: string; body?: unknown }) { enviados.push({ url: o.url, body: o.body }); return { status: 202, body: async () => ({}) }; },
};
