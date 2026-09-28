# Assets de terceros — Polyfork

Los siete modulos `.ts` de esta carpeta son codigo fuente de terceros, copiado
tal cual desde el CDN de [Polyfork](https://polyfork.dev) y **sin modificar**
(solo se les antepuso la directiva `@ts-nocheck`, que es una anotacion del
compilador de TypeScript y no cambia el programa).

| Archivo local | Asset original | Que es |
| --- | --- | --- |
| `dirt-ground-tile.ts` | [`dirt-ground-tile-da4a60`](https://polyfork.dev/asset/dirt-ground-tile-da4a60) | Tile de tierra 2x2 m, 414 tris |
| `grass-ground-tile.ts` | [`grass-ground-tile-131ec0`](https://polyfork.dev/asset/grass-ground-tile-131ec0) | Tile de pasto 2x2 m, 386 tris |
| `stone-path-tile.ts` | [`stone-path-tile-f77e6e`](https://polyfork.dev/asset/stone-path-tile-f77e6e) | Losa de sendero 1x1 m, 532 tris |
| `mushroom-cluster-f2e3ba.ts` | [`mushroom-cluster-f2e3ba`](https://polyfork.dev/asset/mushroom-cluster-f2e3ba) | Racimo de hongos, 531 tris |
| `mushroom-679e55.ts` | [`mushroom-679e55`](https://polyfork.dev/asset/mushroom-679e55) | Hongo suelto, 112 tris |
| `ricordea-mushroom-polyp-6d8178.ts` | [`ricordea-mushroom-polyp-6d8178`](https://polyfork.dev/asset/ricordea-mushroom-polyp-6d8178) | Polipo de hongo, 560 tris |
| `mushroom-cluster-18dc1d.ts` | [`mushroom-cluster-18dc1d`](https://polyfork.dev/asset/mushroom-cluster-18dc1d) | Racimo de hongos grande, 587 tris |

## Licencia

> Personal and commercial use: games, apps, client work. Modify freely, no
> attribution required. Do not resell or redistribute the file itself as an
> asset, or use it to build or train a COMMERCIAL asset generator.

Terminos completos: <https://polyfork.dev/licensing>

En criollo, para este proyecto:

- **Se puede** usar en FungiFlush (es un juego comercial) y modificarlo.
- **No hay** obligacion de dar credito (igual lo damos aca, porque ayuda).
- **No se puede** revender ni redistribuir el archivo *como asset suelto*, ni
  usarlo para entrenar o construir un generador de assets comercial.

## Modificaciones locales (una sola, y por que)

En `dirt-ground-tile.ts`, `grass-ground-tile.ts` y `mushroom-679e55.ts`, dentro
de `prep()`, la llamada

```js
geo = geo.toNonIndexed();
```

se cambio por

```js
if (geo.index) geo = geo.toNonIndexed();
```

**Motivo.** `BufferGeometry.toNonIndexed()` emite un `console.warn` de three
cuando la geometria que recibe **ya** es no-indexada. Los tres archivos de
arriba la llamaban sin guarda, asi que cada `createAsset()` escupia avisos por
consola (18 el de tierra, 3 el de pasto). El smoke test del proyecto falla si
hay **cualquier** aviso de consola, y con razon: un aviso sucio tapa el que si
importa. Los assets mas nuevos del mismo catalogo (`stone-path-tile`,
`mushroom-cluster-18dc1d`, `ricordea-mushroom-polyp`, `mushroom-cluster-f2e3ba`)
ya traen exactamente esta guarda, asi que el cambio solo alinea los viejos con
los nuevos. No cambia ni la geometria ni el resultado: `toNonIndexed()` sobre
una geometria ya no-indexada devuelve lo mismo.

Es la unica diferencia con los archivos publicados en el CDN. La licencia
permite modificarlos ("Modify freely").

## Por que estan vendorizados y no por CDN

El pedido original los importaba como `https://polyfork.dev/cdn/*.mjs`. Eso no
sirve aca por tres motivos:

1. **Vite no resuelve imports `https://` absolutos.** El propio manual de
   Polyfork lo dice: "A bare https:// import works in a plain script tag and
   fails under Vite and Next".
2. **El juego es offline y pago.** Un `import` remoto en cada arranque ata la
   app a que el CDN siga vivo, a que el dispositivo tenga red y a que el CSP de
   Tauri lo permita. Cualquiera de las tres fallando = pantalla negra.
3. **Versionado.** El CDN sirve siempre la ultima version del asset; el dia que
   lo reconstruyan, el juego cambia solo. Vendorizado, lo que probamos es lo que
   corre.

Los modulos solo dependen de `three` y de
`three/addons/utils/BufferGeometryUtils.js`, que ya son dependencias del
proyecto (`three@0.186.1`), asi que no arrastran nada nuevo.

## Nota de licencia del pedido original

`grass-tile-37e1a7` (el que venia importado como `./grass-tile-37e1a7.mjs`) es
un asset **de pago** (`free: false`) y su `.mjs` da 404 en el CDN publico. Se
reemplazo por `grass-ground-tile-131ec0`, que es libre y tiene el mismo rol.
