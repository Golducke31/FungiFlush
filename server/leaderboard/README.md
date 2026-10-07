# Servidor de referencia del ranking — FungiFlush

Implementación ejecutable del contrato que consume
`src/net/LeaderboardClient.ts`. Sirve para levantar el ranking de verdad y como
especificación de lo que tiene que hacer un backend de producción.

```bash
PORT=8787 node server/leaderboard/server.mjs
```

Sin dependencias: sólo Node ≥ 20. Guarda en `leaderboard-data.json`
(configurable con `DATA_FILE`).

## Conectarlo al juego

El juego lee la URL del servicio en **build time**:

```bash
VITE_LEADERBOARD_URL=http://127.0.0.1:8787 npm run build
```

Sin esa variable el transporte queda **apagado** y el panel de Ranking muestra
su estado offline. El juego se juega entero sin servidor: la cuenta es opcional.

## Contrato

### `POST /runs`

```jsonc
// request
{ "playerId": "gpg_123", "seasonId": "s1",
  "result": { "runId": "abc", "startedAt": "...", "completedAt": "...",
              "mode": "classic|daily|ascension", "highestBlind": 4,
              "completedBlinds": 9, "scoreSummary": 12000,
              "clientVersion": "1.0.0" } }

// 200
{ "awarded": 355, "lifetimeSpores": 1455, "seasonSpores": 600, "level": 6 }
// 422 (rechazado por validación) / 429 (rate limit)
{ "rejected": true, "reason": "...", "awarded": 0 }
```

**El cliente nunca manda Esporas.** Manda el resultado y el servidor recalcula:
es lo que hace imposible un `{ "sporesEarned": 999999 }`.

### `GET /leaderboard?scope=season|lifetime&season=s1&playerId=gpg_123&limit=100`

```jsonc
{ "scope": "season", "seasonId": "s1",
  "entries": [{ "playerId": "...", "displayName": "...", "spores": 900,
                "level": 5, "updatedAt": "..." }],
  "selfRank": 12, "total": 340, "fetchedAt": "..." }
```

### `GET /health`

```json
{ "ok": true, "players": 42 }
```

## Defensas incluidas

- **Idempotencia por `runId`**: reenviar el mismo resultado (un reintento por
  red) devuelve `awarded: 0` y no duplica.
- **Rangos**: ante 1-8, Ciegos 0-24, `scoreSummary` 0-1e9.
- **Coherencia**: no se pueden haber superado más Ciegos que los que entran en
  el ante declarado (`completedBlinds ≤ highestBlind × 3`).
- **Reloj**: rechaza `completedAt` en el futuro (+10 min de tolerancia) o de
  hace más de 7 días.
- **Tope por run**: una sola run no acredita más de 5.000 Esporas.
- **Rate limit**: 12 envíos por minuto por jugador.
- **Anti-farm en el servidor**: la primera vez que un jugador limpia un ante
  paga completo; después, el 40 %.

## Antes de abrirlo al público

Esto **no** es un servicio de producción. Falta:

1. **Verificar el token de Play Games** en lugar de confiar en el `playerId` que
   manda el cliente (sin esto, cualquiera se hace pasar por otro).
2. **Base de datos real** en vez del JSON (el archivo entero se reescribe en
   cada envío y no soporta escrituras concurrentes de verdad).
3. **HTTPS + origen acotado** (`ALLOWED_ORIGIN`, hoy `*`).
4. **Reconciliación de temporadas**: hoy `seasonSpores` sólo se acumula; falta
   el corte y el archivo histórico por temporada.
5. **Reportar jugador** y revisión de valores imposibles (el plan lo pide en
   §14/§16).
