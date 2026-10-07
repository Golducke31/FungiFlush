# Arte de la expansión `deep_mycelium`

Pipeline usado, anclas y prompts verbatim de los 13 assets generados para la
expansión `deep_mycelium` (12 cartas + 1 dorso).

> Reglas de la skill `game-art-asset-pipeline`:
> **el estilo se hereda, no se describe.** Cada imagen usa una ancla real del
> propio juego (`art_card_<elemento>_common.png` para cartas;
> `art_cardback.png` para el dorso). El prompt en dos mitades:
> 1. HEREDAR estilo (mismo outline, mismo rim glow, misma banda de composición).
> 2. REEMPLAZAR sujeto (forma concreta + color de acento por hex).
> Más input_fidelity=medium y 1024×1536 (2:3, igual que la carta).

---

## 1. Anclas base usadas

| Sujeto | Ancla (`art-source/`) | Estilo heredado |
| --- | --- | --- |
| Cartas elementales (mycelium, symbiosis, crystal, parasite, neutral) | `art_card_<elemento>_common.png` | Flat shaded, outline grueso, vignette oscuro, haz de luz superior, charco de musgo elíptico, banda útil 18-62%. |
| Dorso | `art_cardback.png` | Patrón de mandala/micelio simétrico con borde decorado. |

---

## 2. Prompts verbatim (uno por archivo)

Todos siguen esta plantilla (los placeholders `<...>` cambian por carta):

```text
Keep the EXACT rendering style of the reference image: same thick black outline,
same flat shaded illustration, same rim glow, same dark vignette background
with subtle teal-violet gradient, same thin spotlight beam from above, same
elliptical mossy ground pool under the subject, same matte finish, same
composition band with the subject confined to the central 18-62% band and the
top 18% and bottom 38% staying dark and empty.

REPLACE the subject with: <forma concreta + color de acento>.

NOT <lo que NO es>.
```

### `art_card_own_deep_latent_sporocarp.png` — mycelium common
> Ancla: `art_card_mycelium_common.png`
>
> Sujeto: a dormant egg-like sporocarp sitting on mossy ground, cracked open at
> the top, with thin cyan roots spreading downward into the soil and a soft
> cyan spore plume rising from the crack. Accent cyan #6fe0d8 over deep moss
> green #0d2a1a.

### `art_card_own_deep_chain_rhizomorph.png` — mycelium uncommon
> Ancla: `art_card_mycelium_common.png`
>
> Sujeto: three small bracket-style mushrooms in a horizontal chain, linked by
> a glowing cyan rhizomorph filament running through their stems. Accent cyan
> #6fe0d8 with a faint teal halo.

### `art_card_own_deep_herald_cap.png` — symbiosis uncommon
> Ancla: `art_card_symbiosis_common.png`
>
> Sujeto: a single tall, slender mushroom with a smooth brown conical head on a
> cyan glowing ring drawn on the moss; the only element of the composition
> (signal of "opening"). Accent brown cap #8b5a3c over cyan ring #6fe0d8.

### `art_card_own_deep_cross_mycorrhiza.png` — symbiosis common
> Ancla: `art_card_symbiosis_common.png`
>
> Sujeto: two intertwined mushrooms (one cream boletus, one violet-blue capped)
> with their stems visibly fusing at the base; small green root knot visible at
> the fusion point. Accent cream #d9c8a0 + violet-blue #7a6ac8.

### `art_card_own_deep_hybrid_lattice.png` — symbiosis rare
> Ancla: `art_card_symbiosis_common.png`
>
> Sujeto: two opposing brown bracket caps (top and bottom) with a glowing
> purple-and-white diamond lattice connecting them; the lattice looks like a
> crystal bridge. Accent amber #d8a55c + crystal violet #b89aff.
>
> Rare sin gleba/bracket único; silueta debe leer como dos caps conectados por
> una celosía.

### `art_card_own_deep_slumber_amanita.png` — mycelium uncommon
> Ancla: `art_card_mycelium_common.png`
>
> Sujeto: a low, rounded dark-blue amanita cap with a faint spiral motif on the
> top, a thin purple halo ring above it (sleep aura) and closed eye-like slits
> where gills would be. Accent deep blue #233a8a + halo #6a3a8c.

