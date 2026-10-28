/* Destaques: o que chama atenção no fluxo, achado sozinho a partir do grafo (sem consulta nova). É a porta de entrada
   do app: em vez de caçar no desenho, a pessoa vê o problema em palavras simples, o que ele significa, o que fazer e
   quem faz, e clica para ver o trecho. Sem termo técnico ("laço"): o texto tem que servir para qualquer pessoa.
   Ordem: o que afeta o cliente (erro) primeiro. */
import type { Grafo, NoFluxo } from "./graph";

// mesmos formatos de graph.ts (cópia local: só tipos importados, para os scripts de teste em Node rodarem)
// idioma da interface (lib/i18n.ts): cópia local, porque os scripts em Node usam este arquivo sem import de valor
const t = (pt: string, en: string) => ((globalThis as { __DEF_IDIOMA?: string }).__DEF_IDIOMA === "en" ? en : pt);
const loc = () => ((globalThis as { __DEF_IDIOMA?: string }).__DEF_IDIOMA === "en" ? "en-US" : "pt-BR");
const formatarInt = (n: number) => Math.round(n).toLocaleString(loc());
const formatarPct = (p: number) => (p >= 99.5 ? "100%" : p < 1 ? "<1%" : `${Math.round(p)}%`);

export type TipoDestaque = "laco-erro" | "vai-erro" | "erros" | "abandono" | "laco";
export interface Destaque {
  id: string;
  tipo: TipoDestaque;
  impacto: boolean;          // envolve erro: vermelho
  titulo: string;            // o problema, em palavras simples
  detalhe: string;           // onde e quanto
  explicacao: string;        // o que isso significa para o cliente
  acao: string;              // o que olhar e como resolver
  quem: string;              // quem resolve
  nos: string[];             // trecho que acende no grafo
  foco: string;              // nó que abre nos detalhes (a página onde olhar os erros e as sessões)
  temErro: boolean;          // há erro registrado na página em foco (mostra "Ver erros")
  peso: number;
}

/** Tela de erro pelo nome ("ErrorViewController", "/pagina-erro", "falha"...). */
const NOME_ERRO = /erro|falha|fail/i;
/** Fim natural de jornada: parar aqui não é abandono. */
const NOME_FIM = /sair|logout|logoff|fimsessao|fim-sessao|session.?expired|sessao.?expirada|encerr|comprovante|sucesso|success|exit/i;

