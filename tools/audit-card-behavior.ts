/**
 * audit-card-behavior.ts — AUDITORIA DE ACTIVACION Y PUNTUACION del contenido.
 *
 * Responde a "¿cada carta hace de verdad lo que dice su texto?". Corre dos
 * capas y NO es un gate con exit code: es un informe para leer (el equipo decide
 * que se arregla y que es una decision de contenido).
 *
 * A) ESTATICA — combos estructuralmente muertos o mal calibrados:
 *      - condiciones que dependen de `triggerCard` en eventos GLOBALES
 *        (`is_first_card_of_round`, `is_last_card_of_hand`): el evento se
 *        despacha sin carta, asi que `buildWorld` las deja en false SIEMPRE.
 *      - targets `previous_scored`/`next_scored` en eventos globales: sin
 *        `triggerCard` devuelven [], o sea el efecto no aplica nunca.
 *      - `element_is`/`family_is`/`rarity_is` en `ON_CARD_PLAYED`: el motor
 *        evalua el SUJETO (`source.card`, la carta DUEÑA del efecto), no la
 *        carta que se jugo. Si el valor coincide con la propia carta la
 *        condicion es siempre verdadera (SOBRE-DISPARO); si no, nunca dispara.
 *        Peor en SIMBIONTES: `sourceFromJoker` no expone `card`, asi que
 *        `subject` es `undefined` y la condicion es siempre falsa.
 *      - `has_status` (mira SOLO la carta que lleva el efecto) en una carta
 *        cuyo texto habla de la mano o de "tus cartas".
 *      - un estado que la propia carta aplica con APPLY_STATUS y que consulta
 *        en la MISMA mano: la mutacion es DIFERIDA a `applyDeltas`, asi que la
 *        condicion no lo ve.
 *      - el texto dice "en la mano" pero la condicion cuenta cartas PUNTUADAS.
 *   B) EMPIRICA — MAZO DE EXACTAMENTE 6 CARTAS: la carta auditada + 5 rellenos
 *      sinteticos. Como la mano inicial es de 6, la mano ES el mazo entero: la
 *      carta esta SIEMPRE en la mano desde el reparto, asi que los efectos de
 *      ON_ROUND_START / ON_BLIND_SELECTED tambien la ven (si se forzara la mano
 *      despues de `chooseBlind`, esos dos eventos ya habrian pasado y la carta
 *      no habria estado en la mano -> falso negativo).
 *
 *      Los rellenos se derivan de las CONDICIONES de la carta (elemento/familia
 *      pedidos por `scored_*` / `*_in_hand`) para que las condiciones de conteo
 *      sean satisfacibles, y llevan un `GAIN_MONEY` para que se emita
 *      ON_MONEY_GAINED (si no, ese trigger no ocurre nunca en un test). Los
 *      simbiontes se auditan aparte, con 3 simbiontes extra para `jokers_gte`.
 *
 *      Se registra `trigger:fired` (que trae el `EffectDefinition`): un efecto
 *      declarado que no dispara en NINGUN escenario es candidato firme a bug de
 *      activacion. La seccion D mide el SOBRE-DISPARO (cuantas veces dispara un
 *      "por cada carta" cuando las otras cartas jugadas NO son de ese
 *      elemento/familia).
 *
 *   npx tsx tools/audit-card-behavior.ts
 */

import { readFileSync } from 'node:fs';
import { GameEngine } from '../src/engine/GameEngine.ts';
import { bus } from '../src/engine/events.ts';
import { buildRegistry } from './loadContent.node.ts';
import type { CardDefinition, CardInstance, ContentBundle, TriggerEvent } from '../src/engine/index.ts';

const REAL = buildRegistry().toBundle();
const ES = JSON.parse(readFileSync(new URL('../src/i18n/es.json', import.meta.url), 'utf8')) as Record<
  string,
  Record<string, { name?: string; desc?: string }>
>;

const GLOBAL_TRIGGERS = new Set<TriggerEvent>([
  'ON_RUN_START', 'ON_BLIND_SELECTED', 'ON_ROUND_START', 'ON_HAND_SCORED',
  'ON_SHOP_ENTER', 'ON_SHOP_EXIT', 'ON_ROUND_WIN', 'ON_ROUND_LOSS',
]);
const TRIGGER_CARD_CONDITIONS = new Set(['is_first_card_of_round', 'is_last_card_of_hand']);
const OWNER_CONDITIONS = new Set(['element_is', 'family_is', 'rarity_is']);

