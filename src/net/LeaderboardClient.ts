/**
 * LeaderboardClient.ts — Transporte HTTP del ranking global (V1.3).
 *
 * SEPARADO DEL MODELO a proposito: `src/meta/Leaderboard.ts` es puro y
 * testeable; aca vive lo unico que no se puede testear sin red. El `fetch` entra
 * por parametro, asi que los tests pueden inyectar uno falso.
 *
 * REPARTO DE AUTORIDAD (la decision mas importante de este archivo):
 *   - El PERFIL LOCAL es el libro del jugador. Se puede jugar entero offline y
 *     las Esporas se acreditan al superar cada Ciego, sin red.
 *   - El SERVIDOR es el libro del RANKING. Recalcula cada resultado a partir del
 *     RESULTADO de la run (nunca de las Esporas que manda el cliente) y es lo
 *     unico que se muestra en el tablero.
 *
 * Por eso el sync NO re-acredita Esporas locales ni adopta el total del
 * servidor: si lo hiciera, un envio reintentado duplicaria la recompensa o un
 * servidor caido borraria progreso offline. Un resultado RECHAZADO por el
 * servidor se marca como conflicto y se muestra; las Esporas locales ya ganadas
 * no se quitan nunca hacia atras.
 *
 * SIN SERVIDOR CONFIGURADO el transporte es "apagado": el ranking muestra su
 * estado offline y el juego funciona igual. La cuenta es opcional.
 */

import {
  sanitizeBoard,
  sanitizeSubmitResult,
  type LeaderboardBoard,
  type LeaderboardScope,
  type SubmitPayload,
  type SubmitResult,
} from '../meta/Leaderboard';

export interface LeaderboardTransport {
  /** Hay servidor configurado. Si es `false`, la UI no ofrece el ranking. */
  readonly enabled: boolean;
  /** Motivo por el que esta apagado (para la UI), o `null`. */
  readonly disabledReason: string | null;
  submit(payload: SubmitPayload): Promise<SubmitResult>;
  fetchBoard(scope: LeaderboardScope, playerId: string | null): Promise<LeaderboardBoard>;
}

export interface LeaderboardClientOptions {
  endpoint: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Id de la temporada en curso (para el tablero de temporada). */
  seasonId?: string;
}

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * URL del servicio, tomada del entorno de build (`VITE_LEADERBOARD_URL`).
 *
 * Se lee con un cast en vez de `import.meta.env` tipado para no depender de los
 * tipos de Vite en el `tsconfig` del motor. Sin variable, `null` = sin ranking.
 */
export function leaderboardEndpointFromEnv(): string | null {
  const meta = import.meta as unknown as { env?: Record<string, string | undefined> };
  const value = meta.env?.['VITE_LEADERBOARD_URL'];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/\/+$/, '');
  return trimmed.length > 0 ? trimmed : null;
}

/** Transporte apagado: nunca hay red, pero la UI tiene una respuesta clara. */
export function createOfflineTransport(reason: string): LeaderboardTransport {
  return {
    enabled: false,
    disabledReason: reason,
    async submit(): Promise<SubmitResult> {
      throw new Error(reason);
    },
    async fetchBoard(): Promise<LeaderboardBoard> {
      throw new Error(reason);
    },
  };
}

export function createLeaderboardClient(options: LeaderboardClientOptions): LeaderboardTransport {
  const endpoint = options.endpoint.replace(/\/+$/, '');
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const seasonId = options.seasonId ?? '';

  async function request(path: string, init?: RequestInit): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await doFetch(`${endpoint}${path}`, {
        ...init,
        signal: controller.signal,
        headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
      });
      if (!response.ok) {
        throw new Error(`el servidor respondio ${response.status}`);
      }
      return (await response.json()) as unknown;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    enabled: true,
    disabledReason: null,

    async submit(payload: SubmitPayload): Promise<SubmitResult> {
      const raw = await request('/runs', {
        method: 'POST',
        body: JSON.stringify({ playerId: payload.playerId, result: payload.result }),
      });
      const parsed = sanitizeSubmitResult(raw);
      if (!parsed) throw new Error('el servidor devolvio un resultado ilegible');
      return parsed;
    },

    async fetchBoard(scope: LeaderboardScope, playerId: string | null): Promise<LeaderboardBoard> {
      const params = new URLSearchParams({ scope });
      if (scope === 'season' && seasonId) params.set('season', seasonId);
      if (playerId) params.set('playerId', playerId);
      const raw = await request(`/leaderboard?${params.toString()}`);
      const board = sanitizeBoard(raw, scope);
      if (!board) throw new Error('el servidor devolvio un tablero ilegible');
      return board;
    },
  };
}
