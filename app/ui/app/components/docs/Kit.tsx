/* Kit da aba Documentação (1.40.0): peças de texto bilíngue (PT | EN pelo seletor do cabeçalho, lib/i18n t()) e figuras
   com os prints do laboratório. A documentação é GENÉRICA: vale para qualquer tenant, não cita cliente, ambiente nem
   tarifa de contrato. Cada sub-aba é um componente em components/docs/Doc*.tsx montado só com estas peças. */
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { t } from "../../lib/i18n";
import { FIGURAS } from "./figuras";

/** Seção (h3) com âncora. Dentro de um Doc com mais de uma seção, cada seção vira uma abinha (o título é o rótulo). */
interface PropsSecao { id?: string; titulo: string; children: React.ReactNode }
export const Secao: React.FC<PropsSecao> = ({ id, titulo, children }) => (
  <section className="doc-secao" id={id ? `doc-${id}` : undefined}>
    <h3>{titulo}</h3>
    {children}
  </section>
);

/** Bloco de uma sub-aba: título, resumo e as seções em ABAS. Abas de pasta numa linha só: cantos de cima arredondados, a
    escolhida da cor do painel, com uma linha de destaque em cima, encostada no painel do conteúdo. Quando não cabem, a
    linha rola para os lados com as setas ‹ ›. O título da seção não se repete no painel (a aba já diz). O que não é Secao
    fica acima das abas. Trocar de tópico remonta o Doc (DocsPanel usa key) e volta à primeira aba. */
export const Doc: React.FC<{ titulo: string; resumo?: string; children: React.ReactNode }> = ({ titulo, resumo, children }) => {
  const todos = React.Children.toArray(children);
  const ehSecao = (c: unknown): c is React.ReactElement<PropsSecao> => React.isValidElement(c) && c.type === Secao;
  const secoes = todos.filter(ehSecao), soltos = todos.filter((c) => !ehSecao(c));
  const [ativa, setAtiva] = useState(0);
  const [setas, setSetas] = useState({ esq: false, dir: false });
  const [alturaMin, setAlturaMin] = useState(0);
  const trilho = useRef<HTMLDivElement | null>(null), bloco = useRef<HTMLDivElement | null>(null);
  const i = Math.min(ativa, Math.max(0, secoes.length - 1));
  /** A área que rola (docs-rolagem, em DocsPanel). */
  const rolagem = () => (bloco.current?.closest(".docs-rolagem") as HTMLElement | null) ?? null;
  const medir = () => {
    const el = trilho.current;
    if (el) {
      const esq = el.scrollLeft > 2, dir = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
      setSetas((a) => (a.esq === esq && a.dir === dir ? a : { esq, dir }));
    }
    // o painel tem no mínimo a altura visível da área: uma aba curta não encurta a página e a rolagem não pula
    const r = rolagem();
    if (r && el) setAlturaMin(Math.max(0, r.clientHeight - el.offsetHeight - 24));
  };
  useEffect(() => {
    medir();
    window.addEventListener("resize", medir);
    return () => window.removeEventListener("resize", medir);
  }, []);
  // a aba escolhida à vista na fileira: rola SÓ a fileira (scrollIntoView rolaria a página inteira)
  useEffect(() => {
    const tr = trilho.current, el = tr?.children[i] as HTMLElement | undefined;
    if (tr && el) {
      if (el.offsetLeft < tr.scrollLeft) tr.scrollLeft = Math.max(0, el.offsetLeft - 8);
      else if (el.offsetLeft + el.offsetWidth > tr.scrollLeft + tr.clientWidth) tr.scrollLeft = el.offsetLeft + el.offsetWidth - tr.clientWidth + 8;
    }
    medir();
  }, [i]);
  const rolar = (sentido: number) => trilho.current?.scrollBy({ left: sentido * Math.max(160, (trilho.current?.clientWidth ?? 400) * 0.6), behavior: "smooth" });
  /** Trocar de aba só troca o texto do painel. Só quando as abas já saíram da vista (quem leu até o fim de uma seção longa)
      a área volta até elas, de uma vez, para o texto novo começar no topo. */
  const ir = (k: number) => {
    setAtiva(k);
    const r = rolagem(), b = bloco.current;
    if (r && b) { const topo = b.getBoundingClientRect().top - r.getBoundingClientRect().top; if (topo < 0) r.scrollTop += topo; }
  };
  const proxima = secoes[i + 1];
  // renderização estática (testes, PDF): todas as seções, sem abas
  if ((globalThis as { __DEF_DOC_TUDO?: boolean }).__DEF_DOC_TUDO) return (
    <article className="doc"><h2 className="doc-titulo">{titulo}</h2>{resumo && <p className="doc-resumo">{resumo}</p>}{soltos}{secoes}</article>
  );
  return (
    <article className="doc">
      <h2 className="doc-titulo">{titulo}</h2>
      {resumo && <p className="doc-resumo">{resumo}</p>}
      {soltos}
      {secoes.length > 1 ? (
        <div className="doc-abas-bloco" ref={bloco}>
          <div className="doc-abas">
            {setas.esq && <button type="button" className="doc-abas-seta esq" onClick={() => rolar(-1)} aria-label={t("Abas anteriores", "Previous tabs")} title={t("Abas anteriores", "Previous tabs")}>‹</button>}
            <div className="doc-abas-trilho" role="tablist" aria-label={t("Partes deste tópico", "Parts of this topic")} ref={trilho} onScroll={medir}>
              {secoes.map((s, k) => (
                <button key={k} type="button" role="tab" aria-selected={k === i} className={`doc-aba${k === i ? " ativa" : ""}`} onClick={() => ir(k)}>{s.props.titulo}</button>
              ))}
            </div>
            {setas.dir && <button type="button" className="doc-abas-seta dir" onClick={() => rolar(1)} aria-label={t("Próximas abas", "Next tabs")} title={t("Próximas abas", "Next tabs")}>›</button>}
          </div>
          <div className="doc-aba-painel" role="tabpanel" aria-label={secoes[i].props.titulo} style={alturaMin ? { minHeight: alturaMin } : undefined}>
            {secoes[i]}
            {proxima && <div className="doc-aba-rodape"><button type="button" className="doc-aba-proxima" onClick={() => ir(i + 1)}>{t("Próxima", "Next")}: {proxima.props.titulo} ›</button></div>}
          </div>
        </div>
      ) : secoes}
    </article>
  );
};

