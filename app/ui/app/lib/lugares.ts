/* Mapa da visão geral: onde estão as sessões e onde acontecem os erros, por país e, no Brasil, por estado (UF).
   Os números vêm das linhas "lugar" de qInicioPaginas (queries.ts: a mesma varredura das páginas, sem leitura a mais);
   aqui ficam as tabelas de centro (latitude/longitude) dos países e das 27 UFs, a casa do nome da região gravado pelo
   RUM com a UF, a regra de cor e o filtro que o clique aplica. Sem consulta e sem import de valor (os scripts em Node
   usam este arquivo). O modelo guardado no cache é só a linha crua (LinhaLugar); montarMapa roda na hora de desenhar.

   Formato real dos valores (LAB abc12345, user.events e cópia rum_flow_passos, 16/10/2026; documentação da Dynatrace):
   - geo.country.iso_code: ISO 3166-1 alfa-2, maiúsculo ("BR").
   - geo.region.name: "nome em inglês da região" (dicionário semântico); para o Brasil, o nome do provedor de
     geolocalização, COM acento ("São Paulo"). O DF pode vir como "Federal District" (nome em inglês do GeoNames) ou
     "Distrito Federal"; outras bases gravam sem acento ("Sao Paulo"). Por isso a casa é por nome normalizado (sem
     acento, minúsculo) e por apelido, nunca por igualdade exata.
   - geo.region.iso_code (existe em user.events, NÃO na cópia): só a parte da subdivisão ("SP"), sem o "BR-" que a
     documentação mostra ("CA-QC").
   - Formas do mapa da Dynatrace (strato-geo, CDN dt-cdn.net/.../v006/BR.json): id "BR-SP", nome em português.
   O FILTRO usa sempre o valor cru de geo.region.name (é igualdade exata em queries.ts), nunca o nome da tabela. */

// idioma da interface (lib/i18n.ts): cópia local, porque os scripts em Node usam este arquivo sem import de valor
const t = (pt: string, en: string) => ((globalThis as { __DEF_IDIOMA?: string }).__DEF_IDIOMA === "en" ? en : pt);
const loc = () => ((globalThis as { __DEF_IDIOMA?: string }).__DEF_IDIOMA === "en" ? "en-US" : "pt-BR");

/** Linha "lugar" de qInicioPaginas (ou de qInicioLugares): país ("" = sem local) e, no Brasil, a região crua. */
export interface LinhaLugar { pais: string; regiao: string; visitas: number; erros: number; sessoes: number; sessoesErro: number; mediaMs: number | null; p75Ms: number | null }
/** Linha de qApdexLugares (queries.ts): contagem por canal, aplicação, lugar e faixa das métricas de Apdex por lugar. */
export interface LinhaApdexLugar { canal: "web" | "mobile"; app: string; pais: string | null; regiao: string | null; faixa: string; n: number }
/** Régua do Apdex (a mesma do cartão Experiência): abaixo de 0,70 = ruim (vermelho), até 0,84 = regular (âmbar), 0,85 ou mais = bom. */
export const REGRA_APDEX_LUGAR = { ruim: 0.7, bom: 0.85 } as const;
/** Países em que o lugar é o estado (a mesma lista de PAISES_COM_REGIAO em queries.ts; cópia local: este arquivo não importa valor). */
const PAISES_POR_REGIAO = ["BR"];

export type RegiaoBr = "Norte" | "Nordeste" | "Centro-Oeste" | "Sudeste" | "Sul";
export interface UF { uf: string; nome: string; ibge: number; regiaoBr: RegiaoBr; latitude: number; longitude: number }

/** Centro de cada UF (latitude, longitude): propriedade "centroid" das formas do Brasil no CDN de mapas da Dynatrace
    (o mesmo desenho do strato-geo, id "BR-<UF>"); código IBGE e grande região do IBGE. Ordem da sigla. */
