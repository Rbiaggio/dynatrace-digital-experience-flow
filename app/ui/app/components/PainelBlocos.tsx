import React, { useState } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "@dynatrace/strato-icons";
import { formatarInt, formatarPct } from "../lib/graph";
import { t } from "../lib/i18n";

/** Blocos visuais dos painéis da direita (detalhes do nó e jornada), no padrão dos painéis de entidade do Dynatrace:
    cabeçalho com ações, números em destaque, abas com contagem, seções recolhíveis e listas com barra de proporção.
    Vermelho só para erro/falha (--sc-erro). */

export const CabecalhoPainel: React.FC<{ icone: React.ReactNode; tipo: string; titulo: string; sub?: React.ReactNode; selo?: React.ReactNode; acoes?: React.ReactNode; links?: React.ReactNode; aoFechar?: () => void; tituloFechar?: string }> =
  ({ icone, tipo, titulo, sub, selo, acoes, links, aoFechar, tituloFechar }) => (
  <header className="dp-cabecalho">
    <div className="dp-cabecalho-linha">
      <div className="painel-entidade">
        <span className="painel-entidade-icone">{icone}</span>
        <div className="painel-entidade-textos">
          <span className="painel-entidade-tipo">{tipo}</span>
          <h2 className="painel-titulo" title={titulo}>{titulo}</h2>
          {sub && <span className="dp-sub">{sub}</span>}
        </div>
      </div>
      {selo && <span className="dp-cabecalho-selo">{selo}</span>}
      {aoFechar && <button className="painel-fechar" onClick={aoFechar} title={tituloFechar ?? t("Fechar", "Close")} aria-label={t("Fechar", "Close")}>×</button>}
    </div>
    {acoes && <div className="dp-acoes">{acoes}</div>}
    {links && <div className="dp-links">{links}</div>}
  </header>
);

/** Cores das fatias (as mesmas da visão geral); a fatia "apagada" (sai da aplicação, outras) é cinza. */
export const CORES_FATIAS = ["#1966FF", "#00A3E0", "#00B39B", "#7C5CFF", "#F2A900", "#E05FB3"];
const COR_APAGADA = "var(--sc-outras)";
const pctCurto = (p: number) => (p > 0 && p < 1 ? "<1%" : `${Math.round(p)}%`);

/** Rosca de uma fatia: "erro" (vermelho) ou "fluxo" (azul). A classe é tom-*: "fluxo" sozinho é o estilo do grafo. */
export const RoscaPainel: React.FC<{ pct: number; tom: "erro" | "fluxo"; titulo: string; rotulo?: string }> = ({ pct, tom, titulo, rotulo }) => {
  const r = 25, C = 2 * Math.PI * r, a = Math.max(0, Math.min(100, pct));
  return (
    <svg className={`dp-rosca tom-${tom}`} viewBox="0 0 66 66" width="66" height="66" role="img" aria-label={titulo}>
      <title>{titulo}</title>
      <circle cx="33" cy="33" r={r} className="dp-rosca-trilho" strokeWidth="8" fill="none" />
      {a > 0 && <circle cx="33" cy="33" r={r} className="dp-rosca-arco" strokeWidth="8" fill="none" strokeLinecap="round" strokeDasharray={`${(C * a) / 100} ${C}`} transform="rotate(-90 33 33)" />}
      <text x="33" y="37.5" textAnchor="middle" className="dp-rosca-pct">{rotulo ?? pctCurto(pct)}</text>
    </svg>
  );
};

export interface LinhaIndicador { icone: React.ReactNode; valor: React.ReactNode; texto: React.ReactNode; critico?: boolean; titulo?: string }
/** Os números do nó, visuais: rosca e número principal no alto, as outras medidas em linhas com ícone. */
export const Indicadores: React.FC<{ rosca?: React.ReactNode; numero: string; rotulo: string; sub?: React.ReactNode; linhas: LinhaIndicador[]; extra?: React.ReactNode }> =
  ({ rosca, numero, rotulo, sub, linhas, extra }) => (
  <section className="dp-ind">
    <div className="dp-ind-topo">
      {rosca}
      <div className="dp-ind-num"><b>{numero}</b><span>{rotulo}</span>{sub && <small>{sub}</small>}</div>
    </div>
    {linhas.length > 0 && (
      <ul className="dp-ind-linhas">
        {linhas.map((l, i) => <li key={i} className={l.critico ? "critico" : ""} title={l.titulo}>{l.icone}<b>{l.valor}</b><span>{l.texto}</span></li>)}
      </ul>
    )}
    {extra}
  </section>
);

export interface FatiaDist { chave: string; rotulo: React.ReactNode; n: number; apagado?: boolean; titulo?: string }
/** Para onde vão / de onde vêm: uma barra empilhada (cada destino uma cor, quem sai em cinza) e a legenda com % e número.
    Mostra os maiores e junta o resto em "outras". */