type Action = { type: string; value?: number; status?: string; gain?: string; full?: boolean; stacks?: number };
type Cond = { type: string; value?: string; status?: string; element?: string; family?: string; count?: number; families?: number; cond?: unknown; conds?: unknown[] };
type EffectLike = { id?: string; trigger: TriggerEvent; target?: string; conditions?: Cond[]; actions: Action[]; once?: string };

const flatConds = (conds: Cond[] | undefined): Cond[] => {
  const out: Cond[] = [];
  const walk = (c: Cond): void => {
    out.push(c);
    if (c.type === 'not' && c.cond) walk(c.cond as Cond);
    if ((c.type === 'all' || c.type === 'any') && c.conds) for (const ch of c.conds) walk(ch as Cond);
  };
  for (const c of conds ?? []) walk(c);
  return out;
};

const ALL_ELEMENTS = ['mycelium', 'crystal', 'decay', 'spore', 'symbiosis', 'poison', 'parasite', 'neutral'];
const ALL_FAMILIES = ['tricholomataceae', 'agaricaceae', 'boletaceae', 'clavariaceae', 'polyporaceae', 'amanitaceae'];

const descOfCard = (id: string): string => ES['card']?.[id]?.desc ?? '';
const nameOfCard = (id: string): string => ES['card']?.[id]?.name ?? id;
const descOfJoker = (id: string): string => ES['joker']?.[id]?.desc ?? '';
const nameOfJoker = (id: string): string => ES['joker']?.[id]?.name ?? id;

// ---------------------------------------------------------------------------
// Arnés
// ---------------------------------------------------------------------------

const filler = (id: string, element: string, family: string, moneyId: string): CardDefinition => ({
  id,
  nameKey: `card.${id}.name`,
  descKey: `card.${id}.desc`,
  element: element as CardDefinition['element'],
  family: family as CardDefinition['family'],
  rarity: 'common',
  baseSubstrate: 10,
  baseSpores: 1,
  cost: 3,
  art: { hue: 100, pattern: 'radial' },
  tags: ['starter'],
  copies: 1,
  effects: [
    { id: moneyId, trigger: 'ON_HAND_SCORED', actions: [{ type: 'GAIN_MONEY', value: 1 }] },
  ] as never,
});

function bundleWith(cards: CardDefinition[], jokerDefs: unknown[] = []): ContentBundle {
  return {
    cards,
    jokers: jokerDefs as never,
    blinds: [{ id: 'b1', nameKey: 'blind.b1.name', descKey: 'blind.b1.desc', ante: 1, scoreMultiplier: 1, reward: 3 }],
    anteTargets: { 1: 1000 },
  };
}

let capture: Array<{ sourceId: string; effectId: string | undefined }> = [];
bus.on('trigger:fired', ({ sourceId, effect }) => {
  capture.push({ sourceId, effectId: (effect as EffectLike | undefined)?.id });
});

type Scenario = 'blind' | 'playFirst' | 'playLast' | 'playFew' | 'playStatused' | 'hold' | 'discard' | 'winHeld';

const SCENARIOS: Scenario[] = ['blind', 'playFirst', 'playLast', 'playFew', 'playStatused', 'hold', 'discard', 'winHeld'];

