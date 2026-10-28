/* App State falso em memória para a regra de uso: mesma semântica que importa (chave única, validade "now+Nm",
   listagem por prefixo, hora da gravação no servidor em ordem de gravação) e ganchos para forçar a corrida de dois
   cliques (barreira antes de listar) e falhas de leitura. */
import type { Estado } from "../../lib/usoLlm";

export class EstadoMemoria implements Estado {
  dados = new Map<string, { valor: string; modificadoEm: string; expira: number | null }>();
  falharLeitura = false;
  falharGravacao = false;
  gravacoes: string[] = [];
  private seq = 0;
  private espera: { n: number; chegaram: number; soltar: (() => void)[] } | null = null;
  constructor(public relogio: () => number = Date.now, public atrasoMs = 0) {}

  /** As próximas n listagens esperam umas pelas outras: todas as tentativas gravam o bilhete antes de qualquer uma listar. */
  barreiraAntesDeListar(n: number) { this.espera = { n, chegaram: 0, soltar: [] }; }

  private async pausa() { await new Promise((ok) => setTimeout(ok, this.atrasoMs ? Math.random() * this.atrasoMs : 0)); }
  private vivo(k: string) { const x = this.dados.get(k); return x && (x.expira == null || x.expira > this.relogio()) ? x : null; }

  async ler(chave: string) {
    await this.pausa();
    if (this.falharLeitura) throw Object.assign(new Error("Internal server error"), { name: "InternalServerError", response: { status: 500 } });
    const x = this.vivo(chave);
    return x ? { valor: x.valor, modificadoEm: x.modificadoEm } : null;
  }
  async gravar(chave: string, valor: string, validade?: string) {
    await this.pausa();
    if (this.falharGravacao) throw new Error("Forbidden");
    const m = validade ? /^now\+(\d+)([smhd])$/.exec(validade) : null;
    const ms = m ? Number(m[1]) * { s: 1e3, m: 6e4, h: 36e5, d: 864e5 }[m[2] as "s" | "m" | "h" | "d"] : null;
    this.dados.set(chave, { valor, modificadoEm: new Date(1.9e12 + ++this.seq).toISOString(), expira: ms == null ? null : this.relogio() + ms });
    this.gravacoes.push(chave);
  }
  async listar(prefixo: string) {
    if (this.espera) {
      const e = this.espera;
      e.chegaram++;
      if (e.chegaram >= e.n) { this.espera = null; e.soltar.forEach((f) => f()); }
      else await new Promise<void>((ok) => e.soltar.push(ok));
    }
    await this.pausa();
    return [...this.dados.keys()].filter((k) => k.toLowerCase().startsWith(prefixo.toLowerCase()) && this.vivo(k))
      .map((k) => ({ chave: k, valor: this.dados.get(k)!.valor, modificadoEm: this.dados.get(k)!.modificadoEm }));
  }
  json<T>(chave: string): T | null { const x = this.vivo(chave); return x ? (JSON.parse(x.valor) as T) : null; }
}

/** App State de consistência eventual: depois de regravar uma chave que JÁ existia, por `atrasoReplicaMs` a leitura dela
    devolve a versão ANTERIOR (réplica atrasada), como aconteceu no LAB em 17/10/2026 com a marca da síntese. Chave nova
    aparece na hora (o caso real: a análise recém-criada era lida normalmente; só a marca regravada vinha velha). */
export class EstadoReplicaAtrasada extends EstadoMemoria {
  anteriores = new Map<string, { valor: string; modificadoEm: string; ate: number }>();
  constructor(public atrasoReplicaMs = 500) { super(); }
  override async gravar(chave: string, valor: string, validade?: string) {
    const antes = this.dados.get(chave);
    await super.gravar(chave, valor, validade);
    if (antes) this.anteriores.set(chave, { valor: antes.valor, modificadoEm: antes.modificadoEm, ate: Date.now() + this.atrasoReplicaMs });
  }
  override async ler(chave: string) {
    const velha = this.anteriores.get(chave);
    if (velha && velha.ate > Date.now()) return { valor: velha.valor, modificadoEm: velha.modificadoEm };
    return super.ler(chave);
  }
}