export const UFS: UF[] = [
  { uf: "AC", nome: "Acre", ibge: 12, regiaoBr: "Norte", latitude: -9.3, longitude: -70.47 },
  { uf: "AL", nome: "Alagoas", ibge: 27, regiaoBr: "Nordeste", latitude: -9.51, longitude: -36.63 },
  { uf: "AM", nome: "Amazonas", ibge: 13, regiaoBr: "Norte", latitude: -4.18, longitude: -64.72 },
  { uf: "AP", nome: "Amapá", ibge: 16, regiaoBr: "Norte", latitude: 1.46, longitude: -51.97 },
  { uf: "BA", nome: "Bahia", ibge: 29, regiaoBr: "Nordeste", latitude: -12.47, longitude: -41.7 },
  { uf: "CE", nome: "Ceará", ibge: 23, regiaoBr: "Nordeste", latitude: -5.1, longitude: -39.63 },
  { uf: "DF", nome: "Distrito Federal", ibge: 53, regiaoBr: "Centro-Oeste", latitude: -15.77, longitude: -47.79 },
  { uf: "ES", nome: "Espírito Santo", ibge: 32, regiaoBr: "Sudeste", latitude: -19.57, longitude: -40.67 },
  { uf: "GO", nome: "Goiás", ibge: 52, regiaoBr: "Centro-Oeste", latitude: -16.03, longitude: -49.61 },
  { uf: "MA", nome: "Maranhão", ibge: 21, regiaoBr: "Nordeste", latitude: -5.09, longitude: -45.29 },
  { uf: "MG", nome: "Minas Gerais", ibge: 31, regiaoBr: "Sudeste", latitude: -18.45, longitude: -44.67 },
  { uf: "MS", nome: "Mato Grosso do Sul", ibge: 50, regiaoBr: "Centro-Oeste", latitude: -20.33, longitude: -54.84 },
  { uf: "MT", nome: "Mato Grosso", ibge: 51, regiaoBr: "Centro-Oeste", latitude: -12.96, longitude: -55.93 },
  { uf: "PA", nome: "Pará", ibge: 15, regiaoBr: "Norte", latitude: -4.04, longitude: -53.13 },
  { uf: "PB", nome: "Paraíba", ibge: 25, regiaoBr: "Nordeste", latitude: -7.12, longitude: -36.82 },
  { uf: "PE", nome: "Pernambuco", ibge: 26, regiaoBr: "Nordeste", latitude: -8.33, longitude: -37.99 },
  { uf: "PI", nome: "Piauí", ibge: 22, regiaoBr: "Nordeste", latitude: -7.41, longitude: -42.99 },
  { uf: "PR", nome: "Paraná", ibge: 41, regiaoBr: "Sul", latitude: -24.63, longitude: -51.63 },
  { uf: "RJ", nome: "Rio de Janeiro", ibge: 33, regiaoBr: "Sudeste", latitude: -22.19, longitude: -42.66 },
  { uf: "RN", nome: "Rio Grande do Norte", ibge: 24, regiaoBr: "Nordeste", latitude: -5.83, longitude: -36.67 },
  { uf: "RO", nome: "Rondônia", ibge: 11, regiaoBr: "Norte", latitude: -10.92, longitude: -62.84 },
  { uf: "RR", nome: "Roraima", ibge: 14, regiaoBr: "Norte", latitude: 2.07, longitude: -61.41 },
  { uf: "RS", nome: "Rio Grande do Sul", ibge: 43, regiaoBr: "Sul", latitude: -29.74, longitude: -53.32 },
  { uf: "SC", nome: "Santa Catarina", ibge: 42, regiaoBr: "Sul", latitude: -27.25, longitude: -50.49 },
  { uf: "SE", nome: "Sergipe", ibge: 28, regiaoBr: "Nordeste", latitude: -10.58, longitude: -37.44 },
  { uf: "SP", nome: "São Paulo", ibge: 35, regiaoBr: "Sudeste", latitude: -22.26, longitude: -48.73 },
  { uf: "TO", nome: "Tocantins", ibge: 17, regiaoBr: "Norte", latitude: -10.14, longitude: -48.33 },
];

/** Centro de cada país (ISO 3166-1 alfa-2 → [latitude, longitude]): página canônica do Google (countries_csv), que
    põe o ponto no território principal (EUA no meio do território contínuo, França na metrópole); os códigos que
    faltam nela (SS, CW, SX, BL, MF, AX, UM) vêm do CDN da Dynatrace (centro do maior polígono) e BQ, à mão (Bonaire). */
