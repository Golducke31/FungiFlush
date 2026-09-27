/**
 * boardValidation.ts — Validacion de `board.json`.
 *
 * Vive en la capa de CONTENIDO, no en `src/engine/board/`, por dos razones:
 *
 *   1. Validar los JSON de un pack es trabajo del contenido (igual que
 *      `validatePacks` o el escaneo de i18n), no del motor.
 *   2. El motor del tablero se carga con `await import('@engine/board')` para
 *      no costar nada en el arranque. Si el validador viviera alla adentro,
 *      quien valida al arrancar tendria que importar el chunk diferido y el
 *      chunk dejaria de ser diferido.
 *
 * Un `board.json` roto no puede bloquear un release de cartas (son archivos
 * distintos a proposito), pero SI tiene que fallar ruidosamente en el gate de
 * contenido: una flecha de mas, un valor fuera de rango o un `cardId` que no
 * existe convierten el duelo en una partida que no se puede jugar.
 *
 * Modulo puro: recibe las entradas y el conjunto de ids conocidos. No conoce
 * el ContentRegistry ni el sistema de packs.
 */

import { ARROW_DIRS, MAX_ARROW_VALUE } from '@engine/index';
import type { BoardCardDef } from '@engine/board/types';

export interface BoardIssue {
  level: 'error' | 'warning';
  where: string;
  message: string;
}

function isIntInRange(value: unknown, min: number, max: number): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

export function validateBoardDefs(
  defs: readonly BoardCardDef[],
  knownCardIds: ReadonlySet<string>,
): BoardIssue[] {
  const issues: BoardIssue[] = [];
  const seen = new Set<string>();

  for (const def of defs) {
    const where = `board:${def.cardId ?? '<sin id>'}`;

    if (!def.cardId) {
      issues.push({ level: 'error', where, message: 'la entrada no declara cardId' });
      continue;
    }
    if (seen.has(def.cardId)) {
      issues.push({ level: 'error', where, message: 'cardId duplicado en board.json' });
      continue;
    }
    seen.add(def.cardId);

    if (!knownCardIds.has(def.cardId)) {
      issues.push({ level: 'error', where, message: `apunta a una carta inexistente: ${def.cardId}` });
      continue;
    }

    if (!Array.isArray(def.arrows) || def.arrows.length !== ARROW_DIRS.length) {
      issues.push({
        level: 'error',
        where,
        message: `"arrows" debe tener ${ARROW_DIRS.length} valores (${ARROW_DIRS.join(', ')})`,
      });
      continue;
    }

    const bad = def.arrows.findIndex((value) => !isIntInRange(value, 0, MAX_ARROW_VALUE));
    if (bad >= 0) {
      issues.push({
        level: 'error',
        where,
        message: `la flecha ${ARROW_DIRS[bad]} vale ${String(def.arrows[bad])}; se espera un entero 0..${MAX_ARROW_VALUE}`,
      });
    }

    if (def.power !== undefined && !isIntInRange(def.power, 0, 99)) {
      issues.push({ level: 'error', where, message: 'power debe ser un entero 0..99' });
    }
    if (def.defense !== undefined && !isIntInRange(def.defense, 0, 99)) {
      issues.push({ level: 'error', where, message: 'defense debe ser un entero 0..99' });
    }

    // Sin ninguna flecha la carta no puede atacar nunca: puede ser una muralla
    // a proposito, pero es mas probable que sea un olvido.
    if (def.arrows.every((value) => value === 0)) {
      issues.push({
        level: 'warning',
        where,
        message: 'no tiene ninguna flecha: nunca va a poder atacar',
      });
    }
  }

  return issues;
}
