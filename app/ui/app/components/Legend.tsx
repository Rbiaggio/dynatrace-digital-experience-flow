import React, { useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "@dynatrace/strato-icons";
import { t } from "../lib/i18n";

/** Legenda do grafo numa linha só, com as MESMAS cores e traços das ligações e dos nós (variáveis --sc-* do styles.css).
    Fica no rodapé do grafo, ao lado dos botões de zoom; recolhe para um botão "Legend" e lembra a escolha neste navegador. */
const CHAVE = "def.legenda.aberta";
const lerAberta = () => { try { return localStorage.getItem(CHAVE) !== "0"; } catch { return true; } };

const Linha: React.FC<{ traco?: string; largura?: number; seta?: boolean }> = ({ traco, largura = 1.6, seta = true }) => (
  <svg width="24" height="10" viewBox="0 0 24 10" aria-hidden="true" className="legenda-amostra">
    <line x1="1" y1="5" x2={seta ? 18 : 23} y2="5" className="legenda-traco" strokeWidth={largura} strokeDasharray={traco} />
    {seta && <path d="M 17 1.5 L 23 5 L 17 8.5 z" className="legenda-seta" />}
  </svg>
);

const No: React.FC<{ estado: "erro" | "selecionado" }> = ({ estado }) => (
  <svg width={estado === "erro" ? 24 : 16} height="16" viewBox={`0 0 ${estado === "erro" ? 24 : 16} 16`} aria-hidden="true" className="legenda-amostra">
    {estado === "selecionado" && <circle cx="8" cy="8" r="7" className="legenda-anel" />}
    <circle cx="8" cy="8" r={estado === "selecionado" ? 4.5 : 6} className={`legenda-no ${estado}`} />
    {estado === "erro" && <g transform="translate(12 0)"><rect width="12" height="9" rx="2.5" className="legenda-selo" /><text x="6" y="7" textAnchor="middle" className="legenda-selo-texto">3</text></g>}
  </svg>
);

const itens = (): [React.ReactNode, string, string][] => [
  [<Linha largura={2} />, t("Navegação", "Navigation"), t("Navegação entre páginas", "Navigation between pages")],
  [<span className="legenda-pct">26%</span>, t("das saídas", "of exits"), t("Fatia de quem sai da página que segue por este caminho", "Share of the users leaving the page that take this path")],
  [<Linha largura={2} traco="4 3" />, t("Volta", "Back"), t("Volta a uma página anterior", "Back to an earlier page")],
  [<Linha largura={3.5} seta={false} />, "Volume", t("Linha mais grossa = mais navegações", "Thicker line = more navigations")],
  [<Linha largura={1} />, t("Página → serviço", "Page → service"), t("A página chama o primeiro serviço", "Page calls its first service")],
  [<Linha largura={1} traco="1.5 2.5" />, t("Serviço → serviço", "Service → service"), t("Serviço chama serviço no backend", "Service calls service in the backend")],
  [<No estado="erro" />, t("Erros", "Errors"), t("Erros no nó (quantidade)", "Errors on the node (count)")],
  [<No estado="selecionado" />, t("Selecionado", "Selected"), t("Nó selecionado", "Selected node")],
];

export const Legend: React.FC = () => {
  const [aberta, setAberta] = useState(lerAberta);
  const alternar = () => { setAberta((a) => { try { localStorage.setItem(CHAVE, a ? "0" : "1"); } catch { /* sem storage */ } return !a; }); };
  return (
    <div className={`legenda-grafo${aberta ? "" : " recolhida"}`} role="note" aria-label={t("Legenda", "Legend")}>
      <button className="legenda-botao" onClick={alternar} aria-expanded={aberta} title={aberta ? t("Esconder a legenda", "Hide the legend") : t("Mostrar a legenda", "Show the legend")}>
        {aberta ? <ChevronLeftIcon size={14} /> : <ChevronRightIcon size={14} />}<span>{t("Legenda", "Legend")}</span>
      </button>
      {aberta && itens().map(([amostra, texto, dica]) => (
        <span key={texto} className="legenda-item" title={dica}>{amostra}{texto}</span>
      ))}
    </div>
  );
};
