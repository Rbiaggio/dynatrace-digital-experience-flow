/* Regra de uso da análise por LLM, imposta AQUI (servidor), nunca só na tela:
   - e-mail na lista de liberados do llm.local.ts (`liberados`: e-mails ou "@dominio"; identidade da plataforma, lida
     na função): análises ilimitadas;
   - os demais: 1 análise por ambiente. A 2ª tentativa recebe "já usada", com a data e quem usou.
   Guardado no App State do app (compartilhado entre usuários), com chaves próprias (prefixo rum-flow.llm.v1.).

   Dois cliques ao mesmo tempo: o App State não tem gravação condicional, então a vez é decidida por eleição. Cada
   tentativa grava um bilhete próprio (chave única, vale 5 min), lista os bilhetes do último minuto e só segue quem tem
   o bilhete mais antigo (hora da gravação no servidor, depois a chave). Quem segue reserva o uso (status
   "reservado", vale 4 min, mais que o teto das chamadas ao LLM, que correm em paralelo logo depois da reserva); quando
   nenhuma oportunidade termina bem, a reserva é liberada (ou vence sozinha): quem pediu não perde a análise por erro do
   LLM. A PRIMEIRA oportunidade que termina bem marca "usado" para sempre; as outras, a síntese e a retomada são da
   mesma análise e não gastam de novo. Garantia forte contra quem apaga o App State pelo navegador só existe do lado do
   provedor do LLM (cota por ambiente no gateway). */

export const PREFIXO = "rum-flow.llm.v1.";
export const CHAVE_USO = `${PREFIXO}uso`;
export const PREFIXO_BILHETE = `${PREFIXO}tentativa.`;
export const PREFIXO_REGISTRO = `${PREFIXO}registro.`;
/** cada análise fica numa chave própria (os dossiês e as oportunidades em chaves filhas, ".d<i>" e ".o<i>"); os ponteiros
    dizem qual é a que contou o uso e a última */
export const PREFIXO_ANALISE = `${PREFIXO}analise-`;
export const PONTEIRO_CONTADA = `${PREFIXO}ponteiro.contada`;
export const PONTEIRO_ULTIMA = `${PREFIXO}ponteiro.ultima`;
/** Padrão: a análise fica SÓ para quem está na lista de liberados (o botão some para os demais e a função recusa
    qualquer modo que não seja "status"). Nenhuma política de acesso libera a análise para outro e-mail; a política só
    decide quem abre o app e quem usa o Dynatrace Assist. Com false, quem não está na lista tem 1 análise por ambiente. */
export const SOMENTE_LIBERADOS = true;
export const RESERVA_MS = 4 * 60_000;
const JANELA_ELEICAO_MS = 60_000;

/** O App State visto pela regra (a função liga ao stateClient; os testes, a um falso em memória). */
export interface Estado {
  /** null = a chave não existe; outro erro de leitura sobe (não é "livre": ler errado daria análises sem limite) */
  ler(chave: string): Promise<{ valor: string; modificadoEm: string | null } | null>;
  /** validade no formato do App State ("now+5m"); sem validade = não expira */
  gravar(chave: string, valor: string, validade?: string): Promise<void>;
  listar(prefixo: string): Promise<{ chave: string; valor: string; modificadoEm: string | null }[]>;
}
export interface Usuario { id: string; nome: string; email: string }

export function ehLiberado(email: string | null | undefined, extras: string[] = []): boolean {
  const e = String(email ?? "").trim().toLowerCase();
  if (!e || e.startsWith("dt.missing")) return false;
  // cada item da lista: um e-mail ("ana@empresa.example") ou um domínio inteiro ("@empresa.example")
  return extras.map((x) => x.trim().toLowerCase()).filter(Boolean).some((x) => (x.startsWith("@") ? e.endsWith(x) : x === e));
}
/** O que mostrar de quem usou: nome e e-mail (identidade da plataforma). */
export const quem = (u: Usuario) => ({ nome: u.nome && !u.nome.startsWith("dt.missing") ? u.nome : u.email || u.id, email: u.email && !u.email.startsWith("dt.missing") ? u.email : "" });

export interface RegistroUso {
  status: "reservado" | "usado" | "liberado";
  ambiente: string;
  por: { nome: string; email: string; id: string };
  quando: string;
  reservaId: string | null;
  /** reservado: até quando vale a reserva (ms) */
  expira: number | null;
  ultimaFalha?: { quando: string; codigo: string } | null;
}
const lerJson = <T>(s: string | null | undefined): T | null => { try { return s ? (JSON.parse(s) as T) : null; } catch { return null; } };

export async function lerUso(estado: Estado): Promise<RegistroUso | null> {
  const r = await estado.ler(CHAVE_USO);
  return lerJson<RegistroUso>(r?.valor);
}
export interface SituacaoUso { disponivel: boolean; usada: { nome: string; email: string; quando: string } | null; emAndamento: { nome: string; email: string; quando: string } | null }
export function situacao(u: RegistroUso | null, agora: number): SituacaoUso {
  const por = (x: RegistroUso) => ({ nome: x.por.nome, email: x.por.email, quando: x.quando });
  if (u?.status === "usado") return { disponivel: false, usada: por(u), emAndamento: null };
  if (u?.status === "reservado" && (u.expira ?? 0) > agora) return { disponivel: false, usada: null, emAndamento: por(u) };
  return { disponivel: true, usada: null, emAndamento: null };
}

