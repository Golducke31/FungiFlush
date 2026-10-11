# FungiFlush — Prompts de rediseño visual (arte nuevo)

> **Qué es este documento.** El contrato de producción del rediseño visual: el fondo de arena,
> el kit de marcos del HUD, el marco de carta y **las ~109 ilustraciones de carta** (40
> elemento×rareza + 54 propias + 13 ciegos + 2 reversos). Es el "plan aparte" con los prompts
> detallados. Cada prompt es autocontenido y listo para pegar.
>
> **Estado:** el código del rediseño está en curso (`plans/swift-vortex-lovelace-erXAaLIy.md`).
> Este documento es el **contrato de contenido**, no cambia el código.
>
> **Los prompts están en inglés** (los modelos de imagen rinden mejor así; el resto del doc, en
> español). **Imagen-a-imagen, no texto-a-imagen** (ver §0.4).

---

## 0. Cómo usar este documento

### 0.1 El ancla de linaje = el nuevo fondo de arena

Toda la ilustración nueva se genera por **imagen-a-imagen anclada en `art-source/art_backdrop.png`**
(la imagen de la arena a pantalla completa, que produce el equipo del juego). Ese fondo YA trae
el nuevo look: bosque oscuro, micelio luminoso cian/violeta, musgo, setas, bruma, luz cálida.
Anclar en él hace que escenario e ilustraciones salgan del **mismo árbol** y no se vea como dos
juegos distintos.

- El equipo te deja `art-source/art_backdrop.png` listo. **Mientras tanto**, usa la imagen de
  referencia que diste (`clipboard-…-b7aea5d8.jpg`) como ancla directa: la composición y la paleta
  son las mismas.
- El `common` de cada elemento es el ancla de su familia; las 5 rarezas de una familia se anclan en
  su propio `common` (no en el backdrop global) para que se lean como el mismo organismo en cinco
  momentos.

### 0.2 El circuito completo (de la imagen al juego)

| Paso | Qué hacés | Comando / destino |
| --- | --- | --- |
| 1 | Generás la imagen con el prompt del slot | PNG, **2:3 vertical (1024×1536)** |
| 2 | La nombrás **exactamente** como el slot | `art-source/art_card_<…>.png` (ver §2) |
| 3 | La optimizás (recorta a 512×744 + WebP) | `python tools/optimize_art.py` |
| 4 | Regenerás el manifiesto | `node tools/genArtIndex.mjs` |
| 5 | Verificás en el juego | `npm run dev` |
| 6 | (Opcional) Revisar el set de un vistazo | `public/art/_contact_sheet.jpg` (lo genera el paso 3) |

Los pasos 3 y 4 juntos son `npm run art`. El 4 solo es `npm run art:index`.
**Requirement de Python:** `Pillow` (ya instalado en el venv administrado).

### 0.3 Tres reglas que no se negocian

1. **El nombre del archivo ES la clave.** `art_card_crystal_mythic.png` → clave `card_crystal_mythic`.
   Un typo no rompe nada: la carta cae al respaldo **en silencio** y vas a creer que la imagen no
   te gustó. Verificá con `npm run art:index` que el archivo entró.
2. **No hace falta tener las 109 para shipear.** La cadena de respaldo
   (`card_<elem>_<rar>` → `card_<elem>_common` → arte viejo → dibujo procedural) mantiene el juego
   jugable en cualquier punto intermedio. **Generá por lotes** (§3), no de a 109.
3. **Una imagen por archivo, sin texto ni marco horneados.** El nombre, los chips de estadística,
   las descripciones y el marco de carta los dibuja el canvas encima. Si el arte trae texto o marco,
   se superpone a lo real.

### 0.4 Método real de generación (obligatorio para un set grande)

1. **Ancla** = `art_backdrop.png` (o tu referencia) para el set global; el `common` del elemento para
   cada familia. `input_fidelity: medium`.
2. **El prompt dice dos cosas:** (a) *"Keep the EXACT rendering style of the reference image: …"*
   (el bloque `STYLE CORE` de §1.2) y (b) *"REPLACE the subject with: <sujeto>"* (§2).