### `art_card_own_deep_awakening_bracket.png` — crystal rare
> Ancla: `art_card_crystal_common.png`
>
> Sujeto: a wide, flat crystal bracket (icy blue) with jagged stalactite-like
> points beneath, glowing from a bright core; concentric faint rings radiating
> outward (awakening). Accent icy blue #8fc5ff over crystal rim #cfeaff.
>
> NOT a cap; silueta horizontal y dentada.

### `art_card_own_deep_network_core.png` — mycelium rare
> Ancla: `art_card_mycelium_common.png`
>
> Sujeto: a central woven blue knot (interlaced filaments like a Celtic
> pattern) with six thin branches extending outward to small glowing nodes;
> visible at the end of each branch. Accent deep blue #4a3a8a + node glow
> #ffc66a.

### `art_card_own_deep_symbiont_veil.png` — symbiosis common
> Ancla: `art_card_symbiosis_common.png`
>
> Sujeto: a small veiled mushroom covered by a long, draped white shroud-like
> membrane falling to the moss; two faint cyan glowing dots peek through the
> membrane (eyes). Accent white shroud #e8e8e0 + cyan eyes #6fe0d8.

### `art_card_own_deep_spore_conduit.png` — neutral uncommon
> Ancla: `art_card_neutral_common.png`
>
> Sujeto: a hollow vertical tube-like fungal stalk with several circular
> openings (sieve plates) along its body; small cyan spores rising from the top
> opening. Accent cyan spores #6fe0d8 + stalk teal #3a6a7a.
>
> NOT un único mushroom; silueta cilíndrica con agujeros.

### `art_card_own_deep_parasite_lash.png` — parasite common
> Ancla: `art_card_parasite_common.png`
>
> Sujeto: a curved purple/pink parasitic tendril emerging from the moss,
> covered in suction-cup-like nodes dripping a pink fluid, lit from above by a
> purple spotlight. Accent purple #6a3a8c + pink fluid #d56ad8.
>
> NOT un hongo; silueta curvada tipo tentáculo.

### `art_card_own_deep_carrion_lattice.png` — parasite rare
> Ancla: `art_card_parasite_common.png`
>
> Sujeto: a horizontal lattice/web of thin mold filaments in a geometric grid
> pattern, woven over partially-consumed skeletal remains (bone fragment
> visible beneath the mesh); small dark fruiting bodies at grid intersections.
> Accent magenta-purple #6a3a8c → blood-orange #a44a18 where mold meets bone.
> Rare: golden-amber rim light, soft halo glow, faint concentric rings.
>
> NOT a single mushroom; NOT a coral; NOT a tube. Silueta horizontal geométrica
> con huesos debajo.

### `art_cardback_mycelial.png` — dorso cosmético
> Ancla: `art_cardback.png`
>
> Sujeto: un mandala circular de micelio bioluminiscente en cian sobre fondo
> oscuro, con cuatro champiñones decorativos en las esquinas y motivos de
> esporas/ramas internas. Acento cyan #6fe0d8 sobre azul noche #0a1428.
>
> Mismo layout cuadrado y simétrico que el dorso base; solo cambia la paleta a
> tonos mycelium (cian/teal en lugar de verde).

---

## 3. Pipeline de integración (idempotente)

1. Mover el PNG generado por la skill a `art-source/<clave>.png`.
   (El output de la tool llega como `Keep_the_EXACT_rendering_style_<ts>.png`;
   renombrar **antes** de correr el script.)
2. `python tools/optimize_art.py` (con Pillow instalado en el venv gestionado).
3. `npm run art:index` regenera `public/art/index.json` (manifiesto).
4. `npm run validate` debe decir **77 cartas / 77 ilustraciones distintas**.
5. `npm run smoke` debe decir **0 errores / 0 excepciones / 0 avisos**.

## 4. Trampas que aparecieron en este lote

| Trampa | Síntoma | Cómo se arregla |
| --- | --- | --- |
| Colisión de timestamp | dos generaciones devolvieron `…17-43-22.png` y la segunda pisó a la primera. | detectar el choque leyendo cada imagen; regenerar la faltante (carrion_lattice). |
| `optimize_art.py` no recursa | los PNG en `art-source/_gen_deep/*.png` no se procesan. | moverlos a `art-source/*.png` antes de correr el script. |
| Asset compartido con otra carta | validador reportaba "8 ilustraciones shared" hasta que cada deep tuvo su propio PNG. | 1 PNG por carta, sin reuso (chequeo `77/77`). |