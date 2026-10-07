# Sistema de Sobres y Deck personalizado

> **Documento de diseño + referencia técnica.**  
> Estado: **VIGENTE** (los puntos de código citados corresponden al estado del  
> repo tras el rediseño de sobres por Jefe y el badge de copias).

Este documento responde a dos preguntas:

1. **¿Cómo funciona hoy el sistema de cartas que salen de los Sobres?** — Parte A,  
   con las rutas y las funciones reales.
2. **¿Cómo se le da al jugador un Deck personalizado con el que competir?** —  
   Parte B, un plan concreto sobre las palancas que YA existen en el motor.

---

## Parte A — Cómo funciona hoy el sistema de Sobres

### A.1 El sobre es CAPA META, no motor

Un Sobre **no toca las reglas de la run**. Es una bolsita de recompensa que se  
abre desde el menú y entrega **especímenes a la Colección** (el catálogo  
permanente del perfil). Nada de lo que salga de un sobre entra al mazo de la  
partida que estás jugando.

El módulo que lo implementa es `src/meta/Packs.ts` y es **puro**: no toca el DOM,  
no lee el reloj por su cuenta y todo el azar sale del `RNG` que entra por  
parámetro (misma semilla ⇒ mismo sobre, testeable sin mocks).

### A.2 De dónde salen los sobres (cambio reciente)

| Antes                                                          | Ahora                                                     |
| -------------------------------------------------------------- | --------------------------------------------------------- |
| 1 sobre **garantizado** por cada Ciego superado (`round:win`). | Solo el **Jefe** puede soltar un sobre, y **no siempre**. |

- **Quién es Jefe**: `BlindDefinition.tier === 'boss'` (`src/engine/types.ts`), con  
  respaldo `effects.length > 0` para contenido viejo. En `blinds.json` cada ante  
  tiene 3 ciegos y el tercero es el Jefe, así que el Jefe es `run.blindIndex === 2`.
- **Cuándo se sortea**: en el handler `round:win` (`src/main.ts`). El evento se  
  emite **antes** de que `leaveShop()` avance el `blindIndex`, así que en ese  
  instante `round.blind` es el ciego recién vencido — ahí está la detección.
- **Probabilidad**: `rollPackDrop(rng, misses)` (`src/meta/Packs.ts`):
  - `BOSS_PACK_DROP_CHANCE = 0.5` → 50% por Jefe.
  - `PACK_PITY_AFTER = 2` → si falló 2 Jefes seguidos, el 3.º es **garantizado**  
    y el contador vuelve a 0.
  - El contador vive en `ProfileSave.packs.bossMisses` (perfil **v6**).
- **Tipo de sobre**: un segundo sorteo, `rollPackKind(rng)` →  
  `EXPANSION_PACK_SHARE = 0.25` (25% expansión / 75% base).
- **RNG**: sembrado con el reloj (`new RNG((Date.now() ^ 0x5f3759df) >>> 0)`). A  
  propósito: un drop **no** necesita ser reproducible, y sembrarlo con la semilla  
  de la partida filtraría el estado del juego a la economía meta.

### A.3 Qué hay adentro de un sobre

`drawPack(rng, pool, cardsPerPack = 5)`:

1. Se **baraja una copia del pool** (así el "sin repetir" es sacar del frente).
2. Por cada carta se sortea **primero la RAREZA**, ponderada por  
   `PACK_RARITY_WEIGHTS`:
   | rareza | peso |
   | ------ | ---- |
   | común  | 70   |
   | rara   | 22   |
   | épica  | 8    |
   (suman 100 a propósito: leerlo es innecesario explicarlo).
3. **Después** se elige un `cardId` del pool barajado. Dentro de un mismo sobre  
   **no se repite carta** mientras el pool alcance (sacar la misma dos veces en  
   cinco es una decepción, no una recompensa).

**El pool** lo pasa el llamador. Hoy:

