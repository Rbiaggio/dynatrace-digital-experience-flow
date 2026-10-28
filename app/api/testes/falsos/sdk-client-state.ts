/* @dynatrace-sdk/client-state falso (só o que a função usa), em memória: NotFound com o mesmo nome do SDK, hora da
   gravação em modificationInfo (Date, como o SDK devolve com transformDates) e filtro "key starts-with". */
type Linha = { value: string; lastModifiedTime: Date; validUntil: number | null };
const g = globalThis as unknown as { __DEF_ESTADO?: Map<string, Linha>; __DEF_ESTADO_SEQ?: number };
export const memoria = (g.__DEF_ESTADO ??= new Map<string, Linha>());

class NotFound extends Error { readonly isNotFound = true; constructor(m: string) { super(m); this.name = "NotFound"; } }
const vivo = (k: string) => { const x = memoria.get(k); return x && (x.validUntil == null || x.validUntil > Date.now()) ? x : null; };

export const stateClient = {
  async getAppState({ key }: { key: string }) {
    const x = vivo(key);
    if (!x) throw new NotFound(`state ${key} not found`);
    return { value: x.value, modificationInfo: { lastModifiedBy: "teste", lastModifiedTime: x.lastModifiedTime } };
  },
  async setAppState({ key, body }: { key: string; body: { value: string; validUntilTime?: string | null } }) {
    const m = body.validUntilTime ? /^now\+(\d+)([smhd])$/.exec(body.validUntilTime) : null;
    const ms = m ? Number(m[1]) * { s: 1e3, m: 6e4, h: 36e5, d: 864e5 }[m[2] as "s"] : null;
    g.__DEF_ESTADO_SEQ = (g.__DEF_ESTADO_SEQ ?? 0) + 1;
    memoria.set(key, { value: body.value, lastModifiedTime: new Date(1.9e12 + g.__DEF_ESTADO_SEQ), validUntil: ms == null ? null : Date.now() + ms });
  },
  async getAppStates({ filter }: { filter?: string; addFields?: string }) {
    const p = /key starts-with '((?:[^'\\]|\\.)*)'/.exec(filter ?? "")?.[1]?.replace(/\\'/g, "'") ?? "";
    return [...memoria.keys()].filter((k) => k.toLowerCase().startsWith(p.toLowerCase()) && vivo(k))
      .map((k) => ({ key: k, value: memoria.get(k)!.value, modificationInfo: { lastModifiedBy: "teste", lastModifiedTime: memoria.get(k)!.lastModifiedTime } }));
  },
};
