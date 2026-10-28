/* PDF do relatório do Dynatrace Assist (gerador próprio, abaixo: só texto, leve e pesquisável). Lê o markdown do agente: títulos, parágrafos,
   listas, citações, tabelas simples e blocos de código, com negrito, itálico e código dentro da linha. As fontes padrão
   do PDF só têm Latin-1: setas, aspas curvas e símbolos viram equivalentes e emoji sai. Sem acesso ao navegador aqui
   (os scripts em Node usam este arquivo); exportarPdf() é a única parte que baixa o arquivo. */

/* PDF mínimo, sem dependência (o jsPDF aumentaria o app em ~37% para exportar um relatório de texto). Só o que o
   relatório usa: páginas A4, as fontes padrão Helvetica (normal, negrito, itálico) e Courier em WinAnsi (Latin-1:
   os acentos do português), texto, linha, retângulo e círculo preenchidos, cor e metadados. Medidas em mm, origem no
   canto superior esquerdo (como no jsPDF). A largura do texto vem das métricas AFM das fontes padrão. */

// larguras AFM (1/1000 em) de Helvetica e Helvetica-Bold, caracteres 32 a 126; o itálico tem as mesmas do normal
const HELV = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const HELV_B = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];
// Latin-1 acentuado: a mesma largura da letra base
const BASE_LATIN1: Record<number, string> = {};
"ÀÁÂÃÄÅ".split("").forEach((c) => (BASE_LATIN1[c.charCodeAt(0)] = "A")); "àáâãäå".split("").forEach((c) => (BASE_LATIN1[c.charCodeAt(0)] = "a"));
"ÈÉÊË".split("").forEach((c) => (BASE_LATIN1[c.charCodeAt(0)] = "E")); "èéêë".split("").forEach((c) => (BASE_LATIN1[c.charCodeAt(0)] = "e"));
"ÌÍÎÏ".split("").forEach((c) => (BASE_LATIN1[c.charCodeAt(0)] = "I")); "ìíîï".split("").forEach((c) => (BASE_LATIN1[c.charCodeAt(0)] = "i"));
"ÒÓÔÕÖØ".split("").forEach((c) => (BASE_LATIN1[c.charCodeAt(0)] = "O")); "òóôõöø".split("").forEach((c) => (BASE_LATIN1[c.charCodeAt(0)] = "o"));
"ÙÚÛÜ".split("").forEach((c) => (BASE_LATIN1[c.charCodeAt(0)] = "U")); "ùúûü".split("").forEach((c) => (BASE_LATIN1[c.charCodeAt(0)] = "u"));
BASE_LATIN1[0xc7] = "C"; BASE_LATIN1[0xe7] = "c"; BASE_LATIN1[0xd1] = "N"; BASE_LATIN1[0xf1] = "n"; BASE_LATIN1[0xdd] = "Y"; BASE_LATIN1[0xfd] = "y"; BASE_LATIN1[0xff] = "y";

type Familia = "helvetica" | "courier";
type EstiloFonte = "normal" | "bold" | "italic" | "bolditalic";
const FONTES: Record<string, { nome: string; base: string }> = {
  "helvetica|normal": { nome: "F1", base: "Helvetica" }, "helvetica|bold": { nome: "F2", base: "Helvetica-Bold" },
  "helvetica|italic": { nome: "F3", base: "Helvetica-Oblique" }, "helvetica|bolditalic": { nome: "F4", base: "Helvetica-BoldOblique" },
  "courier|normal": { nome: "F5", base: "Courier" }, "courier|bold": { nome: "F6", base: "Courier-Bold" },
  "courier|italic": { nome: "F5", base: "Courier" }, "courier|bolditalic": { nome: "F6", base: "Courier-Bold" },
};
const PT = 72 / 25.4, LARG_PT = 595.28, ALT_PT = 841.89;
const num = (n: number) => (Math.round(n * 100) / 100).toString();
const cor = (c: number[]) => c.map((x) => num(x / 255)).join(" ");