- Sobre **base**: `content.registry.poolOf('card')` — todas las cartas visibles.
- Sobre de **expansión**: el mismo pool filtrado por  
  `content.registry.packOf(id) === EXPANSION_PACK_ID`.

No se sortean jokers: un sobre entrega especímenes, que es lo que se colecciona  
por cantidad.

**Vocabularios distintos a propósito.** La rareza del SOBRE tiene 3 escalones  
(economía meta); la del CATÁLOGO tiene 5. La traducción vive en `main.ts`:

```ts
const CONTENT_RARITY: Record<PackRarity, Rarity> = {
  comun: 'common', rara: 'rare', epica: 'legendary',
};
```

Así se recalibra la economía de sobres sin tocar las rarezas de las cartas.

### A.4 Inventario y apertura

`PackInventory` (`src/meta/Packs.ts`) — persistido en `ProfileSave.packs`:

```ts
{ pending, opened, expansionPending, expansionOpened, bossMisses }
```

- `grantPack` / `grantExpansionPack` **mutan** el inventario (el llamador los  
  envuelve en `profileStore.patch`).
- `consumePack` / `consumeExpansionPack` descuentan un pendiente e incrementan el  
  `opened` de por vida.
- El sobre se **consume al ABRIR el overlay**, no al cerrarlo: si se consumiera al  
  cerrar, cerrar con la X lo dejaría disponible y se podría abrir infinitas veces.

La apertura es el overlay WebGL `src/render/PackOpening.ts`, montado por  
`HUD.showPackOpening(...)`.

### A.4-bis Los DOS tipos de sobre (base vs expansión)

Un sobre no es "uno": el drop del Jefe decide **si** cae sobre (`rollPackDrop`) y,  
por separado, **de qué tipo** (`rollPackKind`). Son dos sorteos independientes con  
el mismo `RNG`, así que el tipo queda decorrelacionado de la suerte del drop.

| | Sobre **base** | Sobre de **expansión** |
|---|---|---|
| id de pack | (pool por defecto) | `EXPANSION_PACK_ID = 'deep_mycelium'` |
| contadores | `pending` / `opened` | `expansionPending` / `expansionOpened` |
| pool | cartas de todos los packs base | **solo** cartas con `packOf(id) === 'deep_mycelium'` |
| aspecto del sobre | teal, leyenda **"SOBRE DE ESPORAS"** | azul, leyenda **"MICELIO PROFUNDO"** |
| dorso de sus cartas | dorso genérico (`cardback_default` → `CARD_BACK_KEY`) | **dorso propio** `cardback_mycelial` → `art_cardback_mycelial.webp` |
| botón en la Colección | `data-act="sobres"` | `data-act="sobres-expansion"` (`.` + `.is-packs-expansion`) |

Los dos inventarios son **independientes**: abrir un sobre de expansión no toca  
`pending`, y viceversa. Un sobre de expansión **no se puede abrir con el botón  
base** (el pool es distinto: el base nunca da cartas `deep_*`).

**Cuota del tipo** (`rollPackKind(rng, share = EXPANSION_PACK_SHARE)`):

```ts
EXPANSION_PACK_SHARE = 0.25   // 25% de los sobres que caen son de expansión
```

Medido sobre **200 000 jefes** (`tools/probe-pack-rates.ts`, determinista):

- cae sobre en **57.211%** de los jefes (`DROP=0.5` + pity a los 2 fallos).
- base **42.879%** de los jefes · expansión **14.332%** de los jefes.
- dentro de los sobres que caen, la expansión es el **25.051%** ⇒ el sorteo no  
  está sesgado respecto a `EXPANSION_PACK_SHARE`.
- peor racha de fallos consecutivos: **2** ⇒ el pity nunca se quedó atrás.

El base sigue siendo **el mayoritario** (≈3 de cada 4 sobres). Eso es intencional:  
la expansión se siente "especial" sin llegar a ser rara ni a canibalizar al base.

**Cómo se cableó el dorso propio** (esto faltaba y era un bug): `PackOpening`  
recibe el arte por parámetro, no lo busca solo.