export const CENTRO_PAIS: Record<string, [number, number]> = {
  AD: [42.55, 1.6], AE: [23.42, 53.85], AF: [33.94, 67.71], AG: [17.06, -61.8], AI: [18.22, -63.07],
  AL: [41.15, 20.17], AM: [40.07, 45.04], AN: [12.23, -69.06], AO: [-11.2, 17.87], AQ: [-75.25, -0.07],
  AR: [-38.42, -63.62], AS: [-14.27, -170.13], AT: [47.52, 14.55], AU: [-25.27, 133.78], AW: [12.52, -69.97],
  AX: [60.23, 19.94], AZ: [40.14, 47.58], BA: [43.92, 17.68], BB: [13.19, -59.54], BD: [23.68, 90.36],
  BE: [50.5, 4.47], BF: [12.24, -1.56], BG: [42.73, 25.49], BH: [25.93, 50.64], BI: [-3.37, 29.92], BJ: [9.31, 2.32],
  BL: [17.91, -62.83], BM: [32.32, -64.76], BN: [4.54, 114.73], BO: [-16.29, -63.59], BQ: [12.18, -68.26],
  BR: [-14.24, -51.93], BS: [25.03, -77.4], BT: [27.51, 90.43], BV: [-54.42, 3.41], BW: [-22.33, 24.68],
  BY: [53.71, 27.95], BZ: [17.19, -88.5], CA: [56.13, -106.35], CC: [-12.16, 96.87], CD: [-4.04, 21.76],
  CF: [6.61, 20.94], CG: [-0.23, 15.83], CH: [46.82, 8.23], CI: [7.54, -5.55], CK: [-21.24, -159.78],
  CL: [-35.68, -71.54], CM: [7.37, 12.35], CN: [35.86, 104.2], CO: [4.57, -74.3], CR: [9.75, -83.75],
  CU: [21.52, -77.78], CV: [16.0, -24.01], CW: [12.19, -68.97], CX: [-10.45, 105.69], CY: [35.13, 33.43],
  CZ: [49.82, 15.47], DE: [51.17, 10.45], DJ: [11.83, 42.59], DK: [56.26, 9.5], DM: [15.41, -61.37],
  DO: [18.74, -70.16], DZ: [28.03, 1.66], EC: [-1.83, -78.18], EE: [58.6, 25.01], EG: [26.82, 30.8],
  EH: [24.22, -12.89], ER: [15.18, 39.78], ES: [40.46, -3.75], ET: [9.14, 40.49], FI: [61.92, 25.75],
  FJ: [-16.58, 179.41], FK: [-51.8, -59.52], FM: [7.43, 150.55], FO: [61.89, -6.91], FR: [46.23, 2.21],
  GA: [-0.8, 11.61], GB: [55.38, -3.44], GD: [12.26, -61.6], GE: [42.32, 43.36], GF: [3.93, -53.13],
  GG: [49.47, -2.59], GH: [7.95, -1.02], GI: [36.14, -5.35], GL: [71.71, -42.6], GM: [13.44, -15.31],
  GN: [9.95, -9.7], GP: [17.0, -62.07], GQ: [1.65, 10.27], GR: [39.07, 21.82], GS: [-54.43, -36.59],
  GT: [15.78, -90.23], GU: [13.44, 144.79], GW: [11.8, -15.18], GY: [4.86, -58.93], GZ: [31.35, 34.31],
  HK: [22.4, 114.11], HM: [-53.08, 73.5], HN: [15.2, -86.24], HR: [45.1, 15.2], HT: [18.97, -72.29],
  HU: [47.16, 19.5], ID: [-0.79, 113.92], IE: [53.41, -8.24], IL: [31.05, 34.85], IM: [54.24, -4.55],
  IN: [20.59, 78.96], IO: [-6.34, 71.88], IQ: [33.22, 43.68], IR: [32.43, 53.69], IS: [64.96, -19.02],
  IT: [41.87, 12.57], JE: [49.21, -2.13], JM: [18.11, -77.3], JO: [30.59, 36.24], JP: [36.2, 138.25],
  KE: [-0.02, 37.91], KG: [41.2, 74.77], KH: [12.57, 104.99], KI: [-3.37, -168.73], KM: [-11.88, 43.87],
  KN: [17.36, -62.78], KP: [40.34, 127.51], KR: [35.91, 127.77], KW: [29.31, 47.48], KY: [19.51, -80.57],
  KZ: [48.02, 66.92], LA: [19.86, 102.5], LB: [33.85, 35.86], LC: [13.91, -60.98], LI: [47.17, 9.56],
  LK: [7.87, 80.77], LR: [6.43, -9.43], LS: [-29.61, 28.23], LT: [55.17, 23.88], LU: [49.82, 6.13],
  LV: [56.88, 24.6], LY: [26.34, 17.23], MA: [31.79, -7.09], MC: [43.75, 7.41], MD: [47.41, 28.37],
  ME: [42.71, 19.37], MF: [18.08, -63.06], MG: [-18.77, 46.87], MH: [7.13, 171.18], MK: [41.61, 21.75],
  ML: [17.57, -4.0], MM: [21.91, 95.96], MN: [46.86, 103.85], MO: [22.2, 113.54], MP: [17.33, 145.38],
  MQ: [14.64, -61.02], MR: [21.01, -10.94], MS: [16.74, -62.19], MT: [35.94, 14.38], MU: [-20.35, 57.55],
  MV: [3.2, 73.22], MW: [-13.25, 34.3], MX: [23.63, -102.55], MY: [4.21, 101.98], MZ: [-18.67, 35.53],
  NA: [-22.96, 18.49], NC: [-20.9, 165.62], NE: [17.61, 8.08], NF: [-29.04, 167.95], NG: [9.08, 8.68],
  NI: [12.87, -85.21], NL: [52.13, 5.29], NO: [60.47, 8.47], NP: [28.39, 84.12], NR: [-0.52, 166.93],
  NU: [-19.05, -169.87], NZ: [-40.9, 174.89], OM: [21.51, 55.92], PA: [8.54, -80.78], PE: [-9.19, -75.02],
  PF: [-17.68, -149.41], PG: [-6.31, 143.96], PH: [12.88, 121.77], PK: [30.38, 69.35], PL: [51.92, 19.15],
  PM: [46.94, -56.27], PN: [-24.7, -127.44], PR: [18.22, -66.59], PS: [31.95, 35.23], PT: [39.4, -8.22],
  PW: [7.51, 134.58], PY: [-23.44, -58.44], QA: [25.35, 51.18], RE: [-21.12, 55.54], RO: [45.94, 24.97],
  RS: [44.02, 21.01], RU: [61.52, 105.32], RW: [-1.94, 29.87], SA: [23.89, 45.08], SB: [-9.65, 160.16],
  SC: [-4.68, 55.49], SD: [12.86, 30.22], SE: [60.13, 18.64], SG: [1.35, 103.82], SH: [-24.14, -10.03],
  SI: [46.15, 15.0], SJ: [77.55, 23.67], SK: [48.67, 19.7], SL: [8.46, -11.78], SM: [43.94, 12.46],
  SN: [14.5, -14.45], SO: [5.15, 46.2], SR: [3.92, -56.03], SS: [7.28, 30.3], ST: [0.19, 6.61], SV: [13.79, -88.9],
  SX: [18.04, -63.07], SY: [34.8, 39.0], SZ: [-26.52, 31.47], TC: [21.69, -71.8], TD: [15.45, 18.73],
  TF: [-49.28, 69.35], TG: [8.62, 0.82], TH: [15.87, 100.99], TJ: [38.86, 71.28], TK: [-8.97, -171.86],
  TL: [-8.87, 125.73], TM: [38.97, 59.56], TN: [33.89, 9.54], TO: [-21.18, -175.2], TR: [38.96, 35.24],
  TT: [10.69, -61.22], TV: [-7.11, 177.65], TW: [23.7, 120.96], TZ: [-6.37, 34.89], UA: [48.38, 31.17],
  UG: [1.37, 32.29], UM: [5.88, -162.08], US: [37.09, -95.71], UY: [-32.52, -55.77], UZ: [41.38, 64.59],
  VA: [41.9, 12.45], VC: [12.98, -61.29], VE: [6.42, -66.59], VG: [18.42, -64.64], VI: [18.34, -64.9],
  VN: [14.06, 108.28], VU: [-15.38, 166.96], WF: [-13.77, -177.16], WS: [-13.76, -172.1], XK: [42.6, 20.9],
  YE: [15.55, 48.52], YT: [-12.83, 45.17], ZA: [-30.56, 22.94], ZM: [-13.13, 27.85], ZW: [-19.02, 29.15],
};

