import React, { useEffect, useState } from "react";
import { AiIcon, DownloadIcon, ExternalLinkIcon, RefreshIcon, XmarkIcon } from "@dynatrace/strato-icons";
import { AiLoadingIndicator, Markdown } from "@dynatrace/strato-components/content";
import { getCurrentUserDetails, getEnvironmentUrl } from "@dynatrace-sdk/app-environment";
import { sendIntent } from "@dynatrace-sdk/navigation";
import { t, localidade } from "../lib/i18n";
import type { PerguntaAssist } from "../lib/assist";
import { analisarComIA, type AnaliseIA, type FaseIA } from "../lib/assistIA";
import { exportarPdf } from "../lib/assistPdf";

/** "Analisar com o Dynatrace Assist": o DEF junta as evidências, a IA da Dynatrace escreve o relatório (como quem clicou)
    e ele aparece no cartão, com exportação em PDF. Uma análise por cenário, pronta para todos por 24 horas
    (lib/assistIA.ts): não há "analisar de novo"; nesta aba, fechar o painel não interrompe a que está em andamento. */

type Resultado = AnaliseIA & { reaproveitada: boolean };
const nestaAba = new Map<string, Resultado>();
const emAndamento = new Map<string, { desde: number; fase: FaseIA; quem?: string; promessa: Promise<Resultado>; ouvintes: Set<(f: FaseIA, quem?: string) => void> }>();

const eu = () => { try { const n = getCurrentUserDetails().name || ""; return n.startsWith("dt.missing") ? "" : n; } catch { return ""; } };

function iniciar(chave: string, montar: () => Promise<PerguntaAssist>, periodo: string) {
  const desde = Date.now();
  const ouvintes = new Set<(f: FaseIA, quem?: string) => void>();
  const reg = { desde, fase: "evidencias" as FaseIA, quem: undefined as string | undefined, ouvintes, promessa: null as unknown as Promise<Resultado> };
  reg.promessa = analisarComIA(chave, montar, { por: eu(), periodo }, (f, quem) => { reg.fase = f; reg.quem = quem; ouvintes.forEach((o) => o(f, quem)); })
    .then((r) => { nestaAba.set(chave, r); return r; })
    .finally(() => { if (emAndamento.get(chave) === reg) emAndamento.delete(chave); });
  emAndamento.set(chave, reg);
}