```txt
SceneManager.cardBackArt('mycelial')          // resuelve cardback_<id>
        └─> HUD.showPackOpening({ kind, backArt })
                └─> PackOpeningOptions.backArt
                        └─> createCardBackCanvas(backArt) + backMap.needsUpdate = true
```

`main.ts` solo pasa `backArt` cuando el sobre es de expansión (`kind === 'expansion'`);  
para el sobre base se omite y el overlay usa el dorso genérico. Si `backArt` llega  
`undefined`, `createCardBackCanvas()` cae al dorso por defecto — nunca rompe.

### A.5 Qué pasa con las cartas que salen (y de dónde sale el "×N")

Al abrir, `openPacks()` (`src/main.ts`) hace **una sola escritura** en el perfil:

```ts
profileStore.patch((p) => {
  if (kind === 'expansion') consumeExpansionPack(p.packs);
  else consumePack(p.packs);
  for (const card of drawn) {
    if (!card.cardId) continue;
    p.collection.ownedCounts[card.cardId] = (p.collection.ownedCounts[card.cardId] ?? 0) + 1;
  }
});
```

- `collection.ownedCounts` (perfil v6) es **el contador de copias por carta**.
- La Colección lo usa para mostrar un badge **×N** en vez de repetir la misma  
  carta N veces: una carta, una entrada, un badge.
- Solo cuentan las copias obtenidas de **sobres**; el mazo inicial de una run no  
  infla el contador. Los jokers no llevan contador (los sobres nunca los dan).

### A.6 Lo que el sistema NO hace (y es importante entender)

- **Un sobre NO agrega cartas al mazo.** El mazo de una run se arma en  
  `startRun` y no cambia por abrir sobres.
- **No hay "propiedad" persistente de cartas para jugar.** La Colección es un  
  catálogo de *descubrimiento* (`seenCardIds`) + *desbloqueos* (`unlockedCardIds`,  
  `unlockSource`), no un inventario de cartas jugables.
- **El mazo de la run es efímero**: vive en `RunState` y se guarda con la run  
  (`engine.serialize()` guarda la lista completa de cartas), pero no se reutiliza  
  entre partidas.

Esa es, exactamente, la brecha que cubre la Parte B.

---

## Parte B — Plan: Deck personalizado

### B.1 La palanca ya existe

No hay que inventar un sistema de mazos en el motor. `GameEngine` ya acepta un  
mazo arbitrario:

```ts
engine.setArchetypeLoadout(starter: Array<{ cardId: string; copies: number }>, bias: ElementType[])
```

y `CardRegistry.buildStarterDeck(rng, overrides)` instancia `copies` copias de  
cada `cardId` (los ids desconocidos se descartan; si ninguno resuelve, cae al  
mazo base). **Un Deck personalizado es alimentar ese override desde el perfil en  
vez de desde `archetypes.json`.**

Además, `engine.serialize()` ya guarda el mazo completo, así que una run con deck  
custom **se reanuda sin cambios** en `restore()`.

### B.2 Modelo de datos propuesto (aditivo)

```ts
export interface DeckPreset {
  id: string;               // 'preset_<timestamp>' o un id fijo
  name: string;             // nombre del jugador (o "Deck 1")
  entries: Array<{ cardId: string; copies: number }>;
  updatedAt: string;
}

// ProfileSave (migración v6 -> v7)
decks: DeckPreset[];
deck: { selectedId: string | null };
```

Reglas de la migración: `decks: []` y `deck: { selectedId: null }` por defecto;  
sanitizar cada `entry` (id string no vacío, `copies` entero ≥ 1) y descartar  
presets inválidos enteros. La trampa de siempre: agregar los campos al `return`  
explícito de `migrateProfileSave`.

### B.3 Qué cartas se pueden poner

Fuente de verdad de la propiedad, ya construida:

