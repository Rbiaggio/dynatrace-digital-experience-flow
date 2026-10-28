/* Entrada da coleta dos dossiês (lib/dossie.ts) com PII INVENTADA de propósito (nomes, CPF, e-mail, IP, token, ids em
   caminho, ids de sessão e de trace, id de entidade), passando pelo código real da tela (montarInicio, montarFunil,
   avaliarOportunidades) e por um executor de consultas FALSO que devolve linhas com a mesma PII (mensagens de exceção,
   pilhas, caminhos, hosts). Nada aqui é dado real e nada vai a tenant. */
import { montarInicio, type LinhasInicio } from "../../../ui/app/lib/inicio";
import { montarFunil, type Jornada } from "../../../ui/app/lib/jornadas";
import type { ResultadoOrigem } from "../../../ui/app/lib/evidencias";
import { avaliarOportunidades, type LinhaChamadaEstado } from "../../../ui/app/lib/oportunidades";
import type { ColetaDossie, EntradaDossie, Executor } from "../../../ui/app/lib/dossie";

export const SEP = " › ";
/** Tudo que NÃO pode aparecer nos dossiês (nem no pedido ao modelo). */
export const PII = [
  "98765432", "maria.souza@example.com", "maria.souza", "123.456.789-09", "12345678909", "eyJhbGciOiJIUzI1NiJ9", "10.1.2.3", "joao@example.org",
  "98765-4321", "4111 1111 1111 1111", "12.345.678/0001-95", "7f3a9c2e4b1d8f60a5c3e7b9d2f4a6c8", "4bf92f3577b34da6a3ce929d0e0e4736", "ABC123XYZ",
  "Segredo123", "joao.souza", "cpf=", "token=", "jsessionid", "550e8400-e29b-41d4-a716-446655440000", "192.168.0.10", "Bearer abcdefgh12345678", "01310-100",
  "SERVICE-0A1B2C3D4E5F6A7B", "HOST-0A0B0C0D0E0F1A2B", "a1b2c3d4e5f6a7b8", "SESSAO-ABCDEFGHIJKLMNOPQRSTUVWXYZ123456",
];
/** Trace ids que o executor falso devolve na amostra: são usados para ler os spans e nunca podem sair no dossiê. */
export const TRACES = ["4bf92f3577b34da6a3ce929d0e0e4736", "a3ce929d0e0e47364bf92f3577b34da6", "77b34da6a3ce929d0e0e47364bf92f35", "0e0e47364bf92f3577b34da6a3ce929d"];