/** O gerador (exportado para o relatório das oportunidades, lib/relatorioLlm.ts, desenhar tabelas e a matriz). */
export class PdfSimples {
  private paginas: string[][] = [[]];
  private atual = 0;
  private familia: Familia = "helvetica";
  private estilo: EstiloFonte = "normal";
  private tamanho = 10;
  private corTexto = [0, 0, 0];
  private corPreench = [0, 0, 0];
  private corTraco = [0, 0, 0];
  private espessura = 0.2;
  private titulo = "";

  setProperties(p: { title?: string; creator?: string }) { this.titulo = p.title ?? ""; }
  setFont(f: Familia, e: EstiloFonte = "normal") { this.familia = f; this.estilo = e; }
  setFontSize(t: number) { this.tamanho = t; }
  setTextColor(r: number, g: number, b: number) { this.corTexto = [r, g, b]; }
  setFillColor(r: number, g: number, b: number) { this.corPreench = [r, g, b]; }
  setDrawColor(r: number, g: number, b: number) { this.corTraco = [r, g, b]; }
  setLineWidth(mm: number) { this.espessura = mm; }
  addPage() { this.paginas.push([]); this.atual = this.paginas.length - 1; }
  setPage(n: number) { this.atual = n - 1; }
  getNumberOfPages() { return this.paginas.length; }

  /** largura em mm, na fonte e tamanho atuais */
  getTextWidth(s: string): number {
    let w = 0;
    if (this.familia === "courier") w = s.length * 600;
    else {
      const tab = this.estilo === "bold" || this.estilo === "bolditalic" ? HELV_B : HELV;
      for (const ch of s) {
        let c = ch.charCodeAt(0);
        const b = BASE_LATIN1[c];
        if (b) c = b.charCodeAt(0);
        w += c >= 32 && c <= 126 ? tab[c - 32] : 556;
      }
    }
    return (w / 1000) * this.tamanho / PT;
  }
  /** quebra por palavra para caber na largura (mm) */
  splitTextToSize(s: string, mm: number): string[] {
    const out: string[] = []; let linha = "";
    for (const p of s.split(/(\s+)/)) {
      if (!p) continue;
      if (linha && this.getTextWidth(linha + p) > mm && !/^\s+$/.test(p)) { out.push(linha.trimEnd()); linha = p.trimStart(); }
      else linha += p;
      while (this.getTextWidth(linha) > mm && linha.length > 1) {            // palavra maior que a linha: corta
        let n = linha.length; while (n > 1 && this.getTextWidth(linha.slice(0, n)) > mm) n--;
        out.push(linha.slice(0, n)); linha = linha.slice(n);
      }
    }
    if (linha.trim() || !out.length) out.push(linha.trimEnd());
    return out;
  }
  private op(s: string) { this.paginas[this.atual].push(s); }
  text(s: string, xMm: number, yMm: number, o?: { align?: "right" }) {
    const f = FONTES[`${this.familia}|${this.estilo}`];
    const x = (o?.align === "right" ? xMm - this.getTextWidth(s) : xMm) * PT, y = ALT_PT - yMm * PT;
    let esc = "";
    for (const ch of s) {
      const c = ch.charCodeAt(0);
      if (ch === "\\" || ch === "(" || ch === ")") esc += `\\${ch}`;
      else if (c > 126) esc += c <= 255 ? `\\${c.toString(8).padStart(3, "0")}` : "?";
      else if (c >= 32) esc += ch;
    }
    this.op(`BT /${f.nome} ${num(this.tamanho)} Tf ${cor(this.corTexto)} rg ${num(x)} ${num(y)} Td (${esc}) Tj ET`);
  }
  rect(xMm: number, yMm: number, wMm: number, hMm: number, modo: "F" | "S" = "F") {
    const x = xMm * PT, y = ALT_PT - (yMm + hMm) * PT;
    this.op(modo === "F" ? `${cor(this.corPreench)} rg ${num(x)} ${num(y)} ${num(wMm * PT)} ${num(hMm * PT)} re f` : `${cor(this.corTraco)} RG ${num(this.espessura * PT)} w ${num(x)} ${num(y)} ${num(wMm * PT)} ${num(hMm * PT)} re S`);
  }
  line(x1: number, y1: number, x2: number, y2: number) {
    this.op(`${cor(this.corTraco)} RG ${num(this.espessura * PT)} w ${num(x1 * PT)} ${num(ALT_PT - y1 * PT)} m ${num(x2 * PT)} ${num(ALT_PT - y2 * PT)} l S`);
  }
  circle(xMm: number, yMm: number, rMm: number, _modo: "F" = "F") {
    const x = xMm * PT, y = ALT_PT - yMm * PT, r = rMm * PT, k = 0.5523 * r;
    this.op(`${cor(this.corPreench)} rg ${num(x + r)} ${num(y)} m ${num(x + r)} ${num(y + k)} ${num(x + k)} ${num(y + r)} ${num(x)} ${num(y + r)} c ${num(x - k)} ${num(y + r)} ${num(x - r)} ${num(y + k)} ${num(x - r)} ${num(y)} c ${num(x - r)} ${num(y - k)} ${num(x - k)} ${num(y - r)} ${num(x)} ${num(y - r)} c ${num(x + k)} ${num(y - r)} ${num(x + r)} ${num(y - k)} ${num(x + r)} ${num(y)} c f`);
  }