function runScenario(card: CardDefinition, scenario: Scenario, jokerDefs: Array<{ id: string }>): { fired: Set<string>; error?: string } {
  const wantedElements = new Set<string>();
  const wantedFamilies = new Set<string>();
  for (const e of (card.effects ?? []) as EffectLike[]) {
    for (const c of flatConds(e.conditions)) {
      if (c.type === 'element_in_hand' && c.value) wantedElements.add(c.value);
      if (c.type === 'scored_element_count_gte' && c.element) wantedElements.add(c.element);
      if (c.type === 'scored_element_families_gte' && c.element) wantedElements.add(c.element);
      if (c.type === 'family_in_hand' && c.value) wantedFamilies.add(c.value);
      if (c.type === 'scored_family_count_gte' && c.family) wantedFamilies.add(c.family);
      // `element_is`/`family_is` (y sus hermanas `trigger_*`) piden que la carta
      // de ese elemento/familia este en juego, asi que los rellenos tienen que
      // ser de ahi.
      if ((c.type === 'element_is' || c.type === 'trigger_element_is') && c.value) wantedElements.add(c.value);
      if ((c.type === 'family_is' || c.type === 'trigger_family_is') && c.value) wantedFamilies.add(c.value);
    }
  }
  const altElement = ALL_ELEMENTS.find((x) => x !== card.element) ?? 'crystal';
  const altFamily = ALL_FAMILIES.find((x) => x !== card.family) ?? 'boletaceae';

  // Pares (elemento, familia) que satisfacen las condiciones pedidas.
  const pairs: Array<[string, string]> = [];
  for (const F of wantedFamilies) {
    pairs.push([card.element, F]);
    pairs.push([altElement, F]);
  }
  for (const E of wantedElements) {
    pairs.push([E, card.family]);
    pairs.push([E, altFamily]);
  }
  if (pairs.length === 0) pairs.push([card.element, card.family]);

  // 5 rellenos ciclando los pares (asi una condicion ">= 5 de la familia X"
  // tambien se puede satisfacer aunque X aparezca en 2 pares distintos).
  const defs = pairs.map(([e, f], i) => filler(`zz_f${i}`, e, f, `zz_money${i}`));
  const chosenDefs: CardDefinition[] = [];
  for (let i = 0; i < 5; i += 1) chosenDefs.push(defs[i % defs.length]!);
  const copies = new Map<string, number>();
  for (const d of chosenDefs) copies.set(d.id, (copies.get(d.id) ?? 0) + 1);

  const engine = new GameEngine({ seed: 11, bundle: bundleWith([card, ...defs], jokerDefs) });
  engine.setArchetypeLoadout(
    [{ cardId: card.id, copies: 1 }, ...[...copies].map(([id, n]) => ({ cardId: id, copies: n }))],
    [],
  );
  engine.startRun(11);
  for (const jd of jokerDefs) {
    try {
      engine.run.jokers.push(engine.registry.instantiateJoker(jd.id));
    } catch { /* no instanciable */ }
  }

  capture = [];
  engine.chooseBlind('b1'); // ON_BLIND_SELECTED + ON_ROUND_START (la carta YA esta en la mano)

  const hand = engine.roundSnapshot().hand;
  const me = hand.find((c) => c.def.id === card.id);
  if (!me) return { fired: new Set(), error: 'la carta no quedo en la mano inicial' };
  const others = hand.filter((c) => c.uid !== me.uid);

  const rot = (t: CardInstance, value: number, status: 'decay' | 'overgrowth' | 'spore_lock' | 'dormant' = 'decay'): void => {
    t.statuses = [...t.statuses.filter((s) => s.type !== status), { type: status, value, turnsLeft: 3 }];
  };

  const round = engine.round;

  try {
    if (scenario === 'blind') {
      // cubierto por chooseBlind
    } else if (scenario === 'playFirst' || scenario === 'playLast') {
      const order = scenario === 'playFirst' ? [me, ...others.slice(0, 4)] : [...others.slice(0, 4), me];
      for (const c of order) engine.toggleSelect(c.uid);
      engine.playHand();
    } else if (scenario === 'playFew') {
      for (const c of [me, ...others.slice(0, 1)]) engine.toggleSelect(c.uid);
      engine.playHand();
    } else if (scenario === 'playStatused') {
      rot(me, 3);
      rot(me, 2, 'overgrowth');
      rot(me, 1, 'spore_lock');
      for (const c of others.slice(0, 3)) rot(c, 3);
      if (others[3]) rot(others[3], 2, 'overgrowth');
      for (const c of [me, ...others.slice(0, 4)]) engine.toggleSelect(c.uid);
      engine.playHand();
    } else if (scenario === 'hold') {
      for (const c of others.slice(0, 5)) engine.toggleSelect(c.uid);
      engine.playHand();
    } else if (scenario === 'discard') {
      engine.toggleSelect(me.uid);
      engine.discardSelected();
    } else if (scenario === 'winHeld') {
      if (round) round.target = 1;
      for (const c of others.slice(0, 5)) engine.toggleSelect(c.uid);
      engine.playHand();
      engine.chooseReward(null);
    }
  } catch (error) {
    return { fired: new Set(), error: `${scenario}: ${(error as Error).message}` };
  }

  const fired = new Set<string>();
  for (const e of capture) if (e.sourceId === me.uid && e.effectId) fired.add(e.effectId);
  return { fired };
}