const linhas: LinhasInicio = {
  fins: [
    { app: "app-pf", fim: "/pix", fins: 40, finsErro: 18, uma: 5, comErro: 30, navs: 160 },
    { app: "app-pf", fim: "/contas/98765432/extrato", fins: 30, finsErro: 2, uma: 10, comErro: 4, navs: 90 },
    { app: "app-pf", fim: "/comprovante", fins: 50, finsErro: 0, uma: 0, comErro: 3, navs: 250 },
    { app: "app-pj", fim: "/painel?sessionId=7f3a9c2e4b1d8f60a5c3e7b9d2f4a6c8", fins: 20, finsErro: 1, uma: 8, comErro: 2, navs: 40 },
  ],
  paginas: [
    { app: "app-pf", view: "/login", visitas: 140, erros: 2, sessoes: 120, sessoesErro: 2, mediaMs: 900, p75Ms: 1200 },
    { app: "app-pf", view: "/pix", visitas: 100, erros: 40, sessoes: 70, sessoesErro: 28, mediaMs: 2500, p75Ms: 3900 },
    { app: "app-pf", view: "/contas/98765432/extrato", visitas: 80, erros: 4, sessoes: 60, sessoesErro: 3, mediaMs: 1800, p75Ms: 2600 },
    { app: "app-pf", view: "/cliente/maria.souza@example.com/perfil", visitas: 30, erros: 1, sessoes: 25, sessoesErro: 1, mediaMs: 700, p75Ms: 900 },
    { app: "app-pf", view: "/comprovante", visitas: 50, erros: 0, sessoes: 50, sessoesErro: 0, mediaMs: 600, p75Ms: 800 },
    { app: "app-pj", view: "/painel?sessionId=7f3a9c2e4b1d8f60a5c3e7b9d2f4a6c8", visitas: 40, erros: 2, sessoes: 20, sessoesErro: 2, mediaMs: 1500, p75Ms: 2100 },
    { app: "app-pj", view: "Transferência para João CPF 123.456.789-09", visitas: 12, erros: 0, sessoes: 10, sessoesErro: 0, mediaMs: 500, p75Ms: 700 },
  ],
  caminhos: [
    { app: "app-pf", caminho: ["/login", "/pix", "/comprovante"].join(SEP), n: 45, fimErro: 0, erros: ["/pix", "/pix"] },
    { app: "app-pf", caminho: ["/login", "/pix"].join(SEP), n: 40, fimErro: 18, erros: ["/pix", "/pix", "/pix"] },
    { app: "app-pf", caminho: ["/login", "/contas/98765432/extrato"].join(SEP), n: 30, fimErro: 2, erros: [] },
    { app: "app-pj", caminho: ["/painel?sessionId=7f3a9c2e4b1d8f60a5c3e7b9d2f4a6c8"].join(SEP), n: 20, fimErro: 1, erros: [] },
  ],
  erros: [
    { app: "app-pf", tipo: "request", status: "500", caminho: "/api/pix/transferencias/98765432/confirmar?cpf=12345678909&token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.abc", dominio: "api.banco.example", msg: "{\"cpf\":\"12345678909\",\"erro\":\"saldo\"}", n: 52, sessoes: 28, paginas: ["/pix"] },
    { app: "app-pf", tipo: "request", status: "503", caminho: "https://10.1.2.3:8443/v1/clientes/550e8400-e29b-41d4-a716-446655440000/limite;jsessionid=ABC123XYZ", dominio: "10.1.2.3", msg: null, n: 6, sessoes: 4, paginas: ["/contas/98765432/extrato"] },
    { app: "app-pf", tipo: "exception", status: null, caminho: null, dominio: null, msg: "TypeError: cpf 123.456.789-09 do usuario=joao.souza (joao@example.org) senha=Segredo123 ligar (11) 98765-4321", n: 9, sessoes: 7, paginas: ["/cliente/maria.souza@example.com/perfil"] },
    { app: "app-pj", tipo: "crash", status: null, caminho: null, dominio: null, msg: "NullPointerException cartão 4111 1111 1111 1111 CNPJ 12.345.678/0001-95 Authorization: Bearer abcdefgh12345678 CEP 01310-100 IP 192.168.0.10 e mais um texto longo que foi cortado pela consulta no meio do CPF 123.456.7", n: 3, sessoes: 2, paginas: ["/painel?sessionId=7f3a9c2e4b1d8f60a5c3e7b9d2f4a6c8"] },
  ],
  lugares: [
    { pais: "BR", regiao: "São Paulo", visitas: 300, erros: 30, sessoes: 120, sessoesErro: 25, mediaMs: 1200, p75Ms: 2000 },
    { pais: "BR", regiao: "Rio de Janeiro", visitas: 100, erros: 15, sessoes: 40, sessoesErro: 12, mediaMs: 1400, p75Ms: 3200 },
    { pais: "BR", regiao: "", visitas: 10, erros: 0, sessoes: 5, sessoesErro: 0, mediaMs: null, p75Ms: null },
    { pais: "PT", regiao: "", visitas: 20, erros: 1, sessoes: 8, sessoesErro: 1, mediaMs: 1800, p75Ms: 2500 },
  ],
};