// ---- casa do nome da região com a UF -----------------------------------------------------------------------------
const sem = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
/** Nomes (normalizados) que não são o nome oficial: o inglês do GeoNames/MaxMind para o DF e variações de base. */
const APELIDOS: Record<string, string> = { "federal district": "DF", "distrito federal de brasilia": "DF", "federal district of brazil": "DF" };
const POR_NOME = new Map<string, UF>();
for (const u of UFS) { POR_NOME.set(sem(u.nome), u); POR_NOME.set(u.uf.toLowerCase(), u); }
for (const [n, uf] of Object.entries(APELIDOS)) POR_NOME.set(n, UFS.find((u) => u.uf === uf)!);

/** UF de um valor de geo.region.name ("São Paulo", "Sao Paulo", "Federal District", "Estado de São Paulo") ou de
    geo.region.iso_code ("SP", "BR-SP"). null = não é uma UF conhecida (o lugar vai para a lista, fora do mapa). */
export function ufDe(regiao: string | null | undefined): UF | null {
  if (!regiao) return null;
  const n = sem(regiao).replace(/^(state of|estado de|estado do|estado da|estado)\s+/, "").replace(/^br ([a-z]{2})$/, "$1");
  return POR_NOME.get(n) ?? null;
}

// ---- nomes na tela (na hora de desenhar, no idioma escolhido) ----------------------------------------------------
let nomesPais: Intl.DisplayNames | null = null, nomesLoc = "";
/** Nome do país no idioma da tela, a partir do código ISO ("US" → "Estados Unidos" / "United States"). */
export function nomePais(iso: string): string {
  if (!iso) return t("Local desconhecido", "Unknown location");
  try {
    if (!nomesPais || nomesLoc !== loc()) { nomesPais = new Intl.DisplayNames([loc()], { type: "region" }); nomesLoc = loc(); }
    return nomesPais.of(iso) ?? iso;
  } catch { return iso; }
}
/** Nome do lugar: a UF pelo nome oficial (o DF em inglês é "Federal District"), o país pelo Intl, a região fora da
    tabela pelo valor cru. */