// ---------------------------------------------------------------------------
// Estática
// ---------------------------------------------------------------------------

type Finding = { kind: 'activacion' | 'puntuacion'; severity: 'alta' | 'media' | 'baja'; detail: string };

function staticFindings(desc: string, effects: EffectLike[]): Finding[] {
  const out: Finding[] = [];
  const d = desc.toLowerCase();
  const handText = /\bla mano\b|\btus cartas\b|\ben mano\b/.test(d);

  for (const e of effects) {
    const flat = flatConds(e.conditions);
    const types = flat.map((c) => c.type);
    const global = GLOBAL_TRIGGERS.has(e.trigger);

    for (const t of types) {
      if (global && TRIGGER_CARD_CONDITIONS.has(t)) {
        out.push({
          kind: 'activacion', severity: 'alta',
          detail: `"${e.id}" (${e.trigger}): condicion \`${t}\` en un evento GLOBAL (sin carta disparadora) -> siempre false; el efecto NO dispara jamas.`,
        });
      }
    }
    if (global && (e.target === 'previous_scored' || e.target === 'next_scored')) {
      out.push({
        kind: 'activacion', severity: 'alta',
        detail: `"${e.id}" (${e.trigger}): target \`${e.target}\` en evento global -> sin carta disparadora resuelve a [] y el efecto no aplica nunca.`,
      });
    }
    if (types.includes('has_status') && handText) {
      out.push({
        kind: 'activacion', severity: 'alta',
        detail: `"${e.id}": usa \`has_status\` (mira SOLO la propia carta) pero el texto habla de la mano / "tus cartas" -> exige estar afectada ELLA misma.`,
      });
    }
    // NOTA: aplicar un estado con APPLY_STATUS y consultarlo en la MISMA mano ya
    // NO es un bug. `APPLY_STATUS` sigue difiriendo la mutacion a `applyDeltas`,
    // pero las condiciones de estado y `CONSUME_STATUS` ahora miran tambien los
    // pedidos pendientes (`ConditionWorld.pendingStatuses`), asi que
    // `deep_latent_sporocarp` revienta su Sobrecrecimiento en la misma mano y
    // `deep_carrion_lattice` cobra lo que acaba de pudrir.
  }
  return out;
}

function ownerConditionFinding(card: CardDefinition, effects: EffectLike[]): Finding[] {
  const out: Finding[] = [];
  for (const e of effects) {
    if (e.trigger !== 'ON_CARD_PLAYED') continue;
    const own = flatConds(e.conditions).filter((c) => OWNER_CONDITIONS.has(c.type));
    if (own.length === 0) continue;
    const matches = own.some((c) => c.value === card.element || c.value === card.family || c.value === card.rarity);
    const d = descOfCard(card.id).toLowerCase();
    const perCard = /cada carta|cada micelio|cada descarte|por cada/.test(d);
    if (matches && perCard) {
      out.push({
        kind: 'puntuacion', severity: 'alta',
        detail: `"${e.id}" (ON_CARD_PLAYED): \`${own.map((c) => `${c.type}=${c.value}`).join(',')}\` evalua la carta DUEÑA (es su propio valor) -> la condicion es SIEMPRE verdadera: dispara con CADA carta jugada, no solo con las de ese elemento/familia.`,
      });
    } else if (!matches) {
      out.push({
        kind: 'activacion', severity: 'alta',
        detail: `"${e.id}" (ON_CARD_PLAYED): \`${own.map((c) => `${c.type}=${c.value}`).join(',')}\` evalua la carta DUEÑA, que NO es de ese elemento/familia -> SIEMPRE falsa: el efecto no dispara nunca.`,
      });
    }
  }
  return out;
}