const NOMES: Record<string, string> = { "app-pf": "Banco_Exemplo_PF", "app-pj": "Banco_Exemplo_PJ" };
const ATE = "2026-10-16T17:30:00.000Z";
/** Linhas falsas de cada consulta do dossiê (pelo id: DOS-01 a DOS-12), com PII nos textos. */
export const LINHAS_FALSAS: Record<string, Record<string, unknown>[]> = {
  "DOS-01": [
    { app: "app-pf", caminho: "/api/pix/transferencias/98765432/confirmar?cpf=12345678909&token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.abc", classe: "falha", n: 52, sessoes: 28, p50: 7.3, p95: 8.4, status: ["500"],
      amostra: [{ t: "2026-10-16T17:25:00Z", trace: TRACES[0] }, { t: "2026-10-16T17:24:00Z", trace: TRACES[1] }] },
    { app: "app-pf", caminho: "/api/pix/transferencias/98765432/confirmar?cpf=12345678909&token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.abc", classe: "sucesso", n: 300, sessoes: 120, p50: 32, p95: 41, status: ["201"],
      amostra: [{ t: "2026-10-16T17:26:00Z", trace: TRACES[2] }, { t: "2026-10-16T17:23:00Z", trace: TRACES[3] }] },
  ],
  "DOS-02": [{ app: "app-pf", caminho: "/api/pix/transferencias/98765432/confirmar?cpf=12345678909&token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.abc", sessoes: 40, com_falha: 28, uma: 30, duas: 6, tres_ou_mais: 4, tent_media: 1.4, tent_max: 5, conseguiu_depois_de_falhar: 3, nunca_conseguiu: 25 }],
  "DOS-03": [
    ...[0, 1].flatMap((i) => [
      { trace: TRACES[i], id: `a${i}00000000000001`, pai: "x", kind: "server", svc: "gateway 10.1.2.3", ent: "SERVICE-0A1B2C3D4E5F6A7B", host: "HOST-0A0B0C0D0E0F1A2B", nome: "POST", t: "2026-10-16T17:25:00Z", d: 5.1, status: "500", f: true, sst: "error", alvo: "gateway", cns: "Nginx", ev: null },
      { trace: TRACES[i], id: `a${i}00000000000002`, pai: `a${i}00000000000001`, kind: "server", svc: "pix-api", ent: "SERVICE-0A1B2C3D4E5F6A7C", host: "HOST-0A0B0C0D0E0F1A2B", nome: "POST /api/pix/transferencias/98765432/confirmar", t: "2026-10-16T17:25:00Z", d: 3.4, status: "500", f: true, sst: "error", alvo: "pix-api",
        ev: [{ "span_event.name": "exception", "exception.type": "Error", "exception.message": "saldo insuficiente para cpf 123.456.789-09 (maria.souza@example.com) sessão SESSAO-ABCDEFGHIJKLMNOPQRSTUVWXYZ123456 trace 4bf92f3577b34da6a3ce929d0e0e4736", "exception.file.full": "/app/server.js", "exception.line_number": "26",
          "exception.stack_trace": "servico (/app/server.js:26)\nconsulta (/app/contas/98765432/saldo.js:10)\nhttps://user:Segredo123@10.1.2.3:8443/v1/x?token=abc" }] },
      { trace: TRACES[i], id: `a${i}00000000000003`, pai: `a${i}00000000000002`, kind: "client", svc: "pix-api", ent: "SERVICE-0A1B2C3D4E5F6A7C", host: "HOST-0A0B0C0D0E0F1A2B", nome: "POST", t: "2026-10-16T17:25:00Z", d: 2.5, status: "500", alvo: "limites 192.168.0.10", ev: null },
      { trace: TRACES[i], id: `a${i}00000000000004`, pai: `a${i}00000000000003`, kind: "server", svc: "limites-api", ent: "SERVICE-0A1B2C3D4E5F6A7D", host: "HOST-0A0B0C0D0E0F1A2C", nome: "POST /limites/{conta}", t: "2026-10-16T17:25:00Z", d: 0.5, status: "500", f: true, sst: "error", alvo: "limites 192.168.0.10", ev: null },
    ]),
    ...[2, 3].flatMap((i) => [
      { trace: TRACES[i], id: `b${i}00000000000001`, pai: "x", kind: "server", svc: "gateway 10.1.2.3", ent: "SERVICE-0A1B2C3D4E5F6A7B", host: "HOST-0A0B0C0D0E0F1A2B", nome: "POST", t: "2026-10-16T17:26:00Z", d: 33, status: "201", f: false, alvo: "gateway", cns: "Nginx", ev: null },
      { trace: TRACES[i], id: `b${i}00000000000002`, pai: `b${i}00000000000001`, kind: "server", svc: "pix-api", ent: "SERVICE-0A1B2C3D4E5F6A7C", host: "HOST-0A0B0C0D0E0F1A2B", nome: "POST /api/pix/transferencias/98765432/confirmar", t: "2026-10-16T17:26:00Z", d: 30, status: "201", f: false, alvo: "pix-api", ev: null },
      { trace: TRACES[i], id: `b${i}00000000000003`, pai: `b${i}00000000000002`, kind: "client", svc: "pix-api", ent: "SERVICE-0A1B2C3D4E5F6A7C", host: "HOST-0A0B0C0D0E0F1A2B", nome: "SELECT pix", t: "2026-10-16T17:26:00Z", d: 1.2, db: "postgresql", dbop: "SELECT", dbns: "pix", alvo: "pix-db", ev: null },
      { trace: TRACES[i], id: `b${i}00000000000004`, pai: `b${i}00000000000002`, kind: "client", svc: "pix-api", ent: "SERVICE-0A1B2C3D4E5F6A7C", host: "HOST-0A0B0C0D0E0F1A2B", nome: "GET", t: "2026-10-16T17:26:00Z", d: 20, alvo: "api.parceiro.example", ev: null },
      { trace: TRACES[i], id: `b${i}00000000000005`, pai: `b${i}00000000000002`, kind: "client", svc: "pix-api", ent: "SERVICE-0A1B2C3D4E5F6A7C", host: "HOST-0A0B0C0D0E0F1A2B", nome: "GET", t: "2026-10-16T17:26:00Z", d: 2, alvo: "api.parceiro.example", ev: null },
    ]),
  ],
  "DOS-04": [{ servico: "pix-api 10.1.2.3", ent: "SERVICE-0A1B2C3D4E5F6A7C", endpoint: "POST /api/pix/transferencias/98765432/confirmar", req: [100, 200, null], falhas: [5, 40, null], p95: [30000, 32000, null], timeframe: { start: "2026-10-14T17:30:00Z" } }],
  "DOS-05": [{ host: "pix-host-10.1.2.3", ent: "HOST-0A0B0C0D0E0F1A2B", cpu: [3.1, 3.2], mem: [30, 31] }],
  "DOS-06": [{ app: "app-pf", entradas: [1000, 1200, 1100, null], timeframe: { start: "2026-10-09T00:00:00Z" } }],
  "DOS-07": [{ app: "app-pf", pagina: "/pix", tipo: "request", erros: [0, 10, 40], timeframe: { start: "2026-10-14T17:30:00Z" } }],
  "DOS-08": [{ nome: "Failure rate increase on pix-api 10.1.2.3", causa: "pix-api", causa_id: "SERVICE-0A1B2C3D4E5F6A7C", categoria: "ERROR", problemas: 3, abertos: 1, primeiro: "2026-10-16T10:00:00Z", ultimo: "2026-10-16T17:00:00Z", dur_p50_min: 20, afetados: [["SERVICE-0A1B2C3D4E5F6A7C"]] }],
  "DOS-09": [],
  "DOS-10": [],
  "DOS-11": [{ pagina: "/cliente/maria.souza@example.com/perfil", navegador: "Chrome", so: "Windows", cargas: 10, com_erro: 4, atraso_p10: 300, atraso_p50: 310, atraso_p90: 330, req_falhou_com_erro: 0, req_ok_com_erro: 4, req_ms_p75: 12,
    sigs: [{ tipo: "TypeError", msg: "cpf 123.456.789-09 do usuario=joao.souza (joao@example.org) senha=Segredo123", arq: "/static/app.js", linha: "10", col: "5", prov: "first_party", pilha: "TypeError: x\n    at https://banco.example/static/app.js?v=12345678909:10:5" }] }],
  "DOS-12": [],
};
export const executorFalso = (linhas = LINHAS_FALSAS, consultas: { id: string; texto: string }[] = []): Executor => async (texto, o) => {
  consultas.push({ id: o.id, texto });
  return { linhas: JSON.parse(JSON.stringify(linhas[o.id] ?? [])), bytes: o.fonte === "metrica" ? 0 : 1024 * 1024 * (o.fonte === "spans" ? 40 : 3) };
};