3. **Cambiar el acento por nombre y por hex** (§1.3). Sin esto el ancla contagia su paleta y todo el
   set sale del mismo color.
4. **Recordar la rareza explícita** (el ancla es un `common`, así que arrastra hacia lo simple):
   *"Rarity legendary: golden-amber rim light, halo bloom, faint concentric rings"*.
5. **Piloto A/B** (§3.0): el mismo slot por **texto-a-imagen** vs **imagen-a-imagen** antes de gastar
   el lote. Con el ancla alcanza 1 generación por slot.

---

## 1. El sistema visual (el contrato común)

### 1.1 Paleta bloqueada — acento por elemento

Fondo siempre (en TODAS las piezas): `#080b10` (negro-índigo de la escena) y `#0d141c` (cuerpo de
la carta / suelo). Son el `background` de la escena y `UI_COLORS.background`/`table` del código.

Acento por elemento (es el color del halo, del anillo y de los chips en el juego; tiene que
coincidir con `src/render/palette.ts`):

| Elemento | Hex | Vibe del sujeto |
|---|---|---|
| `neutral` | `#9aa5b1` | piedra/plata, seta humilde |
| `poison` | `#8ce63f` | verde ácido, gotas |
| `spore` | `#f2c14e` | ámbar, polvo |
| `decay` | `#c1683a` | óxido/marrones, podredumbre |
| `symbiosis` | `#4fd18b` | verde musgo, red |
| `crystal` | `#5fd8e8` | cian, geoda |
| `mycelium` | `#a78bfa` | violeta, telaraña |
| `parasite` | `#e05c8a` | magenta/rosa, parásito |

Rareza (solo afecta el **tratamiento**, no el sujeto): `common` plano · `uncommon` un realce ·
`rare` halo violeta · `legendary` borde ámbar + bloom · `mythic` borde rosa + destello.

### 1.2 STYLE CORE (pegado en cada prompt, tras la frase "Keep the EXACT rendering style…")

```text
Keep the EXACT rendering style of the reference image: same painterly digital illustration
look, same visible rounded brush strokes, same soft airbrushed shading, same thick dark outline,
same warm key light from above, same cool cyan-violet mycelium glow hugging the silhouette, same
mossy forest floor with small mushrooms and a faint low mist, same dark near-black indigo
background (#080b10 to #0d141c), same matte finish. NO photorealism, NO 3D render, NO flat
vector. One centred specimen on a mossy stone, NO text, NO frame, NO border.
```

> El `STYLE CORE` viejo de `ART_PROMPTS.md` describía un flat digital que **no** es este look:
> lo reemplaza el bloque de arriba.

### 1.3 Composición (se respeta en el código)

- Aspecto **2:3 (1024×1536)**. El script recorta a `512×744`.
- El sujeto ocupa solo la **banda del 18% al 62%** de la altura; arriba (18%) y abajo (38%)
  quedan oscuros, vacíos y libres de detalle (ahí el motor dibuja el nombre y las placas).
- Para los ciegos (`art_blind_*`) la banda es **10%–72%** y el sujeto es un **escenario** (la
  arena), no un espécimen centrado (ver §2.3 / `BLIND_PROMPTS_PENDIENTES.md`).

---

## 2. Catálogo de slots

Cada entrada: **archivo (`art-source/…png`) · acento · sujeto**. El prompt completo se arma así:

```text
Keep the EXACT rendering style of the reference image: <STYLE CORE de §1.2>
REPLACE the subject with: <sujeto de la tabla>.
Accent colour <elemento>: <hex de §1.1>.
Rarity <rareza>: <tratamiento de §1.1>.
input_fidelity: medium. NO text, NO frame, NO border.
```

### 2.1 40 — `art_card_<elemento>_<rareza>` (8 × 5)

Ancla de familia = el `common` del elemento; todas las familias se anclan en el backdrop. El
sujeto de cada elemento es el mismo prototipo; la rareza solo cambia el tratamiento.

| Elemento | Sujeto del prototipo (el `common`) |
|---|---|
| `neutral` | a humble pale toadstool on a mossy stone |
| `poison` | a glowing green poison mushroom with bright droplets |
| `spore` | an amber puffball releasing a soft spore cloud |
  | `decay` | a bracket fungus on a rotting log, rust-brown |
