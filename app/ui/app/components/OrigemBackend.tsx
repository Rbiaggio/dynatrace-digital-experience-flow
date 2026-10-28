import React, { useEffect, useState } from "react";
import { lerOrigemBackendBloco, type ResultadoOrigem as Resultado } from "../lib/evidencias";
import { useDadoNaTela } from "./DadosDe";
import { formatarInt } from "../lib/graph";
import { t } from "../lib/i18n";
import { linkIntent } from "./Links";

/** "Onde falha no backend?": sob demanda (só lê quando alguém clica). Pega as falhas de chamada ao servidor mais
    recentes da página, lê os spans SÓ na janela em volta delas (no máximo 10 minutos) e mostra em que serviço a falha
    nasce, o caminho até ele e os atalhos para um trace com falha e para o serviço. Sem trace (API em outro domínio),
    diz isso e aponta o ajuste. */

/** aberto: modo controlado (o gatilho fica no pai): true lê e mostra, false não mostra nada; undefined = link próprio. */
interface Props { app: string; view: string; janela: string; robos: boolean; aberto?: boolean }

export const OrigemBackend: React.FC<Props> = ({ app, view, janela, robos, aberto }) => {
  const [estado, setEstado] = useState<"fechado" | "lendo" | "pronto" | "erro">("fechado");
  const [r, setR] = useState<Resultado | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [desdeCache, setDesdeCache] = useState<number | null>(null);   // veio do cache compartilhado: rótulo "dados de hh:mm"
  useDadoNaTela(aberto === false || estado !== "pronto" ? null : desdeCache);

  const ler = async () => {
    setEstado("lendo"); setErro(null);
    try { const b = await lerOrigemBackendBloco(app, view, janela, robos); setR(b.dados); setDesdeCache(b.deCache ? b.desde : null); setEstado("pronto"); }
    catch (e) { setErro(e instanceof Error ? e.message : String(e)); setEstado("erro"); }
  };

  useEffect(() => { if (aberto && estado === "fechado") void ler(); }, [aberto]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (aberto === false) return null;
  if (estado === "fechado" && aberto) return <span className="ob-lendo">{t("Lendo os traces…", "Reading the traces…")}</span>;
  if (estado === "fechado") return <button className="painel-link ob-abrir" onClick={ler} title={t("Lê os traces das falhas mais recentes desta página (só a janela em volta delas)", "Reads the traces of this page's most recent failures (only the window around them)")}>{t("Onde falha no backend?", "Where does it fail in the backend?")}</button>;
  if (estado === "lendo") return <span className="ob-lendo">{t("Lendo os traces…", "Reading the traces…")}</span>;
  if (estado === "erro") return <span className="ob-lendo erro-texto">{t("Não deu para ler os traces", "Could not read the traces")}: {erro}</span>;
  if (!r) return null;
  if (r.semTrace) return <div className="ob"><b>{t("Onde falha no backend", "Where it fails in the backend")}</b><span>{t("As falhas desta página não levam trace (a chamada vai para outro domínio ou não foi propagada). Veja \"Para ver o fluxo completo\" para o ajuste.", "This page's failures carry no trace (the call goes to another domain or was not propagated). See \"To see the whole flow\" for the fix.")}</span></div>;
  const p = r.origens[0];
  const hrefTrace = r.exemplo ? linkIntent({ "trace.id": r.exemplo.trace, "dt.timeframe": { from: new Date(new Date(r.exemplo.t).getTime() - 600000).toISOString(), to: new Date(new Date(r.exemplo.t).getTime() + 600000).toISOString() } }, "dynatrace.distributedtracing", "view-trace") : null;
  const hrefServico = p && p.servico.startsWith("SERVICE-") ? linkIntent({ "dt.entity.service": p.servico }) : null;
  return (
    <div className="ob">
      <b>{t("Onde falha no backend", "Where it fails in the backend")}</b>
      {p ? <span>
        {t("A falha nasce em", "The failure starts in")} <b className="ob-servico">{p.nome}</b>{p.status.length ? ` (HTTP ${p.status.join(", ")})` : ""} {t(`em ${formatarInt(p.traces)} de ${formatarInt(r.analisadas)} chamadas analisadas`, `in ${formatarInt(p.traces)} of ${formatarInt(r.analisadas)} calls analyzed`)}
        {r.origens.slice(1, 3).map((o) => <React.Fragment key={o.servico}>; {formatarInt(o.traces)} {t("em", "in")} <b className="ob-servico">{o.nome}</b>{o.status.length ? ` (HTTP ${o.status.join(", ")})` : ""}</React.Fragment>)}.
        {" "}{t(`Quem corrige: o time do ${p.nome}.`, `Who fixes it: the ${p.nome} team.`)}
      </span> : <span>{t("Os traces não mostram falha no backend: o erro pode estar na própria página ou na rede.", "The traces show no backend failure: the error may be in the page itself or in the network.")}</span>}
      {r.caminho.length > 1 && <span className="ob-caminho">{t("Caminho", "Path")}: {r.caminho.join(" → ")}</span>}
      <span className="ob-links">
        {hrefTrace && <a className="painel-link" href={hrefTrace} target="_blank" rel="noreferrer">{t("Ver um trace com falha ↗", "See a failing trace ↗")}</a>}
        {hrefServico && <a className="painel-link" href={hrefServico} target="_blank" rel="noreferrer">{t("Ver o serviço ↗", "See the service ↗")}</a>}
      </span>
    </div>
  );
};