export function nomeLugar(l: Pick<Lugar, "nivel" | "pais" | "regiao" | "uf">): string {
  if (l.nivel === "sem-local") return l.pais ? t(`${nomePais(l.pais)}, estado desconhecido`, `${nomePais(l.pais)}, unknown state`) : t("Sem localização", "No location");
  if (l.uf) { const u = UFS.find((x) => x.uf === l.uf)!; return u.uf === "DF" ? t(u.nome, "Federal District") : u.nome; }
  if (l.nivel === "regiao") return `${l.regiao} (${l.pais})`;
  return nomePais(l.pais);
}

// ---- regra de cor ---------------------------------------------------------------------------------------------------
/** erro = vermelho (impacto no cliente, --sc-erro-*), atencao = âmbar (--sc-aviso-*), normal = neutro (azul do app),
    poucas = cinza, sem cor (amostra pequena demais para julgar). */
export type Saude = "erro" | "atencao" | "normal" | "poucas";
export const REGRA_COR = {
  /** absoluta, pela porcentagem crua em qualquer quantidade de sessões (18/10/2026, 1 sessão com erro
      em 1 é 100% e fica vermelha; até então um lugar com menos de 30 sessões ficava sem cor, e sumia do mapa) */
  vermelhoPct: 25, ambarPct: 10,
  /** relativo à média do escopo (a mesma conta, somando todos os lugares), com piso absoluto */
  vermelhoVezes: 1.5, pisoVermelho: 10, ambarVezes: 1.15, pisoAmbar: 5,
  /** carga lenta: o mesmo corte de "Carga lenta" da visão geral (inicio.ts, CARGA_LENTA_MS), com navegações bastantes */
  lentaMs: 3000, minVisitasLenta: 20,
} as const;

/** Intervalo de Wilson (95%) da fração de sessões com erro, em %. Com poucas sessões ele é largo. */
export function intervalo(comErro: number, n: number): [number, number] {
  if (n <= 0) return [0, 0];
  const z = 1.96, z2 = z * z, p = Math.min(1, Math.max(0, comErro / n));
  const meio = (p + z2 / (2 * n)) / (1 + z2 / n);
  const margem = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
  return [100 * Math.max(0, meio - margem), 100 * Math.min(1, meio + margem)];
}

/** Cor do lugar. Absoluta, pela porcentagem crua: 25% ou mais das sessões com erro = vermelho; 10% ou mais = âmbar.
    Relativa à média do escopo: 1,5 vez a média (e no mínimo 10%) = vermelho; 1,15 vez (e no mínimo 5%) = âmbar, só
    quando a diferença passa da margem de erro (o limite de baixo do intervalo de 95% fica acima da média): 3 em 30 com
    média de 5% não pinta pela média; 120 em 1.000 pinta. "poucas" só sem sessão nenhuma. */
