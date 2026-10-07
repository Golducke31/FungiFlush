/**
 * probe-pack-rates.ts — Sonda de economIA de sobres (NO es un gate, es diagnostico).
 *
 * Mide, para N jefes simulados, cuantos sobres caen y de que tipo (base vs
 * expansion). Sirve para responder "¿que porcentaje de obtencion tiene el sobre
 * de expansion?" con numeros reales en vez de leer las constantes.
 *
 *   npx tsx tools/probe-pack-rates.ts
 */
import { RNG } from '../src/engine/rng';
import {
  BOSS_PACK_DROP_CHANCE,
  EXPANSION_PACK_SHARE,
  PACK_PITY_AFTER,
  rollPackDrop,
  rollPackKind,
} from '../src/meta/Packs';

const N = 200_000;
const rng = new RNG(20261007);
let misses = 0;
let drops = 0;
let base = 0;
let expansion = 0;
let maxMissStreak = 0;
let streak = 0;

for (let i = 0; i < N; i++) {
  const roll = rollPackDrop(rng, misses);
  misses = roll.misses;
  streak = roll.drop ? (streak = 0) : streak + 1;
  maxMissStreak = Math.max(maxMissStreak, streak);
  if (!roll.drop) continue;
  drops++;
  if (rollPackKind(rng) === 'expansion') expansion++;
  else base++;
}

const pct = (n: number, d: number): string => `${((100 * n) / d).toFixed(3)}%`;
console.log(`jefes simulados           : ${N}`);
console.log(`sobres que caen           : ${drops}  (${pct(drops, N)} de los jefes)`);
console.log(`  · base                  : ${base}  (${pct(base, N)} de los jefes)`);
console.log(`  · expansion             : ${expansion}  (${pct(expansion, N)} de los jefes)`);
console.log(`share de expansion (dentro de los que caen) : ${pct(expansion, drops)}`);
console.log(`peor racha de fallos consecutivos           : ${maxMissStreak}`);
console.log(
  `config: DROP=${BOSS_PACK_DROP_CHANCE}  PITY=${PACK_PITY_AFTER}  SHARE=${EXPANSION_PACK_SHARE}`,
);
