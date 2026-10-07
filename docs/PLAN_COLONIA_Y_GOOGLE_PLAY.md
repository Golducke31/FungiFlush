# Colonia Fungi (Esporas de Colonia) + Google Play Games

> Estado: **Versión 1 (progreso local) IMPLEMENTADA Y VERIFICADA** (2026-10-06).
> La **capa de cuenta** está implementada y el **puente nativo de Play Games**
> queda como contrato compilable + stubs (ver §7: falta toolchain).

---

## 1. La regla que gobierna todo

**La Colonia NO toca el combate.** Las partidas la alimentan, pero ella no
modifica reglas, cartas ni puntuaciones. Es progresión, identidad y prestigio.

| | Esporas (de partida) | **Esporas de Colonia** |
|---|---|---|
| Qué es | El multiplicador de una mano | La currency permanente de la cuenta |
| Dónde vive | `RunState` (motor) | `ProfileSave.colony` (perfil) |
| Cuándo se borra | Al terminar la run | Nunca |
| Para qué sirve | Puntuar | Nivel de Colonia, cosméticos, historial |

La UI **nunca** llama "Esporas" a las dos cosas. Iconos distintos: el hongo de
16×16 (`public/ui/fungi.png`) para la de partida, y el racimo micelial
(`public/art/ui_icon_colony.svg`, nuevo) para la de Colonia.

---

## 2. Cómo se ganan

El grueso viene de **superar Ciegos**; las bonificaciones son chicas a propósito
para que la actividad principal siga siendo jugar.

**Base por ante** (`BLIND_BASE_SPORES` en `src/meta/Colony.ts`):

| Ante | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|---|
| Esporas | 50 | 75 | 100 | 130 | 165 | 205 | 250 | 300 |

Más allá del ante 8 extrapola (+75 por ante): el contenido puede crecer sin
tocar código.

**Bonificaciones** (`BONUS_*`):

| Acción | Esporas |
|---|---|
| Ciego superado en la primera mano | +10 |
| Terminar el Ciego con descartes | +5 |
| Misión cumplida | +20 |
| Desafío diario / racha | +50 (+10 por día de racha, tope +100) |

**Anti-farm** (tres frenos, ninguno bloquea el juego):

1. **Primera superación = 100 %.** La clave `"ante:blindIndex"` se guarda en
   `colony.firstClears`. Es memoria de por vida del perfil.
2. **Repetición = 40 %** (`REPEAT_MULTIPLIER`). Nunca llega a cero: quien
   rejuega por gusto sigue creciendo, sólo que menos.
3. **Tope blando diario**: los primeros **5 Ciegos premiados del día** pagan
   completo; después, 40 %. Se reinicia solo con el cambio de día local.

---

## 3. Niveles

Curva acumulada **escrita a mano** hasta el 10 y extrapolada después
(`COLONY_LEVELS`, `levelThreshold`). Arranca rápida: el primer ascenso se junta
en el primer Ciego.

| Nivel | Esporas | Recompensa |
|---|---|---|
| 1 | 0 | Colonia inicial |
| 2 | 100 | Marco común |
| 3 | 250 | Sobre de Esporas |
| 4 | 450 | Fondo nuevo |
| 5 | 700 | Título: Micelio Naciente |
| 6 | 1.000 | Efecto de victoria |
| 7 | 1.400 | Sobre de Colonia |
| 8 | 1.850 | Avatar de hongo |
| 9 | 2.350 | Marco poco común |
| 10 | 3.000 | Título: Colonia Establecida |

Los **nombres de nivel van por bandas** (`colonyLevelNameKey`): Espora Dormida
(1-4), Brote Micelial (5-9), Colonia Emergente (10-19), Red Profunda (20-29),
Bosque Subterráneo (30-49), Colonia Primordial (50+). Así la escalera puede
crecer sin tocar i18n.

El nivel es **derivado** de `lifetimeSpores`: al cargar el perfil se recalcula
(`migrateProfileSave`), así un perfil editado a mano no puede mostrar un estado
imposible.

---

## 4. Qué NO hace esta moneda (reglas duras)