function handVsScoredFinding(desc: string, effects: EffectLike[]): Finding[] {
  const out: Finding[] = [];
  const d = desc.toLowerCase();
  if (!/\ben la mano\b|\ben mano\b/.test(d)) return out;
  for (const e of effects) {
    const scored = flatConds(e.conditions).map((c) => c.type).filter((t) => t.startsWith('scored_'));
    if (scored.length > 0) {
      out.push({
        kind: 'puntuacion', severity: 'media',
        detail: `"${e.id}": el texto dice "en la mano" pero la condicion cuenta cartas PUNTUADAS (\`${scored.join(',')}\`): las que se quedan en la mano no cuentan.`,
      });
    }
  }
  return out;
}

console.log('Corriendo escenarios...\n');

// 2 simbiontes REALES (hacen falta para las condiciones `jokers_gte`). Van con
// su definicion COMPLETA: el registro los instancia desde el bundle.
const JOKER_DEFS = (REAL.jokers ?? []).slice(0, 2) as unknown as Array<{ id: string }>;

type Row = {
  id: string; name: string; desc: string; isJoker: boolean;
  effects: EffectLike[]; neverFired: string[]; findings: Finding[];
  scenariosOk: number; scenarioError?: string;
};

const rows: Row[] = [];

for (const card of REAL.cards) {
  const effects = (card.effects ?? []) as EffectLike[];
  const desc = descOfCard(card.id);
  const findings = [...staticFindings(desc, effects), ...ownerConditionFinding(card, effects), ...handVsScoredFinding(desc, effects)];
  const fired = new Set<string>();
  let error: string | undefined;
  let ok = 0;
  if (effects.length > 0) {
    for (const s of SCENARIOS) {
      const r = runScenario(card, s, JOKER_DEFS);
      if (r.error) { if (!error) error = r.error; continue; }
      ok += 1;
      for (const f of r.fired) fired.add(f);
    }
  }
  rows.push({
    id: card.id, name: nameOfCard(card.id), desc, isJoker: false, effects,
    neverFired: effects.filter((e) => e.id && !fired.has(e.id)).map((e) => e.id as string),
    findings, scenariosOk: ok, ...(error ? { scenarioError: error } : {}),
  });
}