const base = () => { try { return getEnvironmentUrl().replace(/\/$/, ""); } catch { return ""; } };
const duracao = (s: number) => (s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`);
const quando = (ms: number) => new Date(ms).toLocaleString(localidade(), { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/** Links do relatório: caminhos do ambiente viram endereço completo e abrem em outra aba (o DEF roda num iframe). */
const Link: React.FC<React.AnchorHTMLAttributes<HTMLAnchorElement>> = ({ href, children }) => (
  <a className="painel-link" href={href?.startsWith("/") ? `${base()}${href}` : href} target="_blank" rel="noreferrer">{children}</a>
);

interface Props {
  /** o cenário (página + erro): uma análise por cenário */
  chave: string;
  /** avisa o cartão quando a análise fica pronta (o botão vira "Ver análise") */
  aoPronta?: (a: AnaliseIA) => void;
  /** a pergunta com as evidências do ambiente (lê o Grail: só quando não há análise guardada) */
  montar: () => Promise<PerguntaAssist>;
  /** a pergunta sem evidências, para continuar no chat do Dynatrace Assist (lá ele investiga sozinho) */
  montarBasico: () => PerguntaAssist;
  pagina: string; app: string; periodo: string;
  aoFechar: () => void;
}

export const AnaliseAssist: React.FC<Props> = ({ chave, aoPronta, montar, montarBasico, pagina, app, periodo, aoFechar }) => {
  const [r, setR] = useState<Resultado | null>(nestaAba.get(chave) ?? null);
  const [erro, setErro] = useState<string | null>(null);
  const [fase, setFase] = useState<FaseIA | null>(emAndamento.get(chave)?.fase ?? null);
  const [desde, setDesde] = useState<number | null>(emAndamento.get(chave)?.desde ?? null);
  const [quemGera, setQuemGera] = useState<string | undefined>(emAndamento.get(chave)?.quem);
  const [, setTique] = useState(0);

  const acompanhar = () => {
    const a = emAndamento.get(chave);
    if (!a) return;
    setDesde(a.desde); setFase(a.fase); setQuemGera(a.quem); setErro(null);
    const ouvir = (f: FaseIA, quem?: string) => { setFase(f); setQuemGera(quem); };
    a.ouvintes.add(ouvir);
    a.promessa.then((x) => { setR(x); setDesde(null); setFase(null); aoPronta?.(x); }, (e) => { setErro(e instanceof Error ? e.message : String(e)); setDesde(null); setFase(null); })
      .finally(() => a.ouvintes.delete(ouvir));
  };
  const rodar = () => { setR(null); iniciar(chave, montar, periodo); acompanhar(); };
  useEffect(() => { if (nestaAba.has(chave)) return; if (emAndamento.has(chave)) acompanhar(); else rodar(); }, [chave]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (desde == null) return; const i = setInterval(() => setTique((x) => x + 1), 1000); return () => clearInterval(i); }, [desde]);

  const pdf = () => {
    if (!r) return;
    exportarPdf({
      titulo: t("Análise do Dynatrace Assist", "Dynatrace Assist analysis"),
      cabecalho: [
        t(`**Página** ${pagina} · **Aplicação** ${app}`, `**Page** ${pagina} · **Application** ${app}`),
        t(`**Dados de** ${r.periodo || periodo}`, `**Data from** ${r.periodo || periodo}`),
        t(`Gerado${r.por ? ` por ${r.por}` : ""} em ${new Date(r.quando).toLocaleString(localidade())} pelo Digital Experience Flow`, `Generated${r.por ? ` by ${r.por}` : ""} on ${new Date(r.quando).toLocaleString(localidade())} by Digital Experience Flow`),
      ],
      markdown: r.texto,
      rodape: t("Gerado com IA (Dynatrace Intelligence). Confira antes de agir.", "AI-generated (Dynatrace Intelligence). Verify before acting."),
      rotuloPagina: (i, n) => t(`página ${i} de ${n}`, `page ${i} of ${n}`),
      nomeArquivo: `analise-assist-${pagina.replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "") || "pagina"}-${new Date(r.quando).toISOString().slice(0, 16).replace(/[-:T]/g, "")}.pdf`,
    });
  };
  // continuar no chat: lá a IA agêntica investiga sozinha (dentro do Assist, sem cobrança de AI units por enquanto)
  const noAssist = () => {
    const p = montarBasico();
    sendIntent({ prompt: `${p.prompt}\n\n${p.instrucao}`, execute: true, contexts: [{ type: "supplementary", value: p.contexto }] }, { recommendedAppId: "dynatrace.davis.copilot", recommendedIntentId: "ask-question" });
  };

  const seg = desde != null ? Math.max(0, Math.round((Date.now() - desde) / 1000)) : 0;
  const textoFase = fase === "aguardando" ? t(`${quemGera || "Outra pessoa"} já está gerando esta análise; aguardando o resultado`, `${quemGera || "Someone"} is already generating this analysis; waiting for the result`)
    : fase === "ia" ? t("A IA da Dynatrace está escrevendo a análise", "Dynatrace AI is writing the analysis")
    : t("Juntando as evidências no ambiente (traces, exceções, problemas do Davis, mudanças)", "Gathering evidence in the environment (traces, exceptions, Davis problems, changes)");
  return (
    <section className="aa" aria-live="polite">
      <header className="aa-topo">
        <AiIcon size={16} className="aa-icone" />
        <b>{t("Análise do Dynatrace Assist", "Dynatrace Assist analysis")}</b>
        {r && <span className="aa-status">{t(`gerada${r.por ? ` por ${r.por}` : ""} em ${quando(r.quando)} · dados de ${r.periodo || periodo}`, `generated${r.por ? ` by ${r.por}` : ""} on ${quando(r.quando)} · data from ${r.periodo || periodo}`)}</span>}
        <span className="aa-acoes">
          {r && <button className="painel-link" onClick={pdf}><DownloadIcon size={14} />{t("Exportar PDF", "Export PDF")}</button>}
          {erro && <button className="painel-link" onClick={rodar}><RefreshIcon size={14} />{t("Tentar de novo", "Try again")}</button>}
          <button className="aa-fechar" onClick={aoFechar} title={desde != null ? t("Fechar (a análise continua e fica guardada)", "Close (the analysis keeps running and is kept)") : t("Fechar", "Close")} aria-label={t("Fechar", "Close")}><XmarkIcon size={14} /></button>
        </span>
      </header>
      {desde != null && (
        <div className="aa-lendo">
          <AiLoadingIndicator>{`${textoFase} · ${duracao(seg)}`}</AiLoadingIndicator>
          <small>{t("Costuma levar menos de 1 minuto. Pode fechar e voltar depois.", "It usually takes less than a minute. You can close this and come back later.")}</small>
        </div>
      )}
      {erro && <p className="aa-erro">{erro}</p>}
      {r && <div className="aa-texto"><Markdown customComponentMappings={{ a: Link }}>{r.texto}</Markdown></div>}
      {r && (
        <footer className="aa-rodape">
          <span className="aa-aviso">{t("Gerado com IA (Dynatrace Intelligence). Confira antes de agir.", "AI-generated (Dynatrace Intelligence). Verify before acting.")}</span>
          <button className="painel-link" onClick={noAssist} title={t("Abre o chat do Dynatrace Assist com esta pergunta; lá a IA investiga o ambiente sozinha", "Opens the Dynatrace Assist chat with this question; there the AI investigates the environment on its own")}><ExternalLinkIcon size={14} />{t("Investigar mais no Dynatrace Assist", "Investigate further in Dynatrace Assist")}</button>
        </footer>
      )}
    </section>
  );
};