No compra cartas más fuertes · no da Sustrato ni Esporas de partida · no da
ventajas durante un Ciego · no recupera manos ni descartes · no compra
victorias · no altera las probabilidades de la tienda · no es necesaria para
jugar.

Las recompensas de nivel son **desbloqueos** (`colony.unlockedRewards`), no
compras: no hay tienda de Colonia.

---

## 5. Persistencia

`PROFILE_SAVE_VERSION` **3 → 4**. La migración `migrateProfileV3toV4`
(`src/persistence/migrations.ts`) agrega:

```ts
colony: {
  lifetimeSpores, level, unlockedRewards[], seasonSpores, seasonId,
  lastSyncAt, firstClears[], dailyAwardedDate, dailyAwardedCount,
}
account: {
  provider: 'none' | 'google-play' | 'local',
  accountId, displayName,
  syncState: 'offline' | 'pending' | 'synced' | 'conflict',
  lastSyncAt, pendingResults[],
}
```

Un perfil v3 **arranca en cero**: es de alguien que jugó antes de que existieran
las Esporas de Colonia, y no se le puede reconstruir hacia atrás el historial de
Ciegos. Inventarle progreso sería regalar lo que nadie ganó (y el ranking
futuro lo notaría).

---

## 6. UI

- **Perfil** (`buildProfilePanel`): bloque de la Colonia (nombre + banda + nivel,
  Esporas `1.175 / 1.400`, barra, próximo desbloqueo) y **cuatro accesos**
  (Recompensas · Cosméticos · Logros · Historial) + fila de **cuenta**.
- **Insignia de nivel** en el icono de Perfil del menú (ya existía el hueco,
  ahora se dibuja).
- **Resultados** (`showGameOver`): bloque "+N Esporas de Colonia" con desglose
  **agrupado** (repetir "+10 Ciego en la primera mano" seis veces es ruido).
- **Recompensas** (`buildColonyRewardsPanel`): la escalera de 10 niveles con su
  estado (desbloqueada / bloqueada).

Nota de layout: en celular horizontal el panel tiene ~210 px útiles. La línea de
stats (mejor ante / victorias / racha) se **oculta** en
`(pointer: coarse) and (max-height: 560px)` — el dato ya vive en Historial — y
los cuatro accesos van en **una sola fila**. Sin eso, la fila de cuenta quedaba
recortada por el scroller y un control recortado no se puede tocar (lo detectó
`tools/probe-colony.mjs`).

---

## 7. Cuenta y Google Play Games

### Implementado y verificable

- `src/meta/Account.ts`: transiciones **puras** (`linkAccount`, `unlinkAccount`,
  `queueRunResult`, `markSynced`, `markConflict`) + la interfaz
  `AccountProvider` + `createGooglePlayProvider()`.
- El proveedor **solo se activa dentro del contenedor Tauri**: en el navegador
  (dev, smoke, escritorio) `isAvailable()` devuelve `false` y la UI muestra "no
  disponible en este dispositivo" en vez de un botón que va a fallar.
- `src-tauri/src/play_games.rs` + `lib.rs`: los tres comandos del contrato
  (`google_play_available`, `google_play_sign_in`, `google_play_sign_out`).
  Hoy son **stubs** que devuelven "no disponible"/error con mensaje.

### Pendiente: NO verificable en este entorno

⚠️ **No hay toolchain de Rust ni CLI de Tauri instalados** (`cargo`, `rustc` y
`@tauri-apps/cli` no existen en la máquina). El `src-tauri/` **no se compila en
los gates**: `npm run typecheck / test / validate / smoke` no lo tocan. Los
stubs están escritos para compilar (solo usan `serde`, ya en `Cargo.toml`), pero
**no están compilados**.

Pasos exactos para cablearlo (en una máquina con el toolchain):

1. **Tauri Android**
   ```bash
   npm i -D @tauri-apps/cli@^2
   rustup target add aarch64-linux-android armv7-linux-androideabi \
                    i686-linux-android x86_64-linux-android
   # Android SDK (platform 36) + NDK, ANDROID_HOME / NDK_HOME / JAVA_HOME
   npx tauri android init      # genera src-tauri/gen/android (gitignored)
   ```