export function calcularDestaques(g: Grafo, nomeApp?: (id: string | null) => string, limite = 8): Destaque[] {
  const porId = new Map(g.nos.map((n) => [n.id, n]));
  const multi = new Set(g.nos.filter((n) => n.tipo === "app").map((n) => n.app)).size > 1;
  const rot = (n: NoFluxo) => (multi && nomeApp ? `${nomeApp(n.app)} · ${n.nome}` : n.nome);
  const ehErro = (n?: NoFluxo) => !!n && NOME_ERRO.test(n.nome);
  const passos = g.arestas.filter((a) => a.tipo === "nav" && !a.de.startsWith("app|"));
  const out: Destaque[] = [];
  const par = (x: string, y: string) => [x, y].sort().join("~");
  const pares = new Set<string>();
  const quemErro = t("time da funcionalidade e do serviço que falha", "team that owns the feature and the failing service");

  // primeira ligação de cada par (de, para), para achar a volta sem varrer os passos a cada passo
  const porPar = new Map<string, typeof passos[number]>();
  for (const x of passos) { const k = `${x.de}\u0000${x.para}`; if (!porPar.has(k)) porPar.set(k, x); }
  // 1) A ⇄ B forte nas duas direções; com tela de erro (ou erro registrado) é o cliente tentando de novo sem conseguir
  for (const a of passos) {
    const b = porPar.get(`${a.para}\u0000${a.de}`);
    if (!b || pares.has(par(a.de, a.para))) continue;
    const A = porId.get(a.de), B = porId.get(a.para);
    if (!A || !B || a.pct < 50 || b.pct < 50 || a.n + b.n < 6) continue;
    const comErro = ehErro(A) || ehErro(B) || A.erros > 0 || B.erros > 0;
    if (!comErro && (a.pct < 70 || b.pct < 70)) continue;
    pares.add(par(a.de, a.para));
    const [ida, volta, X, Y] = ehErro(A) && !ehErro(B) ? [b, a, B, A] : [a, b, A, B];
    const vezes = formatarInt(a.n + b.n);
    out.push(comErro ? {
      id: `laco|${par(a.de, a.para)}`, tipo: "laco-erro", impacto: true,
      titulo: t("Clientes não conseguem concluir e tentam de novo", "Customers can't finish and keep retrying"),
      detalhe: t(`Em ${rot(X)}, ${formatarPct(ida.pct)} vão para ${Y.nome} e ${formatarPct(volta.pct)} voltam para tentar outra vez (${vezes} vezes).`,
                 `On ${rot(X)}, ${formatarPct(ida.pct)} go to ${Y.nome} and ${formatarPct(volta.pct)} come back to try again (${vezes} times).`),
      explicacao: t("A tela falha, o cliente vê o erro, volta e tenta de novo. A funcionalidade não está funcionando para parte dos clientes.",
                    "The screen fails, the customer sees the error, goes back and tries again. The feature is not working for part of the customers."),
      acao: t("Veja os erros desta tela: eles mostram qual chamada ao servidor falha e com que código. Assista a algumas sessões para ver o que o cliente viu. A correção é no serviço que falha ou na tela.",
              "Check this screen's errors: they show which server call fails and with which code. Watch a few sessions to see what the customer saw. The fix is in the failing service or in the screen."),
      quem: quemErro, nos: [X.id, Y.id], foco: X.id, temErro: X.erros > 0, peso: 1000 + a.n + b.n,
    } : {
      id: `laco|${par(a.de, a.para)}`, tipo: "laco", impacto: false,
      titulo: t("Clientes vão e voltam entre duas telas", "Customers go back and forth between two screens"),
      detalhe: t(`${formatarPct(ida.pct)} de quem sai de ${rot(X)} vai para ${Y.nome}, e ${formatarPct(volta.pct)} volta (${vezes} vezes).`,
                 `${formatarPct(ida.pct)} of those leaving ${rot(X)} go to ${Y.nome}, and ${formatarPct(volta.pct)} come back (${vezes} times).`),
      explicacao: t("Não há erro registrado: o cliente pode não estar achando o que procura ou precisa conferir algo na tela anterior.",
                    "No error recorded: the customer may not find what they look for, or needs to check something on the previous screen."),
      acao: t("Assista a algumas sessões para entender o motivo e ajuste a navegação ou o conteúdo das duas telas.",
              "Watch a few sessions to understand why, and adjust the navigation or the content of both screens."),
      quem: t("time de produto e experiência (UX)", "product and UX team"), nos: [X.id, Y.id], foco: X.id, temErro: false, peso: 300 + a.n + b.n,
    });
  }

  // 2) o próximo passo é, na maioria das vezes, uma tela de erro
  for (const a of passos) {
    const A = porId.get(a.de), B = porId.get(a.para);
    if (!A || !B || !ehErro(B) || ehErro(A) || a.pct < 50 || a.n < 3 || pares.has(par(a.de, a.para))) continue;
    pares.add(par(a.de, a.para));
    out.push({ id: `vai-erro|${a.de}>${a.para}`, tipo: "vai-erro", impacto: true,
      titulo: t("A maioria cai numa página de erro", "Most customers land on an error page"),
      detalhe: t(`${formatarPct(a.pct)} de quem sai de ${rot(A)} vai para a página de erro ${B.nome} (${formatarInt(a.n)} vezes).`,
                 `${formatarPct(a.pct)} of those leaving ${rot(A)} go to the error page ${B.nome} (${formatarInt(a.n)} times).`),
      explicacao: t(`O passo seguinte a ${A.nome} está falhando e o cliente é levado para a página de erro.`, `The step after ${A.nome} is failing and the customer is sent to the error page.`),
      acao: t(`Veja os erros de ${A.nome}: eles indicam o serviço com problema. Assista a algumas sessões afetadas.`, `Check the errors on ${A.nome}: they point to the failing service. Watch a few affected sessions.`),
      quem: quemErro, nos: [A.id, B.id], foco: A.id, temErro: A.erros > 0, peso: 800 + a.n });
  }

  const telas = g.nos.filter((n) => n.tipo === "view");
  // maior chegada de cada página (a primeira, no empate, como no sort estável), calculada uma vez
  const maiorChegada = new Map<string, typeof g.arestas[number]>();
  for (const a of g.arestas) if (a.tipo === "nav") { const atual = maiorChegada.get(a.para); if (!atual || a.n > atual.n) maiorChegada.set(a.para, a); }
  // 3) telas com mais erro da própria aplicação (falha de terceiros já não entra)
  for (const n of [...telas].filter((x) => x.erros >= 10).sort((x, y) => y.erros - x.erros).slice(0, 3)) {
    const partes = [n.falhas ? t(`${formatarInt(n.falhas)} chamadas ao servidor que falharam`, `${formatarInt(n.falhas)} failed server calls`) : "",
                    n.excecoes ? t(`${formatarInt(n.excecoes)} erros na tela`, `${formatarInt(n.excecoes)} errors on the screen`) : ""].filter(Boolean).join(" · ");
    out.push({ id: `erros|${n.id}`, tipo: "erros", impacto: true,
      titulo: t("Página com muitos erros", "Page with many errors"),
      detalhe: t(`${formatarInt(n.erros)} erros em ${rot(n)}${partes ? `: ${partes}` : ""}.`, `${formatarInt(n.erros)} errors on ${rot(n)}${partes ? `: ${partes}` : ""}.`),
      explicacao: t("Os clientes encontram erros nesta página. Nem todos desistem, mas a experiência piora e parte não conclui o que queria.",
                    "Customers hit errors on this page. Not all of them give up, but the experience gets worse and some don't finish what they wanted."),
      acao: t("Abra os erros para ver qual chamada falha e com que código; a correção é no serviço que responde a essa chamada ou na tela.",
              "Open the errors to see which call fails and with which code; the fix is in the service behind that call or in the screen."),
      quem: quemErro, nos: [n.id], foco: n.id, temErro: true, peso: 500 + Math.min(n.erros, 400) });
  }

  // 4) etapa do meio onde muita gente para (não conta fim natural nem tela de erro)
  for (const n of telas) {
    if (n.entradas < 8 || NOME_FIM.test(n.nome) || ehErro(n) || n.saidas === 0) continue;
    const pctFim = (100 * n.fim) / n.entradas;
    if (pctFim < 40) continue;
    const origem = maiorChegada.get(n.id);
    out.push({ id: `abandono|${n.id}`, tipo: "abandono", impacto: false,
      titulo: t("Muitos clientes param nesta tela", "Many customers stop on this screen"),
      detalhe: t(`${formatarPct(pctFim)} dos ${formatarInt(n.entradas)} que chegam em ${rot(n)} encerram a sessão ali.`, `${formatarPct(pctFim)} of the ${formatarInt(n.entradas)} who reach ${rot(n)} end the session there.`),
      explicacao: n.erros > 0
        ? t("Parte deles teve erro nesta tela. Os outros saíram sem erro: pode ser o fim natural ou uma tela confusa ou lenta.", "Some of them had an error on this screen. The others left without an error: it may be the natural end, or a confusing or slow screen.")
        : t("Nenhum erro explica a saída: pode ser o fim natural (o cliente já fez o que queria) ou uma tela confusa ou lenta.", "No error explains it: it may be the natural end (the customer already did what they wanted), or a confusing or slow screen."),
      acao: t("Assista a algumas sessões que pararam aqui. Se for o fim natural da jornada, pode ignorar; se não, revise o conteúdo e o tempo de carga da tela.",
              "Watch a few sessions that stopped here. If it is the natural end of the journey, ignore it; otherwise, review the screen's content and load time."),
      quem: t("time de produto e experiência (UX)", "product and UX team"), nos: origem ? [origem.de, n.id] : [n.id], foco: n.id, temErro: n.erros > 0, peso: 200 + n.fim });
  }

  return out.sort((x, y) => y.peso - x.peso).slice(0, limite);
}