| `symbiosis` | a glowing root-fungus mycorrhizal network |
| `crystal` | a translucent cyan crystal mushroom, faceted |
| `mycelium` | a violet glowing mycelial web around a truffle |
| `parasite` | a magenta cordyceps erupting from a small host |

Generá las 40 combinando cada elemento × rareza. Ejemplo de prompt montado
(`art_card_crystal_legendary`):

```text
Keep the EXACT rendering style of the reference image: same painterly digital illustration
look, same visible rounded brush strokes, same soft airbrushed shading, same thick dark outline,
same warm key light from above, same cool cyan-violet mycelium glow hugging the silhouette, same
mossy forest floor with small mushrooms and a faint low mist, same dark near-black indigo
background (#080b10 to #0d141c), same matte finish. NO photorealism, NO 3D render, NO flat
vector. One centred specimen on a mossy stone, NO text, NO frame, NO border.
REPLACE the subject with: a translucent cyan crystal mushroom, faceted, on a mossy stone.
Accent colour crystal: #5fd8e8.
Rarity legendary: golden-amber rim light, halo bloom, faint concentric rings.
input_fidelity: medium. NO text, NO frame, NO border.
```

### 2.2 54 — `art_card_own_<id>` (ancladas en el `common` de su elemento)

Usá el sujeto sugerido (del nombre de la carta); el acento es el de su elemento (mismo hex que §1.1).

| id | elemento | sujeto |
|---|---|---|
| `amanita_apex_toxica` | poison | a tall toxic amanita, red cap, skull-like stem |
| `bridge_saprophyte` | symbiosis | a pale saprophyte bridge of fungus between stones |
| `colony_agaric_thread` | mycelium | a thread of agaric mycelium weaving a colony |
| `colony_amanita_web` | mycelium | amanita caps networked into a glowing web |
| `colony_boletus_root` | symbiosis | a boletus fused to a root system |
| `colony_clavaria_filament` | mycelium | coral-like clavaria filaments in a colony |
| `colony_network_node` | mycelium | a glowing node where mycelial threads converge |
| `colony_rhizomorph` | decay | thick black rhizomorph ropes on stone |
| `cordyceps_mind` | parasite | a cordyceps erupting from a small insect host |
| `crystal_agaric_facet` | crystal | a faceted crystal agaric |
| `crystal_amanita_shard` | crystal | an amanita shedding crystal shards |
| `crystal_boletus_prism` | crystal | a boletus cut like a prism |
| `crystal_glasscap` | crystal | a translucent glass-cap mushroom |
| `crystal_grand_coral` | crystal | a grand crystal coral mushroom |
| `crystal_prism_gill` | crystal | a mushroom whose gills are prisms |
| `crystal_shard_bloom` | crystal | a bloom of crystal shards |
| `crystal_tricholoma_lens` | crystal | a crystal tricholoma shaped like a lens |
| `decay_agaric_mould` | decay | a mouldy agaric on rot |
| `decay_amanita_blight` | decay | a blighted amanita, wilting |
| `decay_ancient_stump` | decay | an ancient rotten stump with fungi |
| `decay_boletus_slime` | decay | a slime-covered boletus |
| `decay_carrion_bloom` | decay | a bloom growing from carrion |
| `decay_clavaria_ash` | decay | a grey clavaria in ash |
| `decay_compost_heap` | decay | mushrooms on a compost heap |
| `decay_inkcap` | decay | a black inkcap mushroom |
| `decay_rotwood` | decay | fungus consuming rotted wood |
| `deep_awakening_bracket` | mycelium | a bracket fungus awakening in the deep dark |
| `deep_carrion_lattice` | mycelium | a fungus lattice over carrion in the deep |
| `deep_chain_rhizomorph` | mycelium | chains of rhizomorph in the dark |
| `deep_cross_mycorrhiza` | mycelium | crossing mycorrhiza in the deep |
| `deep_herald_cap` | mycelium | a herald cap glowing in the deep |
| `deep_hybrid_lattice` | mycelium | a hybrid lattice structure |
| `deep_latent_sporocarp` | mycelium | a latent sporocarp in the deep |
| `deep_network_core` | mycelium | the glowing core of a deep network |
| `deep_parasite_lash` | mycelium | a parasitic lash in the deep |
| `deep_slumber_amanita` | mycelium | a sleeping amanita in the deep |
| `deep_spore_conduit` | mycelium | a conduit channeling spores in the deep |
| `deep_symbiont_veil` | mycelium | a symbiotic veil in the deep |
| `ergot_rye` | spore | ergot sclerotia on a rye stalk |
| `ghost_fungus` | symbiosis | a pale ghost fungus, faint glow |
| `mycelium_truffle` | mycelium | a violet truffle with mycelium |
| `mycelium_webcap` | mycelium | a webcap mushroom with mycelial web |
| `poison_goldcap` | poison | a golden-capped poison mushroom |
| `shiitake_hearty` | neutral | a hearty shiitake cluster |
| `spore_amanita_veil` | spore | an amanita with a spore veil |
| `spore_archetype_burst_cap` | spore | a bursting spore cap (archetype) |
| `spore_archetype_signal` | spore | a signalling spore cap (archetype) |
| `spore_boletus_puff` | spore | a puffball boletus |
| `spore_clavaria_spray` | spore | a spray of clavaria |
| `spore_fairycake` | spore | a small fairycake puffball |
| `spore_psilocybe_dust` | spore | a psilocybe shedding dust |
| `spore_veilcap` | spore | a veiled spore cap |
| `symbiosis_mycorrhiza` | symbiosis | a mycorrhizal symbiosis, root + fungus |
| `wild_dung_beetle` | decay | a dung beetle with a small mushroom |