/** A entrada da coleta com a PII de propósito (oportunidades do motor sobre os mesmos dados). */
export function entradaDossieComPii(executar: Executor = executorFalso()): EntradaDossie {
  const inicio = montarInicio(linhas, SEP, "2h", Date.UTC(2026, 9, 16, 17, 30));
  const jornada: Jornada = { id: "j1", nome: "Pix do cliente maria.souza@example.com", passos: [{ app: "app-pf", view: "/login" }, { app: "app-pf", view: "/pix" }, { app: "app-pf", view: "/comprovante" }], servicos: [], criadaEm: "2026-10-01T00:00:00Z" };
  const funil = montarFunil(jornada, { p0: 120, p1: 85, p2: 45, q1: 3, q2: 30, erros0: 2, erros1: 40, erros2: 0 });
  const origem: ResultadoOrigem = {
    analisadas: 15, semTrace: false, caminho: ["gateway", "pix-api"], origens: [{ servico: "SERVICE-0A1B2C3D4E5F6A7C", nome: "pix-api", traces: 12, status: ["ERROR"] }],
    exemplo: { trace: TRACES[0], t: "2026-10-16T17:20:00Z" }, base: { de: "2026-10-16T17:10:00Z", ate: "2026-10-16T17:21:00Z", traces: [TRACES[0]], servicos: ["SERVICE-0A1B2C3D4E5F6A7C"] },
  };
  const apps = [{ id: "app-pf", nome: NOMES["app-pf"], canal: "web" }, { id: "app-pj", nome: NOMES["app-pj"], canal: "web" }];
  const jornadas = [{ nome: jornada.nome, passos: jornada.passos, funil }];
  const chamadas: LinhaChamadaEstado[] = [
    { app: "app-pf", caminho: "/api/pix/transferencias/98765432/confirmar?cpf=12345678909&token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.abc", regiao: "Rio de Janeiro", total: 120, falhas: 60, sessoesFalha: 30, lentas: 0, p75Ms: null, paginas: ["/pix"] },
    { app: "app-pf", caminho: "/api/pix/transferencias/98765432/confirmar?cpf=12345678909&token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.abc", regiao: "São Paulo 10.1.2.3", total: 300, falhas: 20, sessoesFalha: 10, lentas: 0, p75Ms: null, paginas: ["/pix"] },
  ];
  const oportunidades = avaliarOportunidades({ inicio, apps, qualidade: [], jornadas, backend: [{ app: "app-pf", view: "/pix", origem }], chamadas }).itens;
  return {
    oportunidades, inicio, apps, periodo: { de: "2026-10-16T15:30:00.000Z", ate: ATE, rotulo: "16/10 12:30 a 14:30 (GMT-3)" }, escopo: "Todas as aplicações (cliente maria.souza@example.com)",
    robos: false, chamadas, jornadas, idioma: "pt", versaoApp: "1.35.0", executar, agora: (() => { let t = Date.UTC(2026, 9, 16, 17, 31); return () => (t += 10); })(),
  };
}

/** A mesma coleta com N oportunidades (cópias do dossiê com ids o1..oN): os testes de paralelo, falha de uma e retomada
    precisam de várias (o motor acha uma só nos dados com PII). */
export const comVarias = (c: ColetaDossie, n = 4): ColetaDossie => ({
  ...c, dossies: Array.from({ length: n }, (_, i) => { const d = c.dossies[i % c.dossies.length]; return { ...d, id: `o${i + 1}`, titulo: `${d.titulo} (${i + 1})` }; }),
});
