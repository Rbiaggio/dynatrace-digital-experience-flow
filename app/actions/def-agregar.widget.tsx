import React from "react";
import { ActionWidget } from "@dynatrace-sdk/automation-action-utils";
import { Paragraph } from "@dynatrace/strato-components/typography";

interface Entrada { tarefa?: string }

/** A ação não tem o que configurar: a tarefa vem do JSON do workflow (padrão "fatias"). O formulário só explica. */
const DefAgregarWidget: ActionWidget<Entrada> = (props) => {
  const tarefa = props.value?.tarefa || "fatias";
  return (
    <Paragraph>
      Digital Experience Flow: grava os totais da última fatia de 5 minutos da cópia das sessões (tarefa: {tarefa}). Agende a cada 5 minutos.
    </Paragraph>
  );
};

export default DefAgregarWidget;