  /** o arquivo, byte a byte */
  bytes(): Uint8Array {
    const objs: string[] = [];
    const usadas = [...new Map(Object.values(FONTES).map((f) => [f.nome, f])).values()];
    const idFonte: Record<string, number> = {};
    const novo = (conteudo: string) => { objs.push(conteudo); return objs.length; };
    novo("<< /Type /Catalog /Pages 2 0 R >>");
    novo("");                                                                 // 2: Pages, preenchido depois
    for (const f of usadas) idFonte[f.nome] = novo(`<< /Type /Font /Subtype /Type1 /BaseFont /${f.base} /Encoding /WinAnsiEncoding >>`);
    const recursos = `<< /Font << ${usadas.map((f) => `/${f.nome} ${idFonte[f.nome]} 0 R`).join(" ")} >> >>`;
    const kids: number[] = [];
    for (const ops of this.paginas) {
      const fluxo = ops.join("\n");
      const c = novo(`<< /Length ${fluxo.length} >>\nstream\n${fluxo}\nendstream`);
      kids.push(novo(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${LARG_PT} ${ALT_PT}] /Resources ${recursos} /Contents ${c} 0 R >>`));
    }
    objs[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
    const titulo = this.titulo.replace(/[\\()]/g, (m) => `\\${m}`).replace(/[^\x20-\x7e]/g, (m) => `\\${m.charCodeAt(0) <= 255 ? m.charCodeAt(0).toString(8).padStart(3, "0") : "077"}`);
    const info = novo(`<< /Title (${titulo}) /Producer (Digital Experience Flow) >>`);
    let s = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
    const offs: number[] = [];
    objs.forEach((o, i) => { offs.push(s.length); s += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = s.length;
    s += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
    s += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    const b = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
    return b;
  }
}

export interface DadosPdf {
  titulo: string;
  /** linhas abaixo do título (página, aplicação, período, quando foi gerado) */
  cabecalho: string[];
  markdown: string;
  /** rodapé de todas as páginas (aviso de IA); o número da página entra à direita */
  rodape: string;
  rotuloPagina: (i: number, n: number) => string;
  nomeArquivo: string;
}

const MARGEM = 18, LARG = 210 - 2 * MARGEM, ALTURA_PAG = 297, TOPO = 20, BASE = 297 - 18;
const COR = { texto: [33, 37, 41], suave: [110, 117, 125], titulo: [20, 24, 28], linha: [214, 218, 223], codigo: [244, 245, 247], marca: [72, 52, 212] } as const;

/** Só Latin-1 (fontes padrão do PDF): troca o que tem equivalente e tira o resto (emoji, ícones). */
export function latin1(s: string): string {
  return s
    .replace(/[→⇒➜➡➔]/g, "->").replace(/[←⇐]/g, "<-").replace(/[↑↓↕]/g, "")
    .replace(/≥/g, ">=").replace(/≤/g, "<=").replace(/≈/g, "~").replace(/≠/g, "!=")
    .replace(/[–—−]/g, "-").replace(/[‘’‚′]/g, "'").replace(/[“”„″]/g, '"')
    .replace(/…/g, "...").replace(/[•●▪◦‣]/g, "-").replace(/[    ]/g, " ")
    .replace(/[✓✔✅]/g, "OK").replace(/[✗✘❌]/g, "X").replace(/⚠️?/g, "!")
    .replace(/[​-‍︎️]/g, "")
    .replace(/[^\x09\x0a\x0d\x20-\x7e\xa0-\xff]/gu, "");
}

type Estilo = { b?: boolean; i?: boolean; c?: boolean };
type Pedaco = Estilo & { s: string };

/** Negrito (**x** ou __x__), itálico (*x* ou _x_ entre espaços), código (`x`) e link [texto](url) -> texto. */
function pedacos(linha: string): Pedaco[] {
  const out: Pedaco[] = [];
  const re = /(\*\*|__)(.+?)\1|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)|(^|[\s(])[*_]([^*_\s][^*_]*?)[*_](?=[\s.,;:!?)]|$)/g;
  let i = 0, m: RegExpExecArray | null;
  while ((m = re.exec(linha))) {
    if (m.index > i) out.push({ s: linha.slice(i, m.index) });
    if (m[2] !== undefined) out.push(...pedacos(m[2]).map((p) => ({ ...p, b: true })));
    else if (m[3] !== undefined) out.push({ s: m[3], c: true });
    else if (m[4] !== undefined) out.push({ s: m[4] });
    else { out.push({ s: m[6] }); out.push({ s: m[7], i: true }); }
    i = re.lastIndex;
  }
  if (i < linha.length) out.push({ s: linha.slice(i) });
  return out.filter((p) => p.s.length > 0);
}

class Escritor {
  y = TOPO;
  doc: PdfSimples;
  constructor(doc: PdfSimples) { this.doc = doc; }
  private fonte(e: Estilo, tam: number) {
    this.doc.setFont(e.c ? "courier" : "helvetica", e.b && e.i ? "bolditalic" : e.b ? "bold" : e.i ? "italic" : "normal");
    this.doc.setFontSize(e.c ? tam - 1 : tam);
  }
  quebra(alt: number) { if (this.y + alt > BASE) { this.doc.addPage(); this.y = TOPO; } }
  espaco(mm: number) { this.y += mm; }
  /** Texto corrido com quebra por palavra, no recuo dado. */
  rico(ps: Pedaco[], tam: number, recuo = 0, cor: readonly number[] = COR.texto, base: Estilo = {}) {
    const alt = tam * 0.48, x0 = MARGEM + recuo, xMax = MARGEM + LARG;
    const palavras: Pedaco[] = [];
    for (const p of ps) for (const w of latin1(p.s).split(/(\s+)/)) if (w) palavras.push({ ...base, ...p, b: base.b || p.b, i: base.i || p.i, s: w });
    let x = x0, linhaVazia = true;
    this.quebra(alt);
    this.doc.setTextColor(cor[0], cor[1], cor[2]);
    for (const w of palavras) {
      const espaco = /^\s+$/.test(w.s);
      if (espaco && linhaVazia) continue;
      this.fonte(w, tam);
      const larg = this.doc.getTextWidth(espaco ? " " : w.s);
      if (!espaco && x + larg > xMax && !linhaVazia) { this.y += alt; this.quebra(alt); x = x0; linhaVazia = true; this.doc.setTextColor(cor[0], cor[1], cor[2]); this.fonte(w, tam); }
      if (espaco) { x += larg; continue; }
      this.doc.text(w.s, x, this.y);
      x += larg; linhaVazia = false;
    }
    this.y += alt;
  }
  marcador(recuo: number, tam: number, rotulo?: string) {
    const cy = this.y - tam * 0.13;
    this.doc.setTextColor(COR.suave[0], COR.suave[1], COR.suave[2]);
    if (rotulo) { this.fonte({}, tam); this.doc.text(rotulo, MARGEM + recuo - 1, this.y, { align: "right" }); }
    else { this.doc.setFillColor(COR.suave[0], COR.suave[1], COR.suave[2]); this.doc.circle(MARGEM + recuo - 2.6, cy, 0.7, "F"); }
  }
  linha() { this.quebra(4); this.doc.setDrawColor(COR.linha[0], COR.linha[1], COR.linha[2]); this.doc.setLineWidth(0.2); this.doc.line(MARGEM, this.y, MARGEM + LARG, this.y); this.y += 4; }
  codigo(linhas: string[]) {
    const alt = 3.9;
    for (const l of linhas) {
      this.quebra(alt + 1);
      this.doc.setFillColor(COR.codigo[0], COR.codigo[1], COR.codigo[2]);
      this.doc.rect(MARGEM, this.y - 3, LARG, alt + 0.4, "F");
      this.fonte({ c: true }, 9.5);
      this.doc.setTextColor(COR.texto[0], COR.texto[1], COR.texto[2]);
      const partes = this.doc.splitTextToSize(latin1(l) || " ", LARG - 4);
      this.doc.text(partes[0], MARGEM + 2, this.y);
      this.y += alt;
      for (const resto of partes.slice(1)) { this.quebra(alt + 1); this.doc.setFillColor(COR.codigo[0], COR.codigo[1], COR.codigo[2]); this.doc.rect(MARGEM, this.y - 3, LARG, alt + 0.4, "F"); this.doc.text(resto, MARGEM + 2, this.y); this.y += alt; }
    }
    this.y += 1.5;
  }
}

/** Monta o documento (sem baixar). */
export function montarPdf(d: DadosPdf): PdfSimples {
  const doc = new PdfSimples();
  const w = new Escritor(doc);
  doc.setProperties({ title: latin1(d.titulo), creator: "Digital Experience Flow" });
  // cabeçalho
  doc.setFillColor(COR.marca[0], COR.marca[1], COR.marca[2]);
  doc.rect(MARGEM, w.y - 5.2, 1.2, 7, "F");
  w.rico([{ s: d.titulo, b: true }], 16, 4, COR.titulo);
  w.espaco(1);
  for (const c of d.cabecalho) w.rico(pedacos(c), 9.5, 4, COR.suave);
  w.espaco(2); w.linha(); w.espaco(1);

  const linhas = d.markdown.replace(/\r\n?/g, "\n").split("\n");
  let i = 0, paragrafo: string[] = [], depoisDeLista = false;
  const fechaParagrafo = () => { if (paragrafo.length) { if (depoisDeLista) w.espaco(1.6); w.rico(pedacos(paragrafo.join(" ")), 10.5); w.espaco(2.2); paragrafo = []; } depoisDeLista = false; };
  while (i < linhas.length) {
    const l = linhas[i], tr = l.trim();
    let m: RegExpMatchArray | null;
    if (/^```/.test(tr)) {                                                     // bloco de código
      fechaParagrafo();
      const bloco: string[] = []; i++;
      while (i < linhas.length && !/^```/.test(linhas[i].trim())) bloco.push(linhas[i++]);
      i++; w.codigo(bloco); continue;
    }
    if (!tr) { fechaParagrafo(); i++; continue; }
    if ((m = tr.match(/^(#{1,6})\s+(.*)$/))) {                                // título
      fechaParagrafo();
      const n = m[1].length, tam = n <= 2 ? 13 : n === 3 ? 11.5 : 10.5;
      w.espaco(n <= 2 ? 2.5 : 1.5); w.quebra(12);
      w.rico(pedacos(m[2].replace(/[*_]{2}/g, "")), tam, 0, COR.titulo, { b: true });
      w.espaco(1.6); i++; continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(tr)) { fechaParagrafo(); w.linha(); i++; continue; }
    if (/^\|.*\|$/.test(tr)) {                                                 // tabela: uma linha por registro
      fechaParagrafo();
      const linhasTab: string[][] = [];
      while (i < linhas.length && /^\|.*\|$/.test(linhas[i].trim())) {
        const cel = linhas[i].trim().slice(1, -1).split("|").map((c) => c.trim());
        if (!cel.every((c) => /^:?-{2,}:?$/.test(c))) linhasTab.push(cel);
        i++;
      }
      linhasTab.forEach((cel, k) => { w.rico(pedacos(cel.join("   |   ")), 9.5, 0, COR.texto, k === 0 ? { b: true } : {}); w.espaco(0.8); });
      w.espaco(1.6); continue;
    }
    if ((m = l.match(/^(\s*)([-*+•]|\d+[.)])\s+(.*)$/))) {                     // lista
      fechaParagrafo();
      const nivel = Math.min(3, Math.floor(m[1].replace(/\t/g, "    ").length / 2)), recuo = 6 + nivel * 5;
      const numero = /\d/.test(m[2]) ? m[2] : undefined;
      w.quebra(5); w.marcador(recuo, 10.5, numero);
      let texto = m[3]; i++;
      while (i < linhas.length && linhas[i].trim() && /^\s{2,}\S/.test(linhas[i]) && !/^\s*([-*+•]|\d+[.)])\s+/.test(linhas[i])) texto += " " + linhas[i++].trim();
      w.rico(pedacos(texto), 10.5, recuo); w.espaco(1.2); depoisDeLista = true; continue;
    }
    if ((m = tr.match(/^>\s?(.*)$/))) { fechaParagrafo(); w.rico(pedacos(m[1]), 10.5, 4, COR.suave, { i: true }); w.espaco(1.5); i++; continue; }
    paragrafo.push(tr); i++;
  }
  fechaParagrafo();

  const n = doc.getNumberOfPages();
  for (let p = 1; p <= n; p++) {
    doc.setPage(p);
    doc.setDrawColor(COR.linha[0], COR.linha[1], COR.linha[2]); doc.setLineWidth(0.2); doc.line(MARGEM, ALTURA_PAG - 12, MARGEM + LARG, ALTURA_PAG - 12);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(COR.suave[0], COR.suave[1], COR.suave[2]);
    doc.text(latin1(d.rodape), MARGEM, ALTURA_PAG - 8);
    doc.text(latin1(d.rotuloPagina(p, n)), MARGEM + LARG, ALTURA_PAG - 8, { align: "right" });
  }
  return doc;
}

/** Baixa o PDF; se o navegador não deixar baixar daqui, abre numa aba nova (de onde dá para salvar). */
export function exportarPdf(d: DadosPdf): void {
  const url = URL.createObjectURL(new Blob([montarPdf(d).bytes() as BlobPart], { type: "application/pdf" }));
  try {
    const a = document.createElement("a");
    a.href = url; a.download = d.nomeArquivo; a.rel = "noopener";
    document.body.appendChild(a); a.click(); a.remove();
  } catch { window.open(url, "_blank", "noopener"); }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
