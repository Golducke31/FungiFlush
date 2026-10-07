# Colonia Fungi (Esporas de Colonia) + Google Play Games + Ranking

> Estado: **V1 (progreso local) y V1.3 (ranking) IMPLEMENTADAS Y VERIFICADAS**
> (2026-10-06). El **puente nativo de Play Games está implementado y compila**
> (`cargo check --target aarch64-linux-android` ✅). Falta la configuración de
> Play Console, que sólo puede hacer Emanuel (ver §7).

---

## 1. La regla que gobierna todo

**La Colonia NO toca el combate.** Las partidas la alimentan, pero ella no
modifica reglas, cartas ni puntuaciones. Es progresión, identidad y prestigio.

| | Esporas (de partida) | **Esporas de Colonia** |
|---|---|---|
| Qué es | El multiplicador de una mano | La currency permanente de la cuenta |
| Dónde vive | `RunState` (motor) | `ProfileSave.colony` (perfil) |
| Cuándo se borra | Al terminar la run | Nunca |
| Para qué sirve | Puntuar | Nivel de Colonia, cosméticos, ranking |

La UI **nunca** llama "Esporas" a las dos cosas. Iconos distintos: el hongo de
16×16 (`public/ui/fungi.png`) para la de partida, y el racimo micelial
(`public/art/ui_icon_colony.svg`, nuevo) para la de Colonia.

---

## 2. Cómo se ganan

**Base por ante** (`BLIND_BASE_SPORES` en `src/meta/Colony.ts`):

| Ante | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|---|
| Esporas | 50 | 75 | 100 | 130 | 165 | 205 | 250 | 300 |

Más allá del ante 8 extrapola (+75 por ante).

**Bonificaciones** (`BONUS_*`): primera mano +10 · descartes sobrantes +5 ·
misión +20 · diaria/racha +50 (+10 por día, tope +100).

**Anti-farm** (tres frenos, ninguno bloquea el juego):

1. **Primera superación = 100 %.** Clave `"ante:blindIndex"` en `firstClears`.
2. **Repetición = 40 %** (`REPEAT_MULTIPLIER`). Nunca llega a cero.
3. **Tope blando diario**: los primeros 5 Ciegos premiados del día pagan
   completo; después, 40 %. Se reinicia con el cambio de día local.

---

## 3. Niveles

Curva acumulada escrita a mano hasta el 10 y extrapolada después.

| Nivel | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|---|---|
| Esporas | 0 | 100 | 250 | 450 | 700 | 1.000 | 1.400 | 1.850 | 2.350 | 3.000 |

Los **nombres van por bandas** (`colonyLevelNameKey`): Espora Dormida (1-4),
Brote Micelial (5-9), Colonia Emergente (10-19), Red Profunda (20-29), Bosque
Subterráneo (30-49), Colonia Primordial (50+). El nivel es **derivado** de
`lifetimeSpores` y se recalcula al cargar el perfil.

---

## 4. Qué NO hace esta moneda (reglas duras)

No compra cartas más fuertes · no da Sustrato ni Esporas de partida · no da
ventajas durante un Ciego · no recupera manos ni descartes · no compra
victorias · no altera las probabilidades de la tienda · no es necesaria para
jugar. Las recompensas de nivel son **desbloqueos**, no compras.

---

## 5. Persistencia

`PROFILE_SAVE_VERSION` **3 → 4** (`migrateProfileV3toV4`):

```ts
colony: {
  lifetimeSpores, level, unlockedRewards[], seasonSpores, seasonId,
  lastSyncAt, firstClears[], dailyAwardedDate, dailyAwardedCount,
}
account: {
  provider, accountId, displayName,
  syncState: 'offline' | 'pending' | 'synced' | 'conflict',
  lastSyncAt, pendingResults[],
  verifiedSpores, leaderboard: { season, lifetime, fetchedAt },
}
```

Un perfil v3 **arranca en cero**: es de alguien que jugó antes de que existieran
las Esporas de Colonia, y no se le puede reconstruir hacia atrás el historial de
Ciegos.

---

## 6. UI

- **Perfil**: bloque de la Colonia (banda + nivel, Esporas `1.175 / 1.400`,
  barra, próximo desbloqueo), **cinco accesos** (Recompensas · Ranking ·
  Cosméticos · Logros · Historial) y fila de cuenta.
- **Insignia de nivel** en el icono de Perfil del menú.
- **Resultados**: bloque "+N Esporas de Colonia" con desglose agrupado.
- **Recompensas**: escalera de 10 niveles con su estado.
- **Ranking**: dos tableros con pestañas + posición propia + 3 hitos personales.

