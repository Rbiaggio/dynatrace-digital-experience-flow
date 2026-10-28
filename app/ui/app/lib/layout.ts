/* Posições dos nós nos três layouts do Smartscape: horizontal, vertical e força. Puro, sem DOM. */
import { Grafo, NoFluxo } from "./graph";

export type Modo = "horizontal" | "vertical" | "force";
export interface Ponto { x: number; y: number }

export const RAIO = 20;                     // raio do círculo do nó (padrão do Smartscape)
const H_COL = 220, H_LIN = 110;             // horizontal: camadas em colunas (espaçamento próximo ao do Smartscape)
const V_COL = 200, V_LIN = 200;             // vertical: camadas em linhas

/** Posição inicial de cada nó, centrada na origem (0,0): uma coluna por camada (canal, páginas e, à direita, o
    backend na ordem em que é chamado). */
export function posicoesBase(grafo: Grafo, modo: Modo): Map<string, Ponto> {
  const porCamada = new Map<number, NoFluxo[]>();
  for (const n of grafo.nos) { const l = porCamada.get(n.camada) ?? []; l.push(n); porCamada.set(n.camada, l); }
  const pos = new Map<string, Ponto>();
  const camadas = [...porCamada.keys()].sort((a, b) => a - b);
  const meioCamada = (camadas.length - 1) / 2;
  for (const camada of camadas) {
    const lista = porCamada.get(camada)!.sort((a, b) => a.ordem - b.ordem);
    const meio = (lista.length - 1) / 2;
    lista.forEach((n, i) => {
      const t = i - meio, c = camada - meioCamada;
      pos.set(n.id, modo === "vertical" ? { x: t * V_COL, y: c * V_LIN } : { x: c * H_COL, y: t * H_LIN });
    });
  }
  return modo === "force" ? forca(grafo, pos) : pos;
}

/** Simulação de força determinística (Fruchterman-Reingold simplificado), partindo do layout em camadas. Posições e
    deslocamentos em arrays tipados por índice do nó (sem Map.get no laço O(N²)), com as mesmas contas na mesma ordem:
    as posições saem idênticas às da versão com Map. Não trocar Math.hypot por Math.sqrt: muda as posições. */
function forca(grafo: Grafo, inicial: Map<string, Ponto>): Map<string, Ponto> {
  const ids = grafo.nos.map((n) => n.id);
  const N = ids.length;
  const indice = new Map(ids.map((id, i) => [id, i]));
  const X = new Float64Array(N), Y = new Float64Array(N), DX = new Float64Array(N), DY = new Float64Array(N);
  ids.forEach((id, i) => { const q = inicial.get(id)!; X[i] = q.x; Y[i] = q.y; });
  // distância ideal encolhe um pouco com o tamanho do grafo, senão 20 nós espalham demais
  const k = Math.max(110, 170 - 3 * Math.max(0, N - 8));
  const maxN = Math.max(1, ...grafo.arestas.map((a) => a.n));
  // ligações com as duas pontas no grafo: índices e peso (o mesmo valor que a conta por iteração dava)
  const ea: number[] = [], eb: number[] = [], peso: number[] = [];
  for (const e of grafo.arestas) {
    const a = indice.get(e.de), b = indice.get(e.para);
    if (a === undefined || b === undefined) continue;
    ea.push(a); eb.push(b); peso.push(0.6 + 0.8 * Math.sqrt(e.n / maxN));
  }
  let temperatura = 80;
  for (let it = 0; it < 320; it++) {
    DX.fill(0); DY.fill(0);
    for (let i = 0; i < N; i++) {
      const xi = X[i], yi = Y[i];
      for (let j = i + 1; j < N; j++) {
        const dx = xi - X[j] || 0.01, dy = yi - Y[j] || 0.01;
        const d = Math.max(1, Math.hypot(dx, dy));
        const f = (k * k) / d;
        DX[i] += (dx / d) * f; DY[i] += (dy / d) * f; DX[j] -= (dx / d) * f; DY[j] -= (dy / d) * f;
      }
    }
    for (let m = 0; m < ea.length; m++) {
      const a = ea[m], b = eb[m];
      const dx = X[a] - X[b], dy = Y[a] - Y[b];
      const d = Math.max(1, Math.hypot(dx, dy));
      const f = ((d * d) / k) * peso[m];
      DX[a] -= (dx / d) * f; DY[a] -= (dy / d) * f; DX[b] += (dx / d) * f; DY[b] += (dy / d) * f;
    }
    for (let i = 0; i < N; i++) {
      DX[i] -= X[i] * 0.045; DY[i] -= Y[i] * 0.045;                       // gravidade para o centro
      const len = Math.hypot(DX[i], DY[i]);
      if (len > 0) { const passo = Math.min(len, temperatura); X[i] += (DX[i] / len) * passo; Y[i] += (DY[i] / len) * passo; }
    }
    temperatura = Math.max(2, temperatura * 0.975);
  }
  return new Map(ids.map((id, i) => [id, { x: X[i], y: Y[i] }]));
}

/** Caixa que envolve todos os nós (com folga para rótulos). */
export function caixa(pos: Map<string, Ponto>): { x: number; y: number; w: number; h: number } {
  const xs = [...pos.values()].map((p) => p.x), ys = [...pos.values()].map((p) => p.y);
  if (!xs.length) return { x: 0, y: 0, w: 1, h: 1 };
  const folga = RAIO + 60;
  const x = Math.min(...xs) - folga, y = Math.min(...ys) - folga;
  return { x, y, w: Math.max(...xs) + folga - x, h: Math.max(...ys) + folga - y };
}