| Fuente                                        | Para qué sirve                                     |
| --------------------------------------------- | -------------------------------------------------- |
| `collection.ownedCounts[id]`                  | cuántas copias podés poner de esa carta            |
| `collection.unlockedCardIds` / `unlockSource` | cartas ganadas jugando                             |
| `PackGate.contentState(id)`                   | cartas de packs que el jugador tiene (entitlement) |

Regla de copias: `copies ≤ min(ownedCounts[id] || ∞, MAX_COPIES_PER_CARD)`.

> Nota: si se quiere que un deck custom pueda usar cartas **sin** haberlas sacado  
> de un sobre, `ownedCounts` no alcanza. Alternativa más simple y alineada con el  
> juego actual: **el deck custom se limita al catálogo desbloqueado**, con un tope  
> de copias por carta (p. ej. 4) — el contador de sobres queda como progreso, no  
> como requisito. Recomendado para la v1.

### B.4 Reglas de validación (puras y testeables)

`src/meta/DeckPresets.ts` (nuevo, puro, sin DOM ni motor):

```ts
export const DECK_MIN = 20;
export const DECK_MAX = 40;
export const MAX_COPIES_PER_CARD = 4;

export interface DeckValidation {
  ok: boolean;
  size: number;
  errors: Array<{ code: 'size' | 'unknown_card' | 'not_owned' | 'too_many_copies'; cardId?: string }>;
}

export function validateDeck(entries, ownedIds, knownIds): DeckValidation;
```

- `size` entre `DECK_MIN` y `DECK_MAX`.
- Todos los `cardId` existen en el registro (`knownIds`).
- Todos están desbloqueados/poseídos (`ownedIds`).
- `copies ≤ MAX_COPIES_PER_CARD`.
- Tests unitarios por cada `code` (mismo estilo que `tests/packs.test.ts`).

### B.5 UI

Extender el **panel de arquetipos** (`MenuScreen.buildArchetypePanel`), que ya es  
la pantalla donde se elige "con qué mazo arranco":

- Una pestaña / botón **"Deck propio"** junto a los 4 arquetipos.
- Grilla de cartas poseídas (misma cara que la Colección, vía `cardDefFaceUrl`).
- Por carta: contador de copias (tocar para sumar, restar o quitar).
- Barra de tamaño con el rango válido (`20–40`) y el estado de validación.
- Botón de arranque reutilizando `data-act="archetypes-start"` (así las tools  
  siguen funcionando sin cambios).
- Persistencia: guardar el preset en `profile.decks` y el elegido en  
  `profile.deck.selectedId`.

### B.6 Flujo completo

1. Menú → **Nueva partida** → panel de arquetipos → pestaña **Deck propio**.
2. El jugador arma el mazo (validado en vivo).
3. `archetypes-start` →
   ```ts
   const preset = profile.decks.find((d) => d.id === profile.deck.selectedId);
   engine.setArchetypeLoadout(preset.entries, biasFromPreset(preset));
   engine.startRun(seed, ascension, '');   // '' = sin arquetipo con nombre
   ```
4. `biasFromPreset` = los 1–2 elementos dominantes del preset (misma forma que  
   `biasFor(archetypeId)`), para que la tienda ofrezca en la misma línea.

### B.7 Desbloqueo (para no romper el balance inicial)

Sugerencias, en orden de simplicidad:

- **Colonia nivel ≥ 3** (≈ 220 Esporas de Colonia) desbloquea la pestaña, o
- **tras ganar la primera run**, o


- **siempre disponible** con un aviso de que es un modo "avanzado".

Cualquiera de las tres es un `if` en `MenuScreen` a partir de datos que ya están
en el perfil (`colony.level`, `stats.wins`).

### B.8 Riesgos y verificaciones

