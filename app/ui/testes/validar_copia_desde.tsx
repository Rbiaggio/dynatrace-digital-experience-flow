/* Validação da instalação nova (1.47.4/1.47.5), sem tenant: com a hora em que a cópia das sessões começou
   (lib/copiaDesde.ts, gravada pelo "Aplicar"), a análise de hora em hora não pende as horas que terminaram antes dela,
   com 10 min de margem (evento atrasado, relógio do navegador); registro ausente ou mais de 1 h no futuro = a lista de
   sempre (23 horas). E a previsão da primeira hora analisada que a Visão geral mostra.
   Roda com: npx esbuild ui/testes/validar_copia_desde.tsx --bundle --platform=node --format=cjs --outfile=<saida>.cjs && node <saida>.cjs */
import { unidadesPendentes, previsaoPrimeiraHora, HORAS_CONFERIDAS, PARTES_HORA } from "../app/lib/horaria";

let falhas = 0;
const ok = (c: boolean, msg: string) => { console.log(`${c ? "✓" : "✗"} ${msg}`); if (!c) falhas++; };
const T = (s: string) => Date.parse(s);
const agora = T("2026-10-28T12:10:00Z"), desde = T("2026-10-28T11:38:00Z");
const nada = new Set<string>();

const antes = unidadesPendentes(agora, nada, "j1");
const horasAntes = new Set(antes.map((u) => u.hora));
ok(horasAntes.size === HORAS_CONFERIDAS, `sem o registro: ${horasAntes.size} horas pendentes (as ${HORAS_CONFERIDAS} de sempre)`);

const depois = unidadesPendentes(agora, nada, "j1", desde);
console.log("  com a cópia desde 11:38Z, às 12:10Z: " + depois.map((u) => u.unidade).join(", "));
ok(depois.every((u) => u.hora + 3600000 > desde), "nenhuma hora que terminou antes da cópia");
ok(depois.length > 0 && depois.every((u) => u.hora === T("2026-10-28T11:00:00Z")), "só a hora 11:00Z, a da instalação (as partes já prontas)");
ok(JSON.stringify(unidadesPendentes(agora, nada, "j1", null)) === JSON.stringify(antes), "registro ausente (null) = comportamento de antes");

// 1.47.5: margem de 10 min (evento atrasado, relógio do navegador)
const horas = (desde: number | null, em = T("2026-10-28T14:40:00Z")) => new Set(unidadesPendentes(em, nada, "j1", desde).map((u) => new Date(u.hora).toISOString().slice(11, 16)));
const h1100 = horas(T("2026-10-28T11:00:00Z"));
ok(h1100.has("10:00") && h1100.has("11:00") && !h1100.has("09:00"), "cópia desde 11:00:00Z em ponto: pela margem a hora 10:00Z entra (pode ter evento atrasado), a 09:00Z fica de fora");
const h1115 = horas(T("2026-10-28T11:15:00Z"));
ok(!h1115.has("10:00") && h1115.has("11:00"), "cópia desde 11:15Z: a hora 10:00Z fica de fora (terminou 15 min antes), a 11:00Z entra");
ok(new Set(unidadesPendentes(T("2026-10-28T14:40:00Z"), nada, "j1", T("2026-10-28T11:15:00Z")).filter((u) => u.hora === T("2026-10-28T12:00:00Z")).map((u) => u.parte)).size === PARTES_HORA.length, "as horas depois da cópia têm todas as partes");
ok(horas(T("2026-10-28T12:40:00Z"), agora).size === 0, "registro 30 min no futuro (relógio adiantado): conta como agora, nenhuma hora pendente antes dele");
ok(horas(T("2026-10-28T14:30:00Z"), agora).size === HORAS_CONFERIDAS, "registro mais de 1 h no futuro: não vale, as 23 horas de sempre");

const p = previsaoPrimeiraHora(desde);
console.log(`  previsão da primeira hora analisada (cópia desde 11:38Z): ${new Date(p).toISOString()}`);
ok(p === T("2026-10-28T12:50:00Z"), "12:50Z = a hora 11:00Z fecha, mais 30 min das sessões, 3 de atraso e até 15 da cadência, arredondado a 5 min");
ok(previsaoPrimeiraHora(T("2026-10-28T11:05:00Z")) === T("2026-10-28T11:50:00Z"), "cópia desde 11:05Z: pela margem a primeira hora é a 10:00Z, pronta por volta das 11:50Z");
console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exit(falhas === 0 ? 0 : 1);