2. **Play Console**: crear el proyecto de **Play Games Services**, vincular la
   app, y registrar la **huella SHA-1** del keystore (de subida **y** de Play
   App Signing). Sin las dos, el sign-in falla con `SIGN_IN_REQUIRED`.
3. **Plugin Android**: implementar el lado Kotlin (`GoogleSignInClient` /
   `PlayGamesPlatform`) y exponerlo a Rust. Dos caminos:
   - un plugin propio (`tauri-plugin-play-games`) con `@Command` Kotlin;
   - o `jni` desde Rust llamando a las clases de Play Games.
4. **Rust**: reemplazar el **cuerpo** de las tres funciones de
   `src-tauri/src/play_games.rs`. El contrato y el frontend **no cambian**.
5. **Probar en dispositivo real** (los emuladores sin Play Store no tienen Play
   Games Services).

### Anti-trampa (desde el día uno)

Lo que se sube es el **resultado** de la run, nunca las Esporas calculadas por
el cliente:

```ts
// ColonyRunResult (src/meta/ProfileState.ts)
{ runId, startedAt, completedAt, mode, highestBlind, completedBlinds,
  scoreSummary, clientVersion }
```

El servidor recalcula `lifetimeSporesAwarded` / `seasonSporesAwarded` /
`newLevel`. Mandar `{ sporesEarned: 999999 }` sería trivial de modificar.
`queueRunResult` es idempotente por `runId` y la cola está capeada
(`PENDING_RESULTS_CAP = 20`).

---

## 8. Roadmap (mapeado al plan)

| Versión | Alcance | Estado |
|---|---|---|
| **V1 — Progreso local** | Esporas de Colonia, recompensa por Ciego, nivel, barra, recompensas, guardado local, pantalla de resultados | ✅ **hecho** |
| **V1.1 — Misiones y temporadas locales** | Misiones diarias/semanales, racha, Esporas de temporada | parcial: `seasonSpores` ya se acumula; falta el panel |
| **V1.2 — Cuenta y sincronización** | Cuenta opcional, sync entre dispositivos, validación de recompensas, recuperación | capa de cuenta ✅ / nativo ⏳ |
| **V1.3 — Ranking global** | Ranking de temporada e histórico, perfil público, amigos | pendiente (exige backend) |

El ranking **no** se lanza antes de poder validar resultados en servidor.

---

## 9. Verificación

| Gate | Resultado |
|---|---|
| `npm run typecheck` | ✅ |
| `npm test` | ✅ **356/356** (+24 nuevos: `colony.test.ts`, `account.test.ts`, migración v3→v4) |
| `npm run validate` | ✅ 0 advertencias |
| `npm run smoke` | ✅ 0 / 0 / 0 |
| `node tools/shot-desktop.mjs` | ✅ 6/6 |
| `node tools/shot-tablet.mjs` | ✅ 5/5 |
| `node tools/audit-mobile-buttons.mjs` (915×412 · 844×390 · 1180×820) | ✅ 168 controles, 0 problemas |
| `node tools/probe-colony.mjs` (nuevo) | ✅ 0 fallos en los 3 viewports |

`probe-colony.mjs` es un **gate**: siembra una Colonia en `localStorage` y
recarga (así ejercita la carga real + el merge de la migración), y verifica que
los cuatro accesos y el botón de cuenta estén **dentro del área visible del
scroller** — no alcanza con que existan en el DOM, porque el smoke clickea con
el mouse en el centro real del botón. Es exactamente el fallo que encontró.

Capturas: `tools/shots/colony-profile.png`, `colony-rewards.png`,
`colony-result.png`.

---

## 10. Impacto en escritorio

Cambios **globales** (no efecto colateral del móvil), registrados en
`docs/CONVENCION_MOVIL_PRIMERO.md` §6:

- El panel de Perfil tiene **contenido nuevo** (Colonia + cuenta) en las dos
  plataformas. En escritorio conserva la línea de stats y la rejilla
  `auto-fit`.
- El panel de **resultados** gana el bloque de Esporas de Colonia.
- `shot-desktop.mjs` sólo cubre las 6 invariantes del HUD de partida: el aspecto
  fino del panel de Perfil en escritorio **no está revisado**.