for (const joker of REAL.jokers ?? []) {
  const effects = (joker.effects ?? []) as EffectLike[];
  // --- Escenarios para SIMBIONTES ---
  // Un simbionte NO tiene `card`: `sourceFromJoker` no expone `card`, asi que en
  // el TriggerEngine `subject = source.card` es `undefined` y toda condicion que
  // mire al sujeto (`element_is`, `family_is`, `rarity_is`, `has_status`) es
  // FALSA. Se mide jugando cartas que SI cumplen lo que pide el texto.
  const wantedElements = new Set<string>();
  const wantedFamilies = new Set<string>();
  for (const e of effects) {
    for (const c of flatConds(e.conditions)) {
      if (c.type === 'element_in_hand' && c.value) wantedElements.add(c.value);
      if (c.type === 'scored_element_count_gte' && c.element) wantedElements.add(c.element);
      if (c.type === 'scored_element_families_gte' && c.element) wantedElements.add(c.element);
      if (c.type === 'element_is' && c.value) wantedElements.add(c.value);
      if (c.type === 'trigger_element_is' && c.value) wantedElements.add(c.value);
      if (c.type === 'family_in_hand' && c.value) wantedFamilies.add(c.value);
      if (c.type === 'scored_family_count_gte' && c.family) wantedFamilies.add(c.family);
      if (c.type === 'family_is' && c.value) wantedFamilies.add(c.value);
      if (c.type === 'trigger_family_is' && c.value) wantedFamilies.add(c.value);
    }
  }
  const elems = [...wantedElements];
  const fams = [...wantedFamilies];
  const altFam = ALL_FAMILIES.find((x) => x !== (fams[0] ?? 'agaricaceae')) ?? 'boletaceae';
  // Un relleno por elemento/familia pedidos (una condicion `element_in_hand`
  // puede pedir DOS elementos distintos a la vez), mas una segunda familia del
  // primer elemento para `scored_element_families_gte` (`families >= 2`).
  const jPairs: Array<[string, string]> = [];
  if (elems.length === 0 && fams.length === 0) jPairs.push(['neutral', 'agaricaceae']);
  for (const E of elems) jPairs.push([E, fams[0] ?? 'agaricaceae']);
  for (const F of fams) jPairs.push([elems[0] ?? 'neutral', F]);
  if (elems.length > 0) jPairs.push([elems[0]!, altFam]);
  const jFillers = jPairs.map(([e, f], i) => filler(`zz_j${i}`, e, f, `zz_j${i}_money`));
  const jChosen: CardDefinition[] = [];
  for (let i = 0; i < 6; i += 1) jChosen.push(jFillers[i % jFillers.length]!);
  const jCopies = new Map<string, number>();
  for (const d of jChosen) jCopies.set(d.id, (jCopies.get(d.id) ?? 0) + 1);
  // 3 simbiontes EXTRA para que `jokers_gte 3/4` sea satisfacible.
  const extraJokers = (REAL.jokers ?? []).filter((j) => j.id !== joker.id).slice(0, 3) as unknown as Array<{ id: string }>;
  const fired = new Set<string>();
  let ok = 0;
  let error: string | undefined;
  for (const scenario of ['blind', 'play', 'hold', 'discard', 'winHeld'] as const) {
    const engine = new GameEngine({ seed: 13, bundle: bundleWith(jFillers, [joker, ...extraJokers]) });
    engine.setArchetypeLoadout(
      [...jCopies].map(([id, n]) => ({ cardId: id, copies: n })),
      [],
    );
    engine.startRun(13);
    try {
      engine.run.jokers.push(engine.registry.instantiateJoker(joker.id));
      for (const ej of extraJokers) engine.run.jokers.push(engine.registry.instantiateJoker(ej.id));
    } catch { /* no instanciable */ }
    capture = [];
    engine.chooseBlind('b1');
    const hand = engine.roundSnapshot().hand;
    const uid = engine.run.jokers[0]?.uid;
    if (!uid) { if (!error) error = 'simbionte no instanciado'; continue; }
    try {
      if (scenario === 'blind') {
        // cubierto
      } else if (scenario === 'play') {
        for (const c of hand.slice(0, 5)) engine.toggleSelect(c.uid);
        engine.playHand();
      } else if (scenario === 'hold') {
        for (const c of hand.slice(0, 1)) engine.toggleSelect(c.uid);
        engine.playHand();
      } else if (scenario === 'discard') {
        for (const c of hand.slice(0, 2)) engine.toggleSelect(c.uid);
        engine.discardSelected();
      } else if (scenario === 'winHeld') {
        const round = engine.round;
        if (round) round.target = 1;
        for (const c of hand.slice(0, 5)) engine.toggleSelect(c.uid);
        engine.playHand();
        engine.chooseReward(null);
      }
      ok += 1;
    } catch (e) {
      if (!error) error = `${scenario}: ${(e as Error).message}`;
      continue;
    }
    for (const ev of capture) if (ev.sourceId === uid && ev.effectId) fired.add(ev.effectId);
  }
  rows.push({
    id: joker.id, name: nameOfJoker(joker.id), desc: descOfJoker(joker.id), isJoker: true,
    effects,
    neverFired: effects.filter((e) => e.id && !fired.has(e.id)).map((e) => e.id as string),
    findings: [], scenariosOk: ok, ...(error ? { scenarioError: error } : {}),
  });
}

console.log('='.repeat(80));
console.log('A) HALLAZGOS ESTATICOS');
console.log('='.repeat(80));
for (const r of rows) {
  for (const f of r.findings) {
    console.log(`\n[${f.kind.toUpperCase()}/${f.severity}] ${r.name} (${r.id})`);
    console.log(`   ${f.detail}`);
    console.log(`   texto: "${r.desc}"`);
  }
}

console.log('\n' + '='.repeat(80));
console.log('B) EFECTOS QUE NUNCA DISPARARON (mazo de 6, 8 escenarios)');
console.log('='.repeat(80));
for (const r of rows) {
  if (r.neverFired.length === 0) continue;
  console.log(`\n${r.name} (${r.id})   escenariosOk=${r.scenariosOk}${r.scenarioError ? ` ERR=${r.scenarioError}` : ''}`);
  console.log(`   texto: "${r.desc}"`);
  for (const id of r.neverFired) {
    const e = r.effects.find((x) => x.id === id);
    console.log(`   NO DISPARO: ${id} [${e?.trigger}]${e?.target ? ` target=${e.target}` : ''} conds=${JSON.stringify(e?.conditions ?? [])}`);
    console.log(`               acciones=${JSON.stringify(e?.actions ?? [])}`);
  }
}