export type Reserva = { ok: true; reservaId: string } | { ok: false; motivo: "ja-usada" | "em-andamento"; situacao: SituacaoUso };

/** Tenta ficar com a análise do ambiente (só para quem não está liberado). */
export async function reservarUso(estado: Estado, usuario: Usuario, ambiente: string, agora: () => number, gerarId: () => string): Promise<Reserva> {
  const antes = situacao(await lerUso(estado), agora());
  if (!antes.disponivel) return { ok: false, motivo: antes.usada ? "ja-usada" : "em-andamento", situacao: antes };
  const id = gerarId(), t0 = agora();
  const bilhete = `${PREFIXO_BILHETE}${String(t0).padStart(13, "0")}.${id}`;
  await estado.gravar(bilhete, JSON.stringify({ id, por: usuario.email || usuario.id, quando: new Date(t0).toISOString() }), "now+5m");
  const bilhetes = (await estado.listar(PREFIXO_BILHETE)).map((b) => {
    const ms = Number(b.chave.slice(PREFIXO_BILHETE.length).split(".")[0]);
    const v = lerJson<{ encerrado?: boolean }>(b.valor);
    return { chave: b.chave, ms, servidor: b.modificadoEm ? Date.parse(b.modificadoEm) : NaN, encerrado: !!v?.encerrado };
  }).filter((b) => !b.encerrado && Number.isFinite(b.ms) && t0 - b.ms <= JANELA_ELEICAO_MS);
  if (!bilhetes.some((b) => b.chave === bilhete)) bilhetes.push({ chave: bilhete, ms: t0, servidor: NaN, encerrado: false });
  // ordem: hora da gravação no servidor (quando todos têm), depois a hora do bilhete e a chave
  const todosComServidor = bilhetes.every((b) => Number.isFinite(b.servidor));
  bilhetes.sort((a, b) => (todosComServidor ? a.servidor - b.servidor : 0) || a.ms - b.ms || (a.chave < b.chave ? -1 : a.chave > b.chave ? 1 : 0));
  if (bilhetes[0].chave !== bilhete) {
    await encerrarBilhete(estado, bilhete);
    const depois = situacao(await lerUso(estado), agora());
    return { ok: false, motivo: depois.usada ? "ja-usada" : "em-andamento", situacao: depois.disponivel ? { ...depois, emAndamento: { nome: "", email: "", quando: new Date(agora()).toISOString() } } : depois };
  }
  // conferência final: alguém pode ter terminado entre a primeira leitura e a eleição
  const agoraUso = situacao(await lerUso(estado), agora());
  if (!agoraUso.disponivel) { await encerrarBilhete(estado, bilhete); return { ok: false, motivo: agoraUso.usada ? "ja-usada" : "em-andamento", situacao: agoraUso }; }
  const reg: RegistroUso = { status: "reservado", ambiente, por: { ...quem(usuario), id: usuario.id }, quando: new Date(agora()).toISOString(), reservaId: bilhete, expira: agora() + RESERVA_MS, ultimaFalha: null };
  await estado.gravar(CHAVE_USO, JSON.stringify(reg));
  return { ok: true, reservaId: bilhete };
}
async function encerrarBilhete(estado: Estado, bilhete: string) {
  try { await estado.gravar(bilhete, JSON.stringify({ encerrado: true }), "now+1m"); } catch { /* expira sozinho em 5 min */ }
}

/** Sucesso: a análise do ambiente fica usada (sem validade). */
export async function confirmarUso(estado: Estado, reservaId: string, usuario: Usuario, ambiente: string, agora: number): Promise<RegistroUso> {
  const reg: RegistroUso = { status: "usado", ambiente, por: { ...quem(usuario), id: usuario.id }, quando: new Date(agora).toISOString(), reservaId, expira: null, ultimaFalha: null };
  await estado.gravar(CHAVE_USO, JSON.stringify(reg));
  await encerrarBilhete(estado, reservaId);
  return reg;
}
/** Falha do LLM: o uso volta a ficar livre (com a última falha anotada). */
export async function liberarUso(estado: Estado, reservaId: string, usuario: Usuario, ambiente: string, agora: number, codigo: string): Promise<void> {
  const atual = await lerUso(estado).catch(() => null);
  if (atual && atual.reservaId !== reservaId) { await encerrarBilhete(estado, reservaId); return; }   // não é mais a nossa reserva
  const reg: RegistroUso = { status: "liberado", ambiente, por: { ...quem(usuario), id: usuario.id }, quando: new Date(agora).toISOString(), reservaId: null, expira: null, ultimaFalha: { quando: new Date(agora).toISOString(), codigo } };
  await estado.gravar(CHAVE_USO, JSON.stringify(reg));
  await encerrarBilhete(estado, reservaId);
}

/* ---- Registro de uso ----------------------------------------------------------------------------------- */
export async function gravarRegistro<T extends { id: string; quando: string }>(estado: Estado, registro: T): Promise<void> {
  const chave = `${PREFIXO_REGISTRO}${registro.quando.replace(/[^0-9]/g, "").slice(0, 17)}.${registro.id}`;
  await estado.gravar(chave, JSON.stringify(registro));
}
export async function listarRegistros<T extends { quando: string }>(estado: Estado, max = 100): Promise<T[]> {
  const lista = await estado.listar(PREFIXO_REGISTRO);
  return lista.map((x) => lerJson<T>(x.valor)).filter((x): x is T => !!x).sort((a, b) => (a.quando < b.quando ? 1 : -1)).slice(0, max);
}