export const Distribuicao: React.FC<{ itens: FatiaDist[]; vazio: string; max?: number }> = ({ itens, vazio, max = 6 }) => {
  if (itens.length === 0 || itens.every((i) => i.n <= 0)) return <p className="painel-vazio">{vazio}</p>;
  const vivos = itens.filter((i) => !i.apagado && i.n > 0).sort((a, b) => b.n - a.n), apagados = itens.filter((i) => i.apagado && i.n > 0);
  const resto = vivos.slice(max);
  const lista: (FatiaDist & { cor: string })[] = [
    ...vivos.slice(0, max).map((i, k) => ({ ...i, cor: CORES_FATIAS[k % CORES_FATIAS.length] })),
    ...(resto.length ? [{ chave: "__outras", rotulo: t(`mais ${resto.length} ${resto.length === 1 ? "página" : "páginas"}`, `${resto.length} more ${resto.length === 1 ? "page" : "pages"}`), n: resto.reduce((s, i) => s + i.n, 0), cor: COR_APAGADA, apagado: true }] : []),
    ...apagados.map((i) => ({ ...i, cor: COR_APAGADA })),
  ];
  const total = lista.reduce((s, i) => s + i.n, 0) || 1;
  return (
    <div className="dp-dist">
      <div className="dp-dist-barra" aria-hidden="true">
        {lista.map((i) => <span key={i.chave} style={{ width: `${(100 * i.n) / total}%`, background: i.cor }} title={i.titulo} />)}
      </div>
      <ul className="dp-dist-lista">
        {lista.map((i) => (
          <li key={i.chave} className={i.apagado ? "apagado" : ""} title={i.titulo}>
            <i className="dp-dist-cor" style={{ background: i.cor }} aria-hidden="true" />
            <span className="dp-dist-rotulo">{i.rotulo}</span>
            <b>{formatarPct((100 * i.n) / total)}</b>
            <span className="dp-dist-n">{formatarInt(i.n)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

export interface Kpi { rotulo: string; valor: string; nota?: string; critico?: boolean; destaque?: boolean }
export const Kpis: React.FC<{ itens: Kpi[] }> = ({ itens }) => (
  <div className="dp-kpis" style={{ gridTemplateColumns: `repeat(${itens.length}, 1fr)` }}>
    {itens.map((k) => (
      <div key={k.rotulo} className={`dp-kpi${k.critico ? " critico" : ""}${k.destaque ? " destaque" : ""}`} title={k.nota}>
        <span className="dp-kpi-rotulo">{k.rotulo}</span>
        <span className="dp-kpi-valor">{k.valor}</span>
        {k.nota && <span className="dp-kpi-nota">{k.nota}</span>}
      </div>
    ))}
  </div>
);

export interface AbaDef<T extends string> { id: T; rotulo: string; contagem?: number | null; critico?: boolean }
export function Abas<T extends string>({ abas, ativa, aoMudar }: { abas: AbaDef<T>[]; ativa: T; aoMudar: (a: T) => void }) {
  return (
    <div className="dp-abas" role="tablist">
      {abas.map((a) => (
        <button key={a.id} role="tab" aria-selected={a.id === ativa} className={`dp-aba${a.id === ativa ? " ativa" : ""}`} onClick={() => aoMudar(a.id)}>
          {a.rotulo}{a.contagem != null && a.contagem > 0 && <span className={`dp-aba-contagem${a.critico ? " critico" : ""}`}>{formatarInt(a.contagem)}</span>}
        </button>
      ))}
    </div>
  );
}

/** Seção com título; recolhível quando `recolhivel` (abre por padrão, a não ser que `fechada`). */
export const Secao: React.FC<{ titulo?: React.ReactNode; nota?: React.ReactNode; recolhivel?: boolean; fechada?: boolean; extra?: React.ReactNode; children: React.ReactNode }> =
  ({ titulo, nota, recolhivel, fechada, extra, children }) => {
  const [aberta, setAberta] = useState(!fechada);
  return (
    <section className={`dp-bloco${recolhivel ? " recolhivel" : ""}`}>
      {titulo && (recolhivel
        ? <button className="dp-bloco-titulo dp-bloco-botao" onClick={() => setAberta((a) => !a)} aria-expanded={aberta}>
            {aberta ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />}<span>{titulo}</span>{nota && <span className="dp-bloco-nota">{nota}</span>}{extra && <span className="dp-bloco-extra">{extra}</span>}
          </button>
        : <h3 className="dp-bloco-titulo">{titulo}{nota && <span className="dp-bloco-nota">{nota}</span>}{extra && <span className="dp-bloco-extra">{extra}</span>}</h3>)}
      {(!recolhivel || aberta) && children}
    </section>
  );
};

export interface ItemBarra { chave: string; rotulo: React.ReactNode; detalhe?: React.ReactNode; pct: number; valor: string; critico?: boolean; apagado?: boolean }
export const ListaBarras: React.FC<{ itens: ItemBarra[]; vazio: string; mostrarPct?: boolean }> = ({ itens, vazio, mostrarPct = true }) => (
  itens.length === 0 ? <p className="painel-vazio">{vazio}</p> : (
    <ul className="dp-barras">
      {itens.map((i) => (
        <li key={i.chave} className={`dp-barra${i.critico ? " critico" : ""}${i.apagado ? " apagado" : ""}`}>
          <div className="dp-barra-topo">
            <span className="dp-barra-rotulo">{i.rotulo}</span>
            <span className="dp-barra-valor">{mostrarPct && <b>{formatarPct(i.pct)}</b>}{i.valor}</span>
          </div>
          <div className="dp-barra-trilho"><span style={{ width: `${Math.max(1.5, Math.min(100, i.pct))}%` }} /></div>
          {i.detalhe && <div className="dp-barra-detalhe">{i.detalhe}</div>}
        </li>
      ))}
    </ul>
  )
);
export const Barras: React.FC<{ titulo?: React.ReactNode; itens: ItemBarra[]; vazio: string; mostrarPct?: boolean; recolhivel?: boolean; fechada?: boolean }> = ({ titulo, itens, vazio, mostrarPct, recolhivel, fechada }) => (
  <Secao titulo={titulo} recolhivel={recolhivel} fechada={fechada}><ListaBarras itens={itens} vazio={vazio} mostrarPct={mostrarPct} /></Secao>
);

export const Carregando: React.FC<{ texto?: string }> = ({ texto }) => <p className="painel-vazio">{texto ?? t("carregando…", "loading…")}</p>;
