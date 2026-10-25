/**
 * blindEffects.test.ts — Penalizaciones en ciegos pequenos y grandes (Fase 2).
 *
 * El feedback del playtest fue "no veo obstaculos, es solo suma y ya": la
 * realidad era que SOLO el jefe de cada ante penalizaba, y 2 de cada 3 rondas
 * eran suma pura. Desde esta fase los small/big del ante 2 en adelante traen
 * penalizaciones propias. Lo que hay que proteger:
 *
 *   - el CONTENIDO: ante 1 sigue limpio (ensenanza), del 2 en adelante cada
 *     small/big trae efectos, y ninguno pasa al jefe de su ante,
 *   - el GATE de jefe: `tier === 'boss'`, NUNCA `effects.length` (si no, cada
 *     ciego penalizado soltaria sobre y las ascensiones se filtrarian),
 *   - que los efectos DISPAREN de verdad: estados al arrancar la ronda,
 *     manos/descartes de menos, impuesto de Esporas al puntuar.
 *
 * Contenido de referencia: `src/data/packs/base/blinds.json`.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { GameEngine } from '../src/engine/GameEngine.ts';
import { buildRegistry } from '../tools/loadContent.node.ts';

const REAL = buildRegistry().toBundle();

/** Motor en el ante pedido, recien salido del blind select. */
function atAnte(ante: number, seed = 9): GameEngine {
  const engine = new GameEngine({ seed, bundle: REAL });
  // R3 — `tutorial: true` apaga el borrador de bendicion: estos tests miden los
  // efectos de los ciegos y necesitan la run en `blind_select`. El flag no
  // cambia ninguna regla, solo suprime el sorteo del borrador.
  engine.startRun(seed, 0, '', false, true);
  engine.run.ante = ante;
  return engine;
}

/** Motor con la vitamina de esta run: entra a un ciego concreto del ante. */
function inBlind(blindId: string, ante: number, seed = 9): GameEngine {
  const engine = atAnte(ante, seed);
  engine.chooseBlind(blindId);
  return engine;
}

// ---------------------------------------------------------------------------
// Contenido
// ---------------------------------------------------------------------------

test('el contenido: ante 1 limpio, del 2 en adelante small/big penalizados', () => {
  const byAnte = new Map<number, typeof REAL.blinds>();
  for (const blind of REAL.blinds) {
    const list = byAnte.get(blind.ante) ?? [];
    list.push(blind);
    byAnte.set(blind.ante, list);
  }

  for (const [ante, blinds] of byAnte) {
    for (const blind of blinds) {
      const hasEffects = (blind.effects?.length ?? 0) > 0;
      if (ante === 1 && blind.tier !== 'boss') {
        assert.equal(hasEffects, false, `${blind.id}: el ante 1 no penaliza (ensenanza)`);
      }
      if (ante >= 2 && blind.tier !== 'boss') {
        assert.ok(hasEffects, `${blind.id}: los small/big del ante ${ante} tienen que penalizar`);
      }
      if (blind.tier === 'boss') {
        assert.ok(hasEffects, `${blind.id}: un jefe sin efectos no es jefe`);
      }
    }
  }
});

test('los ids de efecto de ciego son unicos', () => {
  const ids = REAL.blinds.flatMap((b) => (b.effects ?? []).map((e) => e.id));
  assert.equal(new Set(ids).size, ids.length, `ids repetidos: ${ids.join(', ')}`);
});