### 2.3 13 — `art_blind_<key>` (escenario, NO espécimen centrado)

Ancla = backdrop. Banda 10%–72%. El sujeto es la **arena** (plataforma de runas, setas, fuego
fácil). Escala por `tier`: `small` plano · `big` más detalle/bruma · `boss` imponente, glow fuerte.
Plantilla: `<tier>: a dark mossy forest arena with a glowing rune platform, scattered mushrooms
and faint fireflies; <tier treatment>. Accent: violet #a78bfa.` Usá `BLIND_PROMPTS_PENDIENTES.md`
para los ambientes específicos de cada ciego; llevá la banda 10%–72%.

Claves: `blind_a1_small|big|boss`, `blind_a2_small|big|boss`, `blind_a3_small|big|boss`,
`blind_a4_small|big|boss`, `blind_a5_small`.

### 2.4 2 — reversos

- `art_cardback` → a closed wooden plank with a glowing mycelium sigil, mossy, dark; no text.
- `art_cardback_mycelial` → el mismo, variante violeta de micelio más densa.

### 2.5 `card_frame.webp` + kit de marcos del HUD (anclados en recortes de la referencia)

Estos los genera el equipo del juego con imagen-a-imagen anclada en la referencia
(`clipboard-…-c6d381ee.jpg`), a 2×. Acá solo los listo para que sepas que NO los generás vos:

- `public/art/card_frame.webp` — marco de carta 512×744, centro transparente, madera/musgo + borde
  dorado + esquinas de seta.
- `public/ui/frames/panel.png` · `plate.png` · `button.png` · `chip.png` · `gold_corner.png` ·
  `badge_circle.png` — marcos pintados 9-slice para el HUD (ver plan, Fase C).

---

## 3. Lotes y orden recomendado

| Lote | Contenido | Quién |
|---|---|---|
| 0 | **Piloto A/B** (mismo slot, texto vs imagen-a-imagen) | vos |
| 1 | 40 `art_card_<elem>_<rar>` | vos |
| 2 | 54 `art_card_own_<id>` | vos |
| 3 | 13 `art_blind_*` + 2 reversos | vos |
| 4 | `card_frame` + kit HUD | equipo |

Cerrá cada lote con `npm run art` → `npm run validate` → `npm run smoke`. `validate-content.ts`
falla si dos cartas comparten ilustración (por eso existen las 54 propias): una imagen por archivo.
Verificación final en el juego: captura con el texto ya dibujado encima y, de a pares, dos de la
misma familia en pantalla para confirmar que se distinguen por **forma**, no por brillo.
