/* Qualidade do dado: por que o fluxo de uma aplicação sai quebrado e o que o time do app precisa ajustar. Vem do jeito
   como cada app foi construído, não do DEF:
   - telas sem nome: app Android de uma Activity só: tudo vira "MainActivity" ou tela sem nome;
   - página que abre em aba nova sem origem: telas web dentro do app nativo (WebView), cada uma numa aba nova;
   - chamada sem trace: API em outro domínio: sem trace não há ligação página -> serviço;
   - frames: página montada em frames: desde a 1.45.8 o app os trata sozinho (partes da página), sem aviso.
   Só tipos importados (os scripts de teste em Node usam o mesmo arquivo). */
import type { Grafo } from "./graph";

/** wvAndroid: cargas de página vindas da WebView do Android; wvAndroidHibrido: delas, as com o monitoramento híbrido
    (dt.rum.adk "..._m"); iosHibrido: cargas com o monitoramento híbrido no iOS (1.45.5). */
export interface LinhaQualidade { app: string; navs: number; novaAbaSemOrigem: number; frames: number; semNome: number; genericas?: number; hibridas?: number;
  wvAndroid?: number; wvAndroidHibrido?: number; iosHibrido?: number; reqs: number; reqsTrace: number; dominioSemTrace: string | null }
export interface ProblemaDado { id: string; app: string; titulo: string; detalhe: string; correcao: string; quem: string }

const pct = (a: number, b: number) => (b > 0 ? Math.round((100 * a) / b) : 0);
// idioma da interface (lib/i18n.ts): cópia local, porque os scripts em Node usam este arquivo sem import de valor
const t = (pt: string, en: string) => ((globalThis as { __DEF_IDIOMA?: string }).__DEF_IDIOMA === "en" ? en : pt);
const loc = () => ((globalThis as { __DEF_IDIOMA?: string }).__DEF_IDIOMA === "en" ? "en-US" : "pt-BR");
const int = (n: number) => Math.round(n).toLocaleString(loc());
/** Nome de tela genérico de app nativo: classe Android/Java ("com.empresa.app.MainActivity", "...Activity"). */
export const ehTelaGenerica = (nome: string) => /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+\.[A-Z]\w*$/.test(nome) || /Activity$/.test(nome);

