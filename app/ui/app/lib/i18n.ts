/* Idioma da interface: português (padrão) ou inglês, escolhido por quem usa (seletor PT | EN no cabeçalho) e lembrado
   neste navegador. Termos que ficam melhor em inglês continuam em inglês nos dois idiomas: Flow, Force, trace, crash,
   HTTP, p75, Error Inspector, Distributed Tracing, Smartscape, Session Replay, API, WebView, frontend, backend.
   O idioma fica em globalThis.__DEF_IDIOMA: os módulos de lib/ que os scripts em Node também usam (graph, destaques,
   qualidade, inicio, prerequisitos) leem dali com uma cópia local de t(), sem import de valor entre módulos. */
export type Idioma = "pt" | "en";
const CHAVE = "def.idioma";
type Global = { __DEF_IDIOMA?: Idioma };
const lerSalvo = (): Idioma => { try { return localStorage.getItem(CHAVE) === "en" ? "en" : "pt"; } catch { return "pt"; } };
(globalThis as Global).__DEF_IDIOMA = lerSalvo();

export const idiomaAtual = (): Idioma => ((globalThis as Global).__DEF_IDIOMA === "en" ? "en" : "pt");
export function definirIdioma(i: Idioma) {
  (globalThis as Global).__DEF_IDIOMA = i;
  try { localStorage.setItem(CHAVE, i); } catch { /* sem armazenamento: vale até recarregar */ }
}
/** Texto no idioma atual: t("Sessões", "Sessions"). */
export const t = (pt: string, en: string) => (idiomaAtual() === "en" ? en : pt);
/** Localidade de números e datas do idioma atual. */
export const localidade = () => (idiomaAtual() === "en" ? "en-US" : "pt-BR");