export function saudeDe(sessoes: number, sessoesErro: number, mediaPct: number): Saude {
  if (sessoes <= 0) return "poucas";
  const e = Math.min(sessoesErro, sessoes);
  const p = (100 * e) / sessoes;
  const [min] = intervalo(e, sessoes);
  const acima = (vezes: number, piso: number) => mediaPct > 0 && p >= piso && p >= vezes * mediaPct && min > mediaPct;
  if (p >= REGRA_COR.vermelhoPct || acima(REGRA_COR.vermelhoVezes, REGRA_COR.pisoVermelho)) return "erro";
  if (p >= REGRA_COR.ambarPct || acima(REGRA_COR.ambarVezes, REGRA_COR.pisoAmbar)) return "atencao";
  return "normal";
}
/** Cor do lugar pelo Apdex (mapa "Onde estão os clientes", desde 18/10/2026): a régua do cartão; sem medição = sem cor. */
export function saudeApdex(apdex: number | null): Saude {
  if (apdex == null) return "poucas";
  if (apdex < REGRA_APDEX_LUGAR.ruim) return "erro";
  if (apdex < REGRA_APDEX_LUGAR.bom) return "atencao";
  return "normal";
}
/** Apdex de um conjunto de linhas de faixa: (satisfeitos + tolerantes/2) / medições; null sem medição. */
export function apdexDasFaixas(linhas: LinhaApdexLugar[]): { apdex: number | null; medicoes: number } {
  let sat = 0, tol = 0, fru = 0;
  for (const l of linhas) { if (l.faixa === "satisfeito") sat += l.n; else if (l.faixa === "tolerante") tol += l.n; else fru += l.n; }
  const medicoes = sat + tol + fru;
  return { apdex: medicoes > 0 ? (sat + tol / 2) / medicoes : null, medicoes };
}
/** Chave de lugar de uma linha de Apdex, no mesmo formato das linhas da cópia ("BR|São Paulo", "US|", "|"): fora dos
    países abertos por região, a região é descartada; país ausente = sem local. */
export const chaveApdexLugar = (l: LinhaApdexLugar) => `${l.pais ?? ""}|${l.pais && PAISES_POR_REGIAO.includes(l.pais) ? l.regiao ?? "" : ""}`;

// ---- montagem ------------------------------------------------------------------------------------------------------
/** uf = estado do Brasil; regiao = região que a tabela não conhece (só na lista); pais = país inteiro; sem-local = sem país ou Brasil sem estado */
export type NivelLugar = "uf" | "regiao" | "pais" | "sem-local";
export interface Lugar {
  /** "BR|São Paulo", "US|", "|" */
  chave: string;
  nivel: NivelLugar;
  /** valores crus da cópia: país ISO ("" = sem local) e, nos países abertos por região, geo.region.name */
  pais: string; regiao: string | null;
  /** "SP" quando a região casou com uma UF */
  uf: string | null;
  /** id da forma no mapa da Dynatrace (strato-geo): "BR-SP" ou "US" */
  forma: string | null;
  /** centro para a bolha (BubbleLayer do strato-geo); null = vai só para a lista */
  latitude: number | null; longitude: number | null;
  sessoes: number; sessoesErro: number; erros: number; visitas: number;
  /** % de sessões com erro (0 a 100), com o intervalo de 95% e quantas vezes a média do escopo */
  pctErro: number; pctMin: number; pctMax: number; vezesMedia: number | null;
  p75Ms: number | null; mediaMs: number | null;
  saude: Saude; lenta: boolean;
  /** Apdex do lugar (web e mobile juntos) e quantas medições; null = sem medição no período. saudeApdex é a cor do mapa de sessões */
  apdex: number | null; medicoesApdex: number; saudeApdex: Saude;
  /** o filtro de segmento (Segmento.pais / Segmento.regiao) que o clique aplica; null = sem ação (lugar desconhecido) */
  filtro: { pais: string; regiao?: string } | null;
}
export interface Mapa {
  /** lugares do mapa (UFs e países), mais sessões primeiro */
  lugares: Lugar[];
  /** um por país, com o Brasil somado (visão mundo); o p75 do Brasil fica null: percentil não se soma */
  porPais: Lugar[];
  /** na lista e fora do mapa: sem local, Brasil sem estado e região que não casou com a tabela */
  semPosicao: Lugar[];
  total: { sessoes: number; sessoesErro: number; erros: number; visitas: number; pctErro: number };
  /** % de sessões com erro do escopo inteiro (a base da regra relativa) */
  mediaPctErro: number;
  /** fração (0 a 1) das sessões no Brasil; "brasil" = enquadrar no Brasil por estado (95% ou mais no Brasil) */
  fracaoBrasil: number; escopo: "brasil" | "mundo";
}