export function avaliarQualidade(g: Grafo, linhas: LinhaQualidade[], nomeApp: (id: string | null) => string): ProblemaDado[] {
  const out: ProblemaDado[] = [];
  const apps = [...new Set(g.nos.filter((n) => n.tipo === "app").map((n) => n.app ?? ""))];
  for (const app of apps) {
    const nome = nomeApp(app) || app;
    const telas = g.nos.filter((n) => n.tipo === "view" && n.app === app);
    const total = telas.reduce((s, n) => s + n.entradas, 0);
    const genericas = telas.filter((n) => ehTelaGenerica(n.nome));
    const qGen = genericas.reduce((s, n) => s + n.entradas, 0);
    const l = linhas.find((x) => x.app === app);
    const semNome = l?.semNome ?? 0, navs = l?.navs ?? 0;
    // a tela genérica quase não aparece como ligação no grafo (MainActivity -> MainActivity é recarga); conta na cópia
    const pctGen = Math.max(pct(qGen, total), pct(l?.genericas ?? 0, Math.max(navs, 1)));
    if ((total > 0 || navs > 0) && (pctGen >= 20 || pct(semNome, Math.max(navs, 1)) >= 20)) {
      const generica = genericas[0] ? ` (${genericas[0].nome})` : "";
      out.push({ id: `semnome|${app}`, app, titulo: t("Telas sem nome", "Screens without names"),
        detalhe: pctGen >= 20
          ? t(`${nome}: ${pctGen}% das telas vistas são uma tela genérica${generica}, então essas sessões não mostram fluxo.`, `${nome}: ${pctGen}% of the screen views are a generic screen${generica}, so those sessions show no flow.`)
          : t(`${nome}: ${pct(semNome, navs)}% das telas vistas chegam sem nome, então essas sessões não mostram fluxo.`, `${nome}: ${pct(semNome, navs)}% of the screen views come without a name, so those sessions show no flow.`),
        correcao: t("Dar nome a cada tela no app (Dynatrace.startView por tela, ou uma regra de nome de view). Até lá, filtre pelo sistema operacional para ver a plataforma que dá nome às telas.", "Name each screen in the app (Dynatrace.startView per screen, or a view naming rule). Until then, filter by operating system to see the platform that names its screens."),
        quem: t("time do app", "app team") });
    }
    if (!l) continue;
    // 1.45.5: WebView do Android sem o monitoramento híbrido (as cargas da WebView do Android chegam
    // sem o híbrido, enquanto no iOS chegam com ele). Diz a situação de cada plataforma.
    const wvA = l.wvAndroid ?? 0, wvAH = l.wvAndroidHibrido ?? 0, iosH = l.iosHibrido ?? 0;
    const androidSemHibrido = wvA >= 20 && pct(wvAH, wvA) < 80;
    if (androidSemHibrido) {
      const ios = iosH > 0 ? t(` No iOS o monitoramento híbrido está ligado (${int(iosH)} cargas com ele), e essas páginas já aparecem ligadas à tela do app.`, ` On iOS hybrid monitoring is on (${int(iosH)} loads with it), and those pages are already linked to the app screen.`) : "";
      out.push({ id: `hibrido-android|${app}`, app, titulo: t("WebView do Android sem monitoramento híbrido", "Android WebView without hybrid monitoring"),
        detalhe: t(`${nome}: ${int(wvA)} cargas de página vieram da WebView do app Android e ${wvAH === 0 ? "nenhuma" : `só ${pct(wvAH, wvA)}%`} traz o monitoramento híbrido. Sem ele, cada página começa um fluxo próprio, sem ligação com a tela do app que a abriu.${ios}`,
                   `${nome}: ${int(wvA)} page loads came from the Android app's WebView and ${wvAH === 0 ? "none" : `only ${pct(wvAH, wvA)}%`} carry hybrid monitoring. Without it, each page starts a flow of its own, not linked to the app screen that opened it.${ios}`),
        correcao: t("Ligar o monitoramento híbrido do agente Dynatrace na WebView do app Android, como já está no iOS. O DEF passa a ligar cada página à tela do app que a abriu.", "Enable the Dynatrace agent's hybrid monitoring for the Android app's WebView, as on iOS. DEF then links each page to the app screen that opened it."),
        quem: t("time do app Android", "Android app team") });
    }
    // com o monitoramento híbrido ligado (dt.rum.adk) o DEF costura a WebView na sessão do app: não é problema; e, quando a
    // causa já é a WebView do Android sem híbrido, o aviso genérico não se repete
    if (!androidSemHibrido && l.navs >= 20 && pct(l.novaAbaSemOrigem, l.navs) >= 25 && pct(l.hibridas ?? 0, l.navs) < 80) {
      out.push({ id: `novaaba|${app}`, app, titulo: t("Páginas abrem em aba nova sem origem", "Pages open in a new tab without origin"),
        detalhe: t(`${nome}: ${pct(l.novaAbaSemOrigem, l.navs)}% das cargas de página (${int(l.novaAbaSemOrigem)} de ${int(l.navs)}) abrem uma aba nova sem página anterior, em geral páginas web dentro de um app nativo (WebView). Cada uma começa um fluxo próprio, sem ligação com a tela do app que a abriu.`,
                   `${nome}: ${pct(l.novaAbaSemOrigem, l.navs)}% of the page loads (${int(l.novaAbaSemOrigem)} of ${int(l.navs)}) start a new tab with no previous page, usually web pages inside a native app (WebView). Each one starts a flow of its own, not linked to the app screen that opened it.`),
        correcao: t("Ligar o monitoramento híbrido da Dynatrace no app nativo, para as páginas da WebView entrarem na sessão do app; ou abrir as páginas na mesma WebView.", "Enable Dynatrace hybrid app monitoring in the native app, so the WebView pages join the app session; or open the pages in the same WebView."),
        quem: t("time do app", "app team") });
    }
    // frames (1.45.8): não é ajuste de monitoramento; o app os trata como partes da página que os contém (App.tsx)
    if (l.reqs >= 20 && pct(l.reqsTrace, l.reqs) < 10) {
      out.push({ id: `trace|${app}`, app, titulo: t("Chamadas de API sem trace", "API calls without trace"),
        detalhe: t(`${nome}: ${int(l.reqs - l.reqsTrace)} de ${int(l.reqs)} chamadas de API vão sem trace${l.dominioSemTrace ? ` (a maioria para ${l.dominioSemTrace}, outro domínio)` : ""}, então as páginas não se ligam ao backend.`,
                   `${nome}: ${int(l.reqs - l.reqsTrace)} of ${int(l.reqs)} API calls carry no trace${l.dominioSemTrace ? ` (most to ${l.dominioSemTrace}, another domain)` : ""}, so pages are not linked to the backend.`),
        correcao: t("Liberar a propagação de trace para o domínio da API nas configurações RUM da aplicação e aceitar os cabeçalhos traceparent e tracestate no CORS da API.", "Allow trace propagation to the API domain in the application's RUM settings, and accept the traceparent and tracestate headers in the API's CORS."),
        quem: t("times do app e da API", "app and API teams") });
    }
  }
  return out;
}