| Riesgo | Mitigación |
|---|---|
| Balance roto por mazos degenerados (p. ej. 40 copias de la carta más fuerte) | `MAX_COPIES_PER_CARD` + `npm run sim:balance` (500 partidas) con presets de prueba |
| Guardado de una run custom se reanuda mal | Ya cubierto: `serialize/restore` guardan la lista completa de cartas |
| Preset apunta a una carta que ya no existe | `validateDeck` al cargar; el motor ya descarta ids desconocidos |
| Panel demasiado denso en móvil landscape | Reusar el patrón de grilla con scroll de la Colección y el `min tap 26px` de `audit-mobile-buttons.mjs` |
| Migración que descarta los campos nuevos | Agregar `decks` y `deck` al `return` explícito de `migrateProfileSave` + test de migración |

### B.9 Orden de implementación sugerido

1. `src/meta/DeckPresets.ts` + tests (puro, sin UI).
2. Migración v6 → v7 (`decks`, `deck`) + tests.
3. Pestaña "Deck propio" en el panel de arquetipos + CSS (móvil primero).
4. `main.ts`: `onStartRunWithDeck(presetId)` → `setArchetypeLoadout` + `startRun`.
5. Gate de desbloqueo.
6. `sim:balance` con 2–3 presets de prueba y ajuste de `MAX_COPIES_PER_CARD`.

---

## Anexo — Referencias de código

| Concepto | Archivo |
|---|---|
| Sorteo del sobre, rarezas, drop de Jefe, **tipo de sobre**, pity, inventario | `src/meta/Packs.ts` |
| Grant del drop en `round:win`, apertura, `ownedCounts`, `kind` + `backArt` | `src/main.ts` |
| Overlay de apertura (WebGL), dorso propio, tema por tipo | `src/render/PackOpening.ts` |
| Contador de copias en la Colección (badge ×N), botón de sobre de expansión | `src/ui/CollectionScreen.ts` |
| Vuelo de carta puntuada → descarte (`flyingCards`, `cardFlightDebug`) | `src/render/SceneManager.ts` |

### Apéndice — Invariante del vuelo al descarte

Cuando una carta puntúa, sale de `handCards`/`scoringCards` y entra en un "limbo"  
mientras vuela al descarte. **La trampa**: `Card3D.applyTransform()` — el único  
lugar que escribe la matriz desde `home` — solo se llama desde `update()`,  
`snapToHome()` y `setBaseScale()`. Si la carta vuela pero nadie la llama en  
`update()`, sus tweens mueven `home` sin efecto ⇒ **la carta se queda clavada**.

Regla: **toda carta "en limbo" (volando, retirándose) DEBE estar en una colección  
que `SceneManager.update()` recorra cada frame.** Hoy es `flyingCards: Set<Card3D>`.

- `forEachCard()` visita `flyingCards`; el frame loop las actualiza.
- `syncHand()` y `retire()` **no** deben `dispose()` de una carta que esté en vuelo  
  (`!scoringCards.includes(c) && !flyingCards.has(c)` es la guarda correcta).
- Regresión: `tools/probe-discard-flight.mjs` (usa `scene.cardFlightDebug()`). Mide  
  la última `x/z` de cada carta jugada; falla si no converge al `discardX`.  
  Sin el fix reporta `x=2.050, z=-0.600` (zona de juego) y con el fix `x≈-9.2, z=1.000`.
- El flip y el vuelo van en **UNA sola timeline GSAP por carta** (un reloj). Separarlos  
  en dos tweens con relojes distintos es lo que producía el tirón en móvil.

| Perfil v6 (`packs`, `collection.ownedCounts`) | `src/meta/ProfileState.ts` |
| Migraciones (`migrateProfileV5toV6`) | `src/persistence/migrations.ts` |
| Mazo inicial / override | `src/engine/cards/CardRegistry.ts` (`buildStarterDeck`) |
| Carga de un mazo arbitrario | `src/engine/GameEngine.ts` (`setArchetypeLoadout`) |
| Arquetipos (único lector de `archetypes.json`) | `src/meta/Archetypes.ts` |
| Panel de selección de arquetipo | `src/ui/MenuScreen.ts` (`buildArchetypePanel`) |