const pctDe = (a: number, b: number) => (b > 0 ? (100 * Math.min(a, b)) / b : 0);
function lugar(chave: string, nivel: NivelLugar, pais: string, regiao: string | null, uf: UF | null, x: Omit<LinhaLugar, "pais" | "regiao">, media: number, apdex: LinhaApdexLugar[] = []): Lugar {
  const centro = uf ? [uf.latitude, uf.longitude] : nivel === "pais" ? CENTRO_PAIS[pais] ?? null : null;
  const [pctMin, pctMax] = intervalo(Math.min(x.sessoesErro, x.sessoes), x.sessoes);
  const pctErro = pctDe(x.sessoesErro, x.sessoes);
  const a = apdexDasFaixas(apdex);
  return {
    chave, nivel, pais, regiao, uf: uf?.uf ?? null, forma: uf ? `BR-${uf.uf}` : nivel === "pais" ? pais : null,
    latitude: centro ? centro[0] : null, longitude: centro ? centro[1] : null,
    sessoes: x.sessoes, sessoesErro: x.sessoesErro, erros: x.erros, visitas: x.visitas,
    pctErro, pctMin, pctMax, vezesMedia: media > 0 ? pctErro / media : null, p75Ms: x.p75Ms, mediaMs: x.mediaMs,
    saude: saudeDe(x.sessoes, x.sessoesErro, media),
    lenta: x.p75Ms != null && x.p75Ms >= REGRA_COR.lentaMs && x.visitas >= REGRA_COR.minVisitasLenta,
    apdex: a.apdex, medicoesApdex: a.medicoes, saudeApdex: saudeApdex(a.apdex),
    filtro: nivel === "sem-local" ? null : regiao ? { pais, regiao } : { pais },
  };
}

/** Bolhas do mapa a partir das linhas "lugar". As linhas chegam uma por país (fora do Brasil) e uma por estado (no
    Brasil, com a região crua); região vazia = sem estado. O Apdex por lugar (linhas de qApdexLugares) entra pela mesma
    chave de lugar; lugar sem linha de Apdex fica sem medição. */
export function montarMapa(linhas: LinhaLugar[], apdexLinhas: LinhaApdexLugar[] = []): Mapa {
  const soma = (xs: LinhaLugar[]) => xs.reduce((a, x) => ({ visitas: a.visitas + x.visitas, erros: a.erros + x.erros, sessoes: a.sessoes + x.sessoes, sessoesErro: a.sessoesErro + x.sessoesErro }), { visitas: 0, erros: 0, sessoes: 0, sessoesErro: 0 });
  const tot = soma(linhas);
  const media = pctDe(tot.sessoesErro, tot.sessoes);
  const apdexPor = new Map<string, LinhaApdexLugar[]>();
  for (const l of apdexLinhas) { const k = chaveApdexLugar(l); apdexPor.set(k, [...(apdexPor.get(k) ?? []), l]); }
  const apdexDe = (chave: string) => apdexPor.get(chave) ?? [];
  const lugares: Lugar[] = [], semPosicao: Lugar[] = [];
  for (const x of linhas) {
    const chave = `${x.pais}|${x.regiao}`;
    if (!x.pais) { semPosicao.push(lugar(chave, "sem-local", "", null, null, x, media, apdexDe(chave))); continue; }
    if (x.regiao) {
      const uf = x.pais === "BR" ? ufDe(x.regiao) : null;
      const l = lugar(chave, uf ? "uf" : "regiao", x.pais, x.regiao, uf, x, media, apdexDe(chave));
      (uf ? lugares : semPosicao).push(l);   // região que a tabela não conhece: só na lista, e filtra pelo valor cru
      continue;
    }
    // país inteiro; no Brasil, região vazia = estado desconhecido
    if (x.pais === "BR") semPosicao.push(lugar(chave, "sem-local", "BR", null, null, x, media, apdexDe(chave)));
    else lugares.push(lugar(chave, "pais", x.pais, null, null, x, media, apdexDe(chave)));
  }
  // visão mundo: o Brasil numa bolha só (soma dos estados e do "estado desconhecido")
  const br = linhas.filter((x) => x.pais === "BR");
  const porPais = lugares.filter((l) => l.nivel === "pais" && !l.regiao);
  if (br.length) { const s = soma(br); porPais.push({ ...lugar("BR|", "pais", "BR", null, null, { ...s, mediaMs: null, p75Ms: null }, media, apdexLinhas.filter((l) => l.pais === "BR")), lenta: false }); }
  const ordem = (a: Lugar, b: Lugar) => b.sessoes - a.sessoes || b.sessoesErro - a.sessoesErro;
  lugares.sort(ordem); porPais.sort(ordem); semPosicao.sort(ordem);
  // Quadro do Brasil (estados) ou do mundo (uma bolha por país): decidido pelas sessões COM localização, com o Brasil como
  // maioria (19/10/2026). Antes era 95% do total, contando as sessões sem localização e as de outros países:
  // poucas sessões sem IP público e alguns testes de outro país bastavam para esconder os estados das demais (só o
  // país aparecia). Os outros países continuam nos atalhos "Fora do mapa" e o botão Mundo mostra tudo.
  const localizadas = soma(linhas.filter((x) => x.pais)).sessoes;
  const fracaoBrasil = localizadas > 0 ? soma(br).sessoes / localizadas : 0;
  return { lugares, porPais, semPosicao, total: { ...tot, pctErro: media }, mediaPctErro: media, fracaoBrasil, escopo: fracaoBrasil >= 0.5 ? "brasil" : "mundo" };
}