Nota de layout: en celular horizontal el panel tiene ~210 px útiles. La línea de
stats se **oculta** en `(pointer: coarse) and (max-height: 560px)` y los accesos
van en **una sola fila de 5**; con 2 filas la fila de cuenta quedaba recortada
por el scroller (lo detectó `tools/probe-colony.mjs`).

---

## 7. Google Play Games (nativo)

### Arquitectura

```
TS  src/meta/Account.ts
 └─ invoke('google_play_sign_in')
     └─ Rust  src-tauri/src/play_games.rs              (JNI)
         └─ Kotlin  gen/android/.../PlayGamesBridge.kt  (SDK v2)
```

**Por qué JNI y no un plugin de Tauri:** el SDK necesita una `Activity` y
devuelve promesas; las dos cosas viven mejor del lado Android. Un plugin
agregaría un crate entero para tres funciones de una sola app.

**Hilos:** `sign_in` **bloquea** (Play Games muestra su propio diálogo) y por eso
Rust lo corre en `spawn_blocking`, nunca en el hilo de UI. Bloquear el hilo
principal de Android congela la app entera.

**Contrato** (los tres comandos): `google_play_available` → `bool`,
`google_play_sign_in` → `{ id, displayName }`, `google_play_sign_out` → `()`.
Kotlin devuelve **JSON con `status`** (`ok` / `cancelled` / `error`): "canceló" y
"falló" son cosas distintas y la UI no puede mentir.

**Offline-first:** el juego se juega entero sin cuenta. En escritorio
`available()` devuelve `false` y la UI muestra "no disponible en este
dispositivo" en vez de un botón que va a fallar. `PlayGamesSdk.initialize` va
dentro de un `try`: un APP_ID mal configurado **no puede** tumbar el arranque.

### Qué está hecho

- `tauri android init` → proyecto Android real en `src-tauri/gen/android`
  (se versiona: los `.gitignore` anidados ya ignoran builds y keystores).
- `PlayGamesBridge.kt` (available / signIn / signOut + `PlayGamesSdk.initialize`).
- `MainActivity.kt` inicializa el SDK al arrancar.
- `AndroidManifest.xml` con el `meta-data` de Play Games y
  `res/values/strings.xml` con `game_services_project_id`.
- `build.gradle.kts` con `com.google.android.gms:play-services-games-v2:22.1.0`.
- `play_games.rs` con JNI real (`jni 0.21` + `ndk-context 0.1`, deps
  **solo-Android** en `Cargo.toml`).

### Qué falta (sólo lo puede hacer Emanuel)

1. **Play Console**: crear el proyecto de **Play Games Services**, vincular la
   app y copiar el **APP_ID** en
   `src-tauri/gen/android/app/src/main/res/values/strings.xml`
   (hoy está el placeholder `0`).
2. **Huella SHA-1** del keystore de subida **y** de Play App Signing. Sin las
   dos, el sign-in falla con `SIGN_IN_REQUIRED` / `DEVELOPER_ERROR` (el puente
   devuelve ese mensaje para poder diagnosticarlo sin logcat).
3. **Probar en un dispositivo real**: los emuladores sin Play Store no tienen
   Play Games Services.
4. `npx tauri android build` (el SDK/NDK ya están instalados en la máquina).

⚠️ **Lo que NO se pudo verificar acá:** el **build de Gradle** y el **sign-in
real**. No hay keystore, ni proyecto de Play Console, ni dispositivo. Lo que sí
se verificó es que el **Rust compila para Android** (ver §9).

---

## 8. Ranking global (V1.3)

### Dos tableros, a propósito

- **Temporada**: lo ganado durante la temporada. Es el competitivo, y evita que
  un jugador nuevo vea un muro imposible.
- **Histórica**: Esporas acumuladas desde el inicio. Es prestigio: nadie pierde
  su lugar por dejar de jugar una semana.

### Premios por posición (percentil, no puesto absoluto)

Top 1 % → título legendario + marco · Top 5 % → efecto de victoria · Top 10 % →
insignia de temporada · Top 25 % → cosmético común · Participación → recompensa
básica. **Todos cosméticos**: el plan prohíbe cualquier ventaja de juego.

Se corta por percentil porque un tablero de 50 y uno de 50.000 no pueden premiar
lo mismo con "top 10".

### Hitos personales

Alcanzar 1.000 Esporas · Superar 10 Ciegos · Llegar al nivel 10. Van **siempre**,
incluso sin servidor: la mayoría nunca va a entrar al top 1 % y tiene que poder
sentir que su colonia avanza.

### Reparto de autoridad (la decisión más importante)

