import React, { useEffect, useState } from "react";
import { Armazenamento, Funil, Jornada } from "../lib/jornadas";
import { Grafo, NoFluxo, formatarInt, formatarPct } from "../lib/graph";
import { t } from "../lib/i18n";

interface Props {
  jornadas: Jornada[];
  funis: Record<string, Funil | null | undefined>;   // undefined = calculando
  ativa: string | null;
  aoAtivar: (id: string | null) => void;
  modoSelecao: boolean;
  selecao: string[];
  grafo: Grafo;
  aoIniciar: () => void;
  aoCancelar: () => void;
  aoSalvar: (nome: string) => void;
  armazenamento: Armazenamento | null;
  editando?: Jornada | null;        // compositor aberto para alterar uma jornada existente (páginas e nome já marcados)
  aoMudarSelecao?: (ids: string[]) => void;   // reordenar (‹ ›) e tirar (×) passos nas pílulas do compositor
}

/** Ícone de jornada (trilha com bandeira de chegada). */
export const IconeJornada: React.FC = () => (
  <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 16 C 3 11, 8 11, 8 8 S 13 5, 13 4" />
    <circle cx="3" cy="16" r="1.6" fill="currentColor" stroke="none" />
    <path d="M13 3.5 V 10.5 M13 3.5 H 17.5 L 16 5.5 L 17.5 7.5 H 13" />
  </svg>
);

/** Funil em miniatura: uma barra por passo, altura = fatia das sessões que entraram no 1º passo. */
const MiniFunil: React.FC<{ funil: Funil | null | undefined; passos: number }> = ({ funil, passos }) => {
  const n = Math.max(passos, funil?.passos.length ?? 0);
  const L = 7, G = 3, H = 22;
  return (
    <svg className="jornada-mini" width={n * (L + G) - G} height={H} aria-hidden="true">
      {Array.from({ length: n }, (_, i) => {
        const pct = funil ? funil.passos[i]?.pctInicio ?? 0 : 100;
        const h = Math.max(3, (H * pct) / 100);
        return <rect key={i} x={i * (L + G)} y={H - h} width={L} height={h} rx={1.5} className={`jornada-mini-barra${funil ? (i === n - 1 ? " fim" : "") : " vazia"}`} />;
      })}
    </svg>
  );
};