console.log('\n' + '='.repeat(80));
console.log('C) TABLA COMPLETA (texto vs datos)');
console.log('='.repeat(80));
for (const r of rows) {
  if (r.effects.length === 0) continue;
  console.log(`\n${r.name} (${r.id})${r.isJoker ? ' [SIMBIONTE]' : ''}`);
  console.log(`   texto: "${r.desc}"`);
  for (const e of r.effects) {
    const acts = e.actions.map((a) => `${a.type}${a.value !== undefined ? `:${a.value}` : ''}${a.status ? `(${a.status})` : ''}${a.gain ? ` gain=${a.gain}` : ''}${a.full !== undefined ? ` full=${a.full}` : ''}${a.stacks !== undefined ? ` stacks=${a.stacks}` : ''}`).join(', ');
    console.log(`   - ${e.id} [${e.trigger}]${e.target ? ` target=${e.target}` : ''}${e.once ? ` once=${e.once}` : ''} conds=${JSON.stringify(e.conditions ?? [])} -> ${acts}`);
  }
}

console.log(`\n(cartas: ${rows.filter((r) => !r.isJoker).length} · simbiontes: ${rows.filter((r) => r.isJoker).length})`);

// ---------------------------------------------------------------------------
// D) Sobre-disparo: cuantas veces dispara un efecto "por cada carta" cuando
//    NINGUNA de las otras cartas jugadas es de ese elemento/familia.
// ---------------------------------------------------------------------------

/**
 * Juega la carta con 4 rellenos de OTRO elemento y OTRA familia, y devuelve
 * cuantas veces disparo el efecto. Si el texto promete "cada carta de X jugada"
 * y el relleno no es X, lo correcto es 1 (la propia carta, que si es X) o 0.
 */
function countFires(card: CardDefinition, effectId: string, element: string, family: string): number {
  const other = ALL_ELEMENTS.find((x) => x !== element && x !== card.element) ?? 'neutral';
  const otherFam = ALL_FAMILIES.find((x) => x !== family && x !== card.family) ?? 'agaricaceae';
  const f = filler('zz_other', other, otherFam, 'zz_other_money');
  const engine = new GameEngine({ seed: 3, bundle: bundleWith([card, f]) });
  engine.setArchetypeLoadout([{ cardId: card.id, copies: 1 }, { cardId: f.id, copies: 5 }], []);
  engine.startRun(3);
  engine.chooseBlind('b1');
  const hand = engine.roundSnapshot().hand;
  const me = hand.find((c) => c.def.id === card.id);
  if (!me) return -1;
  capture = [];
  for (const c of hand.slice(0, 5)) engine.toggleSelect(c.uid);
  engine.playHand();
  return capture.filter((e) => e.sourceId === me.uid && e.effectId === effectId).length;
}

console.log('\n' + '='.repeat(80));
console.log('D) SOBRE-DISPARO MEDIDO (5 cartas jugadas, 4 de ELLAS de otro elemento/familia)');
console.log('='.repeat(80));
const OVER = [
  { id: 'amanita_pantherina', effect: 'pantherina_aura', element: 'poison', family: 'amanitaceae' },
  { id: 'oyster_cluster', effect: 'oyster_colony', element: 'mycelium', family: 'tricholomataceae' },
  { id: 'mycena_lucifer', effect: 'lucifer_refraction', element: 'crystal', family: 'clavariaceae' },
  { id: 'colony_network_node', effect: 'colony_node_grow', element: 'mycelium', family: 'tricholomataceae' },
  { id: 'colony_agaric_thread', effect: 'agaric_thread_spread', element: 'mycelium', family: 'agaricaceae' },
];
for (const o of OVER) {
  const def = REAL.cards.find((c) => c.id === o.id);
  if (!def) continue;
  const n = countFires(def, o.effect, o.element, o.family);
  console.log(`  ${def.id.padEnd(24)} disparos=${n}  (el texto promete "cada carta de ${o.element}/${o.family}")`);
}