/** Parágrafo. */
export const Par: React.FC<{ children: React.ReactNode }> = ({ children }) => <p className="doc-par">{children}</p>;

/** Lista de itens; cada item pode ter um rótulo em negrito. */
export const Lista: React.FC<{ itens: { rotulo?: string; texto: React.ReactNode }[]; numerada?: boolean }> = ({ itens, numerada }) => {
  const L = numerada ? "ol" : "ul";
  return <L className="doc-lista">{itens.map((i, k) => <li key={k}>{i.rotulo && <b>{i.rotulo}</b>}{i.rotulo ? " " : null}{i.texto}</li>)}</L>;
};

/** Tabela simples: cabeçalho e linhas de texto. */
export const Tabela: React.FC<{ cabecalho: string[]; linhas: React.ReactNode[][]; compacta?: boolean }> = ({ cabecalho, linhas, compacta }) => (
  <div className="doc-tabela-rolagem"><table className={`doc-tabela${compacta ? " compacta" : ""}`}>
    <thead><tr>{cabecalho.map((c, k) => <th key={k}>{c}</th>)}</tr></thead>
    <tbody>{linhas.map((l, i) => <tr key={i}>{l.map((c, k) => <td key={k}>{c}</td>)}</tr>)}</tbody>
  </table></div>
);

/** Destaque: nota, dica ou atenção. */
export const Nota: React.FC<{ tipo?: "nota" | "dica" | "atencao"; children: React.ReactNode }> = ({ tipo = "nota", children }) => (
  <div className={`doc-nota ${tipo}`}>{children}</div>
);

/** Print do laboratório pela chave do manifesto (components/docs/figuras.ts). Sem a figura, não renderiza nada. Clicar na
    figura abre a versão grande (tamanho original quando o print é mais largo que a reduzida) numa sobreposição com rolagem,
    fechada pelo ×, pelo Esc ou clicando fora da imagem. */
