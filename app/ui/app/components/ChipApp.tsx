import React from "react";
import type { AppInfo } from "../lib/graph";
import { IconeTipo } from "./FlowGraph";
import { t } from "../lib/i18n";

/** Etiqueta da aplicação (ícone web/mobile + nome), para o escopo "Todas as aplicações": cada item diz de que app é. */
export const ChipApp: React.FC<{ apps: AppInfo[]; id: string | null }> = ({ apps, id }) => {
  const a = apps.find((x) => x.id === id);
  return (
    <span className="chip-app" title={t("Aplicação", "Application")}>
      <IconeTipo no={{ tipo: "app", canal: a?.canal ?? "web" }} tamanho={13} />
      <span>{a?.nome ?? id ?? ""}</span>
    </span>
  );
};
