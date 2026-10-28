import React, { useEffect, useId, useState } from "react";
import { dadoMaisAntigoNaTela, marcarNaTela, ouvirTela } from "../lib/compartilhado";
import { t, localidade } from "../lib/i18n";

/** Registra o bloco na tela enquanto ele estiver montado: desde = início da leitura do dado quando ele veio de cache
    (lib/compartilhado.ts); null = dado lido agora por esta aba (ou ainda sem dado). */
export function useDadoNaTela(desde: number | null) {
  const id = useId();
  useEffect(() => { marcarNaTela(id, desde); }, [id, desde]);
  useEffect(() => () => marcarNaTela(id, null), [id]);
}

const IDADE_ROTULO_MS = 60_000;

/** "dados de hh:mm": texto discreto ao lado do Atualizar, só quando algo na tela veio de cache com mais de 60 s. */
export const DadosDe: React.FC = () => {
  const [, redesenhar] = useState(0);
  useEffect(() => ouvirTela(() => redesenhar((x) => x + 1)), []);
  const desde = dadoMaisAntigoNaTela();
  // o dado envelhece na tela: confere de novo a cada 15 s enquanto houver bloco de cache
  useEffect(() => {
    if (desde == null) return;
    const h = setInterval(() => redesenhar((x) => x + 1), 15_000);
    return () => clearInterval(h);
  }, [desde]);
  if (desde == null || Date.now() - desde <= IDADE_ROTULO_MS) return null;
  const hora = new Date(desde).toLocaleTimeString(localidade(), { hour: "2-digit", minute: "2-digit" });
  return (
    <span className="sc-dados-de" title={t(`Parte do que está na tela veio do cache compartilhado, com dados lidos às ${hora} (o cache vale 5 minutos). Atualizar lê tudo de novo agora.`,
      `Part of what is on screen came from the shared cache, with data read at ${hora} (the cache lasts 5 minutes). Refresh reads everything again now.`)}>
      {t(`dados de ${hora}`, `data as of ${hora}`)}
    </span>
  );
};