export const Figura: React.FC<{ id: string; legenda: string }> = ({ id, legenda }) => {
  const f = FIGURAS[id];
  const [aberta, setAberta] = useState(false);
  useEffect(() => {
    if (!aberta) return;
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") setAberta(false); };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [aberta]);
  if (!f) return null;
  const grande = f.grande ?? f;
  return (
    <figure className="doc-figura">
      <button type="button" className="doc-figura-botao" onClick={() => setAberta(true)} title={t("Ampliar a figura", "Enlarge the figure")}>
        <img src={f.src} alt={legenda} loading="lazy" width={f.largura} height={f.altura} />
      </button>
      <figcaption>{legenda} <span className="doc-figura-origem">{t("Print do laboratório · clique para ampliar.", "Lab screenshot · click to enlarge.")}</span></figcaption>
      {aberta && createPortal(
        <div className="doc-luz" role="dialog" aria-modal="true" aria-label={legenda} onClick={() => setAberta(false)}>
          <div className="doc-luz-topo" onClick={(e) => e.stopPropagation()}>
            <span className="doc-luz-legenda">{legenda}</span>
            <span className="doc-luz-dica">{grande.largura} × {grande.altura} px · {t("role para ver tudo · Esc fecha", "scroll to see everything · Esc closes")}</span>
            <button type="button" className="doc-luz-fechar" onClick={() => setAberta(false)} title={t("Fechar", "Close")} aria-label={t("Fechar", "Close")}>×</button>
          </div>
          <div className="doc-luz-corpo">
            <img src={grande.src} alt={legenda} width={grande.largura} height={grande.altura} onClick={(e) => e.stopPropagation()} />
          </div>
        </div>,
        document.body)}
    </figure>
  );
};

/** Subtítulo dentro de uma aba (1.45). */
export const Sub: React.FC<{ children: React.ReactNode }> = ({ children }) => <h4 className="doc-sub">{children}</h4>;

/** Cartões em grade: ícone, título e texto curto (o que é preciso, o que é criado); 1.45. */
export const Cartoes: React.FC<{ itens: { icone?: React.ReactNode; titulo: React.ReactNode; texto: React.ReactNode; rodape?: React.ReactNode }[] }> = ({ itens }) => (
  <div className="doc-cartoes">{itens.map((c, k) => (
    <div key={k} className="doc-cartao">
      <div className="doc-cartao-topo">{c.icone && <span className="doc-cartao-icone" aria-hidden="true">{c.icone}</span>}<b>{c.titulo}</b></div>
      <div className="doc-cartao-texto">{c.texto}</div>
      {c.rodape && <div className="doc-cartao-rodape">{c.rodape}</div>}
    </div>))}</div>
);

/** Passos numerados em cartões (instalação); 1.45. */
export const Passos: React.FC<{ itens: { titulo: React.ReactNode; texto: React.ReactNode }[] }> = ({ itens }) => (
  <ol className="doc-passos">{itens.map((p, k) => (
    <li key={k} className="doc-passo"><span className="doc-passo-n" aria-hidden="true">{k + 1}</span><div className="doc-passo-corpo"><b>{p.titulo}</b><div className="doc-passo-texto">{p.texto}</div></div></li>))}</ol>
);

/** Política IAM de um perfil: uma permissão por linha, para ler e copiar; 1.45. */
export const Politica: React.FC<{ icone?: React.ReactNode; perfil: React.ReactNode; descricao?: React.ReactNode; linhas: string[]; extra?: React.ReactNode }> = ({ icone, perfil, descricao, linhas, extra }) => (
  <div className="doc-politica">
    <div className="doc-politica-topo">{icone && <span className="doc-cartao-icone" aria-hidden="true">{icone}</span>}<b>{perfil}</b></div>
    {descricao && <div className="doc-cartao-texto">{descricao}</div>}
    <pre className="doc-politica-texto">{linhas.join("\n")}</pre>
    {extra && <div className="doc-cartao-texto">{extra}</div>}
  </div>
);
export const Politicas: React.FC<{ children: React.ReactNode }> = ({ children }) => <div className="doc-politicas">{children}</div>;

/** Duas (ou mais) figuras lado a lado, para prints de meia largura; 1.45. */
export const FigurasLado: React.FC<{ children: React.ReactNode }> = ({ children }) => <div className="doc-figuras-lado">{children}</div>;

/** Termo em código (nome de métrica, campo, esquema). */
export const Cod: React.FC<{ children: React.ReactNode }> = ({ children }) => <code className="doc-cod">{children}</code>;