// ---- textos (na hora de desenhar) ------------------------------------------------------------------------------------
const pctTexto = (p: number) => (p > 0 && p < 1 ? "<1%" : `${Math.round(p).toLocaleString(loc())}%`);
const seg = (ms: number) => `${(ms / 1000).toLocaleString(loc(), { maximumFractionDigits: ms < 10000 ? 1 : 0 })} s`;
/** Uma linha sobre o lugar, para a dica da bolha e a lista: "12% das sessões com erro (2,1× a média) · carga p75 3,4 s". */
export function resumoLugar(l: Lugar): string {
  const partes = [t(`${l.sessoes.toLocaleString(loc())} sessões`, `${l.sessoes.toLocaleString(loc())} sessions`)];
  if (l.saude === "poucas") partes.push(t("poucas sessões para comparar", "too few sessions to compare"));
  else {
    const vezes = l.vezesMedia != null && l.vezesMedia >= REGRA_COR.ambarVezes ? t(` (${l.vezesMedia.toLocaleString(loc(), { maximumFractionDigits: 1 })}× a média)`, ` (${l.vezesMedia.toLocaleString(loc(), { maximumFractionDigits: 1 })}× the average)`) : "";
    partes.push(t(`${pctTexto(l.pctErro)} com erro${vezes}`, `${pctTexto(l.pctErro)} with errors${vezes}`));
  }
  if (l.apdex != null) partes.push(t(`Apdex ${l.apdex.toLocaleString(loc(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${l.medicoesApdex.toLocaleString(loc())} medições)`, `Apdex ${l.apdex.toLocaleString(loc(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${l.medicoesApdex.toLocaleString(loc())} measurements)`));
  if (l.p75Ms != null) partes.push(t(`carga p75 ${seg(l.p75Ms)}`, `load p75 ${seg(l.p75Ms)}`));
  return partes.join(" · ");
}
/** Legenda curta da cor (sem travessão). */
export const legendaCor = () => [
  { saude: "erro" as Saude, texto: t("25% ou mais das sessões com erro, ou 1,5× a média", "25% or more of sessions with errors, or 1.5× the average") },
  { saude: "atencao" as Saude, texto: t("10% ou mais, ou 1,15× a média", "10% or more, or 1.15× the average") },
  { saude: "normal" as Saude, texto: t("Abaixo disso", "Below that") },
  { saude: "poucas" as Saude, texto: t("Sem sessões", "No sessions") },
];
/** Dica da legenda: por que um lugar com poucas sessões não pinta pela média. */
export const notaCor = () => t("A comparação com a média só pinta quando a diferença passa da margem de erro (lugares com poucas sessões).",
  "The comparison with the average only colors a place when the difference is beyond the margin of error (places with few sessions).");
/** Anel tracejado da bolha: carga lenta (o mesmo corte de "Carga lenta" da visão geral). */
export const legendaLenta = () => t("Anel tracejado: carga p75 de 3 s ou mais", "Dashed ring: load p75 of 3 s or more");