| | Libro LOCAL (perfil) | Libro del RANKING (servidor) |
|---|---|---|
| Qué guarda | Las Esporas del jugador | La posición en el tablero |
| Cuándo se escribe | Al superar cada Ciego, sin red | Al sincronizar |
| Quién manda | El jugador (offline-first) | El servidor |

Por eso el sync **no re-acredita** Esporas locales ni adopta el total del
servidor: si lo hiciera, un envío reintentado duplicaría la recompensa o un
servidor caído borraría progreso offline. Un resultado **rechazado** por el
servidor marca `conflict` y se muestra, pero **nunca borra hacia atrás** lo ya
ganado. Las Esporas verificadas se muestran aparte (`verifiedSpores`).

### Anti-trampa

Lo que viaja es el **resultado** (`ColonyRunResult`: modo, Ciegos superados,
score, versión), nunca las Esporas. El servidor recalcula. Además: `runId` único
(idempotencia), validación de rangos, coherencia Ciegos↔ante, control de reloj
(adelantado y atrasado), tope por run y rate limit por jugador.

### Servidor de referencia

`server/leaderboard/server.mjs` — implementación ejecutable del contrato
(Node puro, sin dependencias, persistencia en JSON):

```bash
PORT=8787 node server/leaderboard/server.mjs
# y en el build del juego:
VITE_LEADERBOARD_URL=http://127.0.0.1:8787 npm run build
```

Endpoints: `POST /runs` · `GET /leaderboard?scope=&season=&playerId=` ·
`GET /health`.

⚠️ **No es un servicio de producción**: guarda en un JSON y confía en el
`playerId` que manda el cliente. Antes de abrirlo al público hay que agregarle
verificación del token de Play Games, base de datos real y el resto de las
defensas anti-trampa. Sin `VITE_LEADERBOARD_URL` el transporte queda **apagado**
y el panel muestra su estado offline: el juego funciona igual.

---

## 9. Verificación

| Gate | Resultado |
|---|---|
| `npm run typecheck` | ✅ |
| `npm test` | ✅ **371/371** (+39: colony, account, migración v3→v4, leaderboard) |
| `npm run validate` | ✅ 0 advertencias |
| `npm run smoke` | ✅ 0 / 0 / 0 |
| `node tools/shot-desktop.mjs` | ✅ 6/6 |
| `node tools/shot-tablet.mjs` | ✅ 5/5 |
| `node tools/audit-mobile-buttons.mjs` (915×412 · 844×390 · 1180×820) | ✅ 168 controles, 0 problemas |
| `node tools/probe-colony.mjs` (3 viewports + puntero fino) | ✅ 0 fallos |
| `cargo check --target aarch64-linux-android` | ✅ **compila** (JNI + puente Kotlin) |
| `cargo check` (host/escritorio) | ✅ compila la rama de reemplazo |

`probe-colony.mjs` siembra una Colonia en `localStorage` y recarga (así ejercita
la carga real + el merge de la migración) y verifica que los accesos y el botón
de cuenta estén **dentro del área visible del scroller** — no alcanza con que
existan en el DOM, porque el smoke clickea con el mouse en el centro real.

Capturas: `tools/shots/colony-{profile,rewards,ranking,result}.png`.

⚠️ **No correr el smoke en paralelo con `cargo`**: la compilación se come la CPU,
SwiftShader baja de ~12 FPS y las aserciones que dependen de tiempo (arrastre)
fallan por flake.

---

## 10. Impacto en escritorio

Cambios **globales**, registrados en `docs/CONVENCION_MOVIL_PRIMERO.md` §6: el
panel de Perfil tiene contenido nuevo (Colonia + cuenta + ranking), el panel de
resultados gana el bloque de Esporas, y hay dos pantallas nuevas (Recompensas y
Ranking). `shot-desktop.mjs` sólo cubre las 6 invariantes del HUD de partida: el
aspecto fino de estos paneles en escritorio **no está revisado**.

---

## 11. Roadmap

| Versión | Alcance | Estado |
|---|---|---|
| **V1 — Progreso local** | Esporas, recompensa por Ciego, nivel, barra, recompensas | ✅ hecho |
| **V1.1 — Misiones y temporadas locales** | Misiones diarias/semanales, Esporas de temporada | ⏸️ **pausado a pedido** (`seasonSpores` ya se acumula) |
| **V1.2 — Cuenta y sincronización** | Cuenta, sync, validación, recuperación | capa ✅ / nativo ⏳ (falta Play Console) |
| **V1.3 — Ranking global** | Tablero de temporada e histórico, hitos, premios | ✅ cliente + servidor de referencia |

El ranking **no** se publica al público antes de poder validar resultados en un
servidor de verdad (§8).