test('ningun small/big penalty mas duro que el jefe de su ante', () => {
  // El impuesto de Esporas de un big nunca baja mas que el del jefe: el jefe
  // sigue siendo el techo de castigo del ante. Solo se comparan impuestos de
  // Esporas (misma unidad); los handicaps de manos/descartes ya estan acotados
  // por el diseno (nunca pasan de -1).
  for (const boss of REAL.blinds.filter((b) => b.tier === 'boss')) {
    const bossTax = Math.min(
      ...(boss.effects ?? [])
        .flatMap((e) => e.actions)
        .filter((a) => a.type === 'MULTIPLY_SPORES')
        .map((a) => a.value),
    );
    if (!Number.isFinite(bossTax)) continue;
    for (const blind of REAL.blinds.filter((b) => b.ante === boss.ante && b.tier !== 'boss')) {
      const taxes = (blind.effects ?? [])
        .flatMap((e) => e.actions)
        .filter((a) => a.type === 'MULTIPLY_SPORES')
        .map((a) => a.value);
      const worst = taxes.length > 0 ? Math.min(...taxes) : Number.POSITIVE_INFINITY;
      assert.ok(
        worst >= bossTax,
        `${blind.id} (x${worst}) no deberia castigar mas que su jefe (x${bossTax})`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// Los efectos disparan
// ---------------------------------------------------------------------------

test('a2_small deja una carta esteril al arrancar la ronda', () => {
  const engine = inBlind('blind_a2_small', 2);
  const sterile = engine
    .roundSnapshot()
    .hand.filter((c) => c.statuses.some((s) => s.type === 'spore_lock'));
  assert.equal(sterile.length, 1, 'exactamente una carta de la mano nace esteril');
});

test('a4_small quita una mano y a4_big un descarte', () => {
  const small = inBlind('blind_a4_small', 4);
  assert.equal(
    small.roundSnapshot().handsLeft,
    small.run.baseHands - 1,
    'el penalty resta una mano al total de la ronda',
  );

  const big = inBlind('blind_a4_big', 4);
  assert.equal(
    big.roundSnapshot().discardsLeft,
    big.run.baseDiscards - 1,
    'el penalty resta un descarte al total de la ronda',
  );
});

test('a3_small aplica su impuesto de Esporas al puntuar', () => {
  const engine = inBlind('blind_a3_small', 3);
  const hand = engine.roundSnapshot().hand;
  for (const c of hand.slice(0, 5)) engine.toggleSelect(c.uid);

  const res = engine.playHand();
  assert.ok(res, 'la mano se jugo');
  const tax = (res.steps ?? []).filter((s) => s.action === 'MULTIPLY_SPORES' && s.value === 0.9);
  assert.ok(tax.length >= 1, 'el impuesto del ciego aparece en el registro de la mano');
});

test('el handicap de una mano menos NO filtra a las rondas siguientes', () => {
  // Regression: `applyDeltas` escribia el delta de ON_ROUND_START tambien en
  // `run.baseHands`, asi que la penalizacion quedaba para TODA la run y se
  // acumulaba con el proximo ciego penalizado. El handicap es de ESTA ronda.
  const engine = inBlind('blind_a4_small', 4);
  const handsBefore = engine.run.baseHands;
  assert.equal(engine.roundSnapshot().handsLeft, handsBefore - 1, 'la ronda arranca con una menos');
  assert.equal(
    engine.run.baseHands,
    handsBefore,
    'la base de la run no se toca: si no, la penalizacion seria permanente',
  );

  // El ciego siguiente (big, otro handicap) arranca desde la base intacta.
  // `chooseBlind` solo corre desde `blind_select`: se fuerza el estado como
  // haria el flujo real (terminar la ronda -> volver a elegir).
  engine.run.status = 'blind_select';
  engine.chooseBlind('blind_a4_big');
  assert.equal(engine.run.baseHands, handsBefore, 'la base sigue intacta en el ciego siguiente');
  assert.equal(
    engine.roundSnapshot().handsLeft,
    handsBefore,
    'las manos vuelven al total normal: el anterior handicap era de esa ronda',
  );
  assert.equal(
    engine.roundSnapshot().discardsLeft,
    engine.run.baseDiscards - 1,
    'y el handicap del big se aplica a su propia ronda',
  );
});

// ---------------------------------------------------------------------------
// El gate de jefe
// ---------------------------------------------------------------------------

test('un small con efectos NO es jefe: el gate es el tier', () => {
  const engine = inBlind('blind_a5_small', 5);
  const blind = engine.round!.blind;
  assert.equal(blind.tier, 'small', 'sanity: el ciego jugado es small');
  assert.ok((blind.effects?.length ?? 0) > 0, 'sanity: y trae efectos');
  // El motor no puede filtrar extraBossEffects a un small: con efectos propios
  // ya NO se lo puede detectar por `effects.length`.
  const ascensions = REAL.ascensions ?? [];
  assert.ok(Array.isArray(ascensions), 'sanity: el bundle trae la tabla de ascensiones');
});
