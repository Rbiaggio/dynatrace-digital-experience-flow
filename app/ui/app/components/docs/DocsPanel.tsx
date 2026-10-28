/* Aba "Documentação" (1.40.0): a documentação do produto dentro do app, genérica (vale para qualquer tenant), bilíngue,
   em sub-abas: Visão geral | Flow e jornadas | Pré-requisitos | Custos | IA | Sobre. Substitui o painel "Sobre"; o
   botão de informação do cabeçalho abre esta aba na sub-aba Sobre. O conteúdo de cada sub-aba está em Doc*.tsx, montado
   só com as peças de Kit.tsx; as figuras são prints do laboratório (figuras.ts). */
import React from "react";
import { t } from "../../lib/i18n";
import { DocVisaoGeral } from "./DocVisaoGeral";
import { DocFlow } from "./DocFlow";
import { DocPreRequisitos } from "./DocPreRequisitos";
import { DocCustos } from "./DocCustos";
import { DocIA } from "./DocIA";
import { DocSobre } from "./DocSobre";

export type SubAbaDocs = "visao" | "flow" | "prereq" | "custos" | "ia" | "sobre";
export const SUB_ABAS: { id: SubAbaDocs; rotulo: () => string }[] = [
  { id: "visao", rotulo: () => t("Visão geral", "Overview") },
  { id: "flow", rotulo: () => t("Flow e jornadas", "Flow and journeys") },
  { id: "prereq", rotulo: () => t("Pré-requisitos", "Prerequisites") },
  { id: "custos", rotulo: () => t("Custos", "Costs") },
  { id: "ia", rotulo: () => t("IA", "AI") },
  { id: "sobre", rotulo: () => t("Sobre", "About") },
];

/** A Documentação rola dentro da própria área (docs-rolagem), abaixo do cabeçalho do app: trocar de tópico ou de aba nunca
    move o cabeçalho (botões de idioma, Sobre, Configuração), e o espaço da barra de rolagem fica sempre reservado. */
export const DocsPanel: React.FC<{ aba: SubAbaDocs; aoMudar: (a: SubAbaDocs) => void; aoAbrirConfig?: () => void }> = ({ aba, aoMudar, aoAbrirConfig }) => (
  <div className="docs-rolagem">
  <div className="docs">
    <div className="docs-topo">
      <h2 className="docs-h2">{t("Documentação", "Documentation")}</h2>
      {aoAbrirConfig && <button className="botao-leve" onClick={aoAbrirConfig}>{t("Abrir Configuração", "Open Configuration")}</button>}
    </div>
    <nav className="docs-abas" role="tablist" aria-label={t("Seções da documentação", "Documentation sections")}>
      {SUB_ABAS.map((s) => (
        <button key={s.id} role="tab" aria-selected={aba === s.id} className={aba === s.id ? "ativa" : ""} onClick={() => aoMudar(s.id)}>{s.rotulo()}</button>
      ))}
    </nav>
    <div className="docs-corpo" key={aba}>
      {aba === "visao" && <DocVisaoGeral />}
      {aba === "flow" && <DocFlow />}
      {aba === "prereq" && <DocPreRequisitos />}
      {aba === "custos" && <DocCustos />}
      {aba === "ia" && <DocIA />}
      {aba === "sobre" && <DocSobre />}
    </div>
  </div>
  </div>
);