/** Faixa de jornadas sob o cabeçalho: cartões (nome · funil em miniatura · conversão · erros) e o compositor de jornada nova. */
export const JourneyBar: React.FC<Props> = (p) => {
  const [nome, setNome] = useState("");
  useEffect(() => { if (p.modoSelecao) setNome(p.editando?.nome ?? ""); }, [p.modoSelecao, p.editando]);
  // cada id da seleção vira passo (página) ou backend; a página que não aparece no grafo atual (janela, aplicação ou caminho
  // dominante) continua na jornada pelo id "app|view", como em jornadaDaSelecao
  const itens = p.selecao.map((id): (Pick<NoFluxo, "id" | "nome" | "tipo"> & { fora?: boolean }) | null => {
    const n = p.grafo.nos.find((x) => x.id === id);
    if (n) return n.tipo === "view" || n.tipo === "servico" || n.tipo === "banco" ? n : null;
    if (id.startsWith("SERVICE-") || id.startsWith("db|")) return { id, nome: id, tipo: "servico", fora: true };
    if (!id.startsWith("app|") && id.includes("|")) return { id, nome: id.slice(id.indexOf("|") + 1), tipo: "view", fora: true };
    return null;
  }).filter((n): n is Pick<NoFluxo, "id" | "nome" | "tipo"> & { fora?: boolean } => Boolean(n));
  const telas = itens.filter((n) => n.tipo === "view");
  const servicos = itens.filter((n) => n.tipo === "servico" || n.tipo === "banco");
  const podeSalvar = telas.length >= 2;
  const nomeSugerido = telas.length >= 2 ? `${telas[0].nome} → ${telas[telas.length - 1].nome}` : t("Nome da jornada (ex.: pagamento Pix)", "Journey name (e.g. Pix payment)");
  const salvar = () => { if (!podeSalvar) return; p.aoSalvar(nome.trim() || nomeSugerido); setNome(""); };
  // reordenar/tirar passos: as páginas ficam na ordem escolhida e os serviços seguem no fim
  const reordenar = (ids: string[]) => p.aoMudarSelecao?.([...ids, ...servicos.map((n) => n.id)]);
  const mover = (i: number, d: number) => { const ids = telas.map((n) => n.id); const j = i + d; if (j < 0 || j >= ids.length) return; [ids[i], ids[j]] = [ids[j], ids[i]]; reordenar(ids); };
  const tirar = (id: string) => reordenar(telas.map((n) => n.id).filter((x) => x !== id));

  return (
    <div className="jornadas" role="toolbar" aria-label={t("Jornadas de negócio", "Business journeys")}>
      <span className="jornadas-rotulo">{t("Jornadas", "Journeys")}</span>
      {p.jornadas.map((j) => {
        const f = p.funis[j.id];
        const ativo = p.ativa === j.id;
        return (
          <button key={j.id} className={`jornada-cartao${ativo ? " ativo" : ""}`} onClick={() => p.aoAtivar(ativo ? null : j.id)}
                  title={`${j.passos.map((x, i) => `${i + 1}. ${x.view}`).join("  →  ")}${j.servicos.length ? `\n+ ${j.servicos.length} ${t("serviço(s) de backend", "backend service(s)")}` : ""}\n${ativo ? t("Clique para voltar ao fluxo inteiro", "Click to go back to the full flow") : t("Clique para destacar no fluxo e abrir o funil", "Click to highlight it in the flow and open the funnel")}`}>
            <span className="jornada-cartao-topo">
              <span className="jornada-cartao-icone"><IconeJornada /></span>
              <span className="jornada-cartao-nome">{j.nome}</span>
              <span className="jornada-cartao-passos">{formatarInt(j.passos.length)} {t("passos", "steps")}</span>
            </span>
            <span className="jornada-cartao-corpo">
              <MiniFunil funil={f} passos={j.passos.length} />
              {f === undefined ? <span className="jornada-cartao-conversao calculando">{t("calculando…", "calculating…")}</span>
                : f ? <span className="jornada-cartao-conversao">{t("Conversão", "Conversion")}: <b>{formatarPct(f.conversao)}</b></span>
                : <span className="jornada-cartao-conversao calculando">{t("sem funil", "no funnel")}</span>}
              {f && f.erros > 0 && <span className="jornada-cartao-erros" title={t("Erros nas páginas da jornada, no mesmo período do funil", "Errors on the journey pages, over the same timeframe as the funnel")}>{formatarInt(f.erros)} {t("erros", "errors")}</span>}
            </span>
          </button>
        );
      })}
      {!p.modoSelecao ? (
        <button className="jornada-cartao novo" onClick={p.aoIniciar} title={t("Clique nos nós do fluxo na ordem da jornada", "Click the flow nodes in the journey order")}>
          <span className="jornada-cartao-topo"><span className="jornada-cartao-mais">+</span><span className="jornada-cartao-nome">{t("Nova jornada", "New journey")}</span></span>
          <span className="jornada-cartao-dica">{t("escolha as páginas na ordem", "select the pages in order")}</span>
        </button>
      ) : (
        <div className="compositor">
          {p.editando && <span className="compositor-editando" title={t("Clique numa página do fluxo para incluir; use ‹ › para reordenar e × para tirar", "Click a page in the flow to add it; use ‹ › to reorder and × to remove")}>{t("Editando", "Editing")} <b>{p.editando.nome}</b></span>}
          <span className="compositor-texto">
            {telas.length === 0 ? <>{t("Clique nos nós do fluxo na ordem da jornada", "Click the flow nodes in the journey order")} <small>{t("(pelo menos 2 páginas)", "(at least 2 pages)")}</small></>
              : <span className="compositor-trilha">
                  {telas.map((n, i) => (
                    <span key={n.id} className={`compositor-passo${n.fora ? " fora" : ""}`} title={n.fora ? t("Esta página não aparece no fluxo deste período, mas continua na jornada", "This page is not in the flow for this timeframe, but stays in the journey") : undefined}>
                      <b>{i + 1}</b> {n.nome}
                      {p.aoMudarSelecao && (
                        <span className="compositor-passo-acoes">
                          <button type="button" disabled={i === 0} onClick={() => mover(i, -1)} title={t("Mover para antes", "Move earlier")} aria-label={t(`Mover ${n.nome} para antes`, `Move ${n.nome} earlier`)}>‹</button>
                          <button type="button" disabled={i === telas.length - 1} onClick={() => mover(i, 1)} title={t("Mover para depois", "Move later")} aria-label={t(`Mover ${n.nome} para depois`, `Move ${n.nome} later`)}>›</button>
                          <button type="button" onClick={() => tirar(n.id)} title={t("Tirar da jornada", "Remove from the journey")} aria-label={t(`Tirar ${n.nome}`, `Remove ${n.nome}`)}>×</button>
                        </span>
                      )}
                    </span>
                  ))}
                  {servicos.length > 0 && <span className="compositor-passo backend">+ {formatarInt(servicos.length)} backend</span>}
                  {telas.length < 2 && <small>{t(`mais ${2 - telas.length} página`, `${2 - telas.length} more page`)}</small>}
                </span>}
          </span>
          <input className="compositor-nome" placeholder={nomeSugerido} value={nome} onChange={(e) => setNome(e.target.value)}
                 onKeyDown={(e) => { if (e.key === "Enter") salvar(); if (e.key === "Escape") p.aoCancelar(); }} autoFocus />
          <button className="botao-primario" disabled={!podeSalvar} onClick={salvar} title={podeSalvar ? (nome.trim() ? t("Salvar a jornada", "Save the journey") : t(`Salvar como "${nomeSugerido}"`, `Save as "${nomeSugerido}"`)) : t("Escolha pelo menos 2 páginas", "Select at least 2 pages")}>{p.editando ? t("Salvar alterações", "Save changes") : t("Salvar", "Save")}</button>
          <button className="botao-leve" onClick={p.aoCancelar}>{t("Cancelar", "Cancel")}</button>
        </div>
      )}
      {p.armazenamento && p.armazenamento.origem !== "app-state" && (
        <span className="jornadas-aviso" title={p.armazenamento.erro ?? t("fora da plataforma", "outside the platform")}>{t("jornadas salvas só neste navegador", "journeys saved in this browser only")}{p.armazenamento.erro ? ` · ${p.armazenamento.erro}` : ""}</span>
      )}
    </div>
  );
};
