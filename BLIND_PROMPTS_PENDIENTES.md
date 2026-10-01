# Prompts pendientes — 11 ilustraciones de ciego

Método: **imagen-a-imagen** obligatorio (§0.4 de `ART_PROMPTS.md`). Texto-a-imagen sale
fotorrealista y rompe el set. Cada bloque de abajo es autocontenido: pegás el prompt, subís la
imagen de ancla que dice la ficha, ponés `input_fidelity: medium` y guardás el PNG como
`art-source/art_blind_<clave>.png` (2:3, 1024×1536).

Después: `npm run art` y listo. El circuito completo está en §10.4 de `ART_PROMPTS.md`.

**Ya generadas (13/24):** a1 small/big/boss, a2 small/big/boss, a3 small/big/boss,
a4 small/big/boss, a5 small.

---

## a5 · big — `art_blind_blind_a5_big` · "Osario"

**Ancla:** `art-source/art_card_crystal_uncommon.png`

```text
Keep the EXACT rendering style of the reference image: same clean digital illustration look, same thick dark outline, same smooth airbrushed shading, same matte finish, same near-black teal background (#080b10 to #0d131b), same dark mossy ground, same thin bright rim glow, same vertical shaft of light from the top centre. No film grain, never photorealistic.

REPLACE the subject with: an EMPTY ENVIRONMENT SCENE, no mushroom specimen centred. A bone ossuary filling a shallow stone alcove: hundreds of stacked pale bones packed into the wall like firewood, bleached mushroom growths sprouting in the gaps between them, a scatter of loose bones and broken antlers across the floor in front. Everything is calcium-white and ancient. Change the accent colour from cyan to a saturated mint (#4fd18b): the light is greenish and comes from the growth inside the wall of bones, with a cooler rim from above.

Tier big: the same space under pressure. A secondary light source deeper in the alcove, faint drifting spore motes, richer contrast, silhouetted shapes at the edges of frame. It should read as "this will cost you something".

COMPOSITION: vertical 2:3. The scene's point of interest sits in the band from 10% to 72% of the image height; the top 10% stays dark and empty, and the bottom 28% is a dark empty foreground with no detail at all (game UI text sits there). Full-bleed background, no inner panel, no frame.

NEGATIVE: text, letters, numbers, watermark, signature, logo, frame, border, card template, UI mockup, rounded inner panel, photorealistic, photograph, glossy 3D render, harsh specular highlights, a single hero mushroom in the centre, skulls with faces, skeletons, multiple unrelated subjects, busy background, humans, hands, faces, creatures, blurry, low contrast
```

---

## a5 · boss — `art_blind_blind_a5_boss` · "La Colonia Devoradora"

**Ancla:** `art-source/art_card_parasite_legendary.png`

```text
Keep the EXACT rendering style of the reference image: same clean digital illustration look, same thick dark outline, same smooth airbrushed shading, same matte finish, same near-black teal background (#080b10 to #0d131b), same thin bright rim glow, same vertical shaft of light from the top centre. No film grain, never photorealistic.

REPLACE the subject with: a HOSTILE ENVIRONMENT SCENE, no single mushroom specimen centred. A devouring colony: an enormous mass of overlapping flat bracket fungi stacked in tiers up the far wall like shelves, each one dripping thick pale fluid, with a shallow lake of that fluid covering the floor and reflecting them back. The mass should look like it is digesting the whole chamber and slowly spreading toward the viewer.

Change the accent colour from magenta to warm rust-orange (#e2845c): two light sources — a cold shaft from above AND a hard warm rim coming from the low left — dramatic chiaroscuro, dense airborne spores drifting through both beams.

Tier boss: the space is actively hostile. Heavy dark foreground frame across the bottom (out-of-focus dark shelf edges, no detail, game UI text sits there), dramatic contrast, the colony reads as alive.

COMPOSITION: vertical 2:3. The point of interest sits in the band from 10% to 72% of the image height; the top 10% stays dark and empty, and the bottom 28% is a dark empty foreground with no detail. Full-bleed background, no inner panel, no frame.

NEGATIVE: text, letters, numbers, watermark, signature, logo, frame, border, card template, UI mockup, rounded inner panel, photorealistic, photograph, glossy 3D render, harsh specular highlights, a single hero mushroom in the centre, a mouth, teeth, eyes, humanoid, multiple unrelated subjects, busy background, humans, hands, creatures, blurry, low contrast
```

---

## a6 · small — `art_blind_blind_a6_small` · "Capa de Ceniza"

**Ancla:** `art-source/art_card_decay_common.png`

```text
Keep the EXACT rendering style of the reference image: same clean digital illustration look, same thick dark outline, same smooth airbrushed shading, same matte finish, same near-black teal background (#080b10 to #0d131b), same thin bright rim glow, same vertical shaft of light from the top centre. No film grain, never photorealistic.

REPLACE the subject with: an EMPTY ENVIRONMENT SCENE, no mushroom specimen centred. A burnt forest floor sealed under a layer of pale grey ash: the ash lies smooth and undisturbed like fresh snow across the whole ground, a few charred black stumps poking through it at the sides, thin smoke still rising from the ash in slow ribbons, the far wall of the space lost in haze. Change the accent colour from rust-brown to cold desaturated blue-grey (#9aa5b1): the only light is thin and pale from above and it barely reflects off the ash.

Tier small: a quiet, almost empty room. One soft desaturated light source, no floating particles, low contrast, muted palette, a wide empty dark foreground across the bottom half. It should read as "safe, for now".

COMPOSITION: vertical 2:3. The scene's point of interest sits in the band from 10% to 72% of the image height; the top 10% stays dark and empty, and the bottom 28% is a dark empty foreground with no detail at all (game UI text sits there). Full-bleed background, no inner panel, no frame.

NEGATIVE: text, letters, numbers, watermark, signature, logo, frame, border, card template, UI mockup, rounded inner panel, photorealistic, photograph, glossy 3D render, harsh specular highlights, a single hero mushroom in the centre, fire, flames, orange glow, multiple unrelated subjects, busy background, humans, hands, faces, creatures, blurry, low contrast
```

---

## a6 · big — `art_blind_blind_a6_big` · "Capilla Podrida"

**Ancla:** `art-source/art_card_parasite_common.png`

```text
Keep the EXACT rendering style of the reference image: same clean digital illustration look, same thick dark outline, same smooth airbrushed shading, same matte finish, same near-black teal background (#080b10 to #0d131b), same thin bright rim glow, same vertical shaft of light from the top centre. No film grain, never photorealistic.

REPLACE the subject with: an EMPTY ENVIRONMENT SCENE, no mushroom specimen centred. The interior of a ruined chapel that the forest has reclaimed: two rows of stone arch columns receding toward a collapsed altar, every surface furred with pale fungal growth, hanging cords of spores draped between the arches like funeral banners, a shaft of light coming down through the broken roof onto the altar. Change the accent colour from magenta to a saturated mint (#4fd18b): the light is greenish and comes from that roof opening, plus a dim secondary glow from the fungal growth itself.

Tier big: the same space under pressure. A secondary light source deeper toward the altar, faint drifting spore motes, richer contrast, silhouetted shapes at the edges of frame. It should read as "this will cost you something".

COMPOSITION: vertical 2:3. The scene's point of interest sits in the band from 10% to 72% of the image height; the top 10% stays dark and empty, and the bottom 28% is a dark empty foreground with no detail at all (game UI text sits there). Full-bleed background, no inner panel, no frame.

NEGATIVE: text, letters, numbers, watermark, signature, logo, frame, border, card template, UI mockup, rounded inner panel, photorealistic, photograph, glossy 3D render, harsh specular highlights, a single hero mushroom in the centre, crosses, religious symbols, statues with faces, multiple unrelated subjects, busy background, humans, hands, faces, creatures, blurry, low contrast
```

---

## a6 · boss — `art_blind_blind_a6_boss` · "Titán del Suelo"

**Ancla:** `art-source/art_card_mycelium_mythic.png`

```text
Keep the EXACT rendering style of the reference image: same clean digital illustration look, same thick dark outline, same smooth airbrushed shading, same matte finish, same near-black teal background (#080b10 to #0d131b), same thin bright rim glow, same vertical shaft of light from the top centre. No film grain, never photorealistic.

REPLACE the subject with: a HOSTILE ENVIRONMENT SCENE, no single mushroom specimen centred. A colossus growing out of the floor: an enormous squat fungal mass with a wide flat cap, so large it fills the back half of the chamber, its stalk made of fused hyphal cables as thick as tree trunks. Around its base the ground has cracked and lifted in slabs. It is too big to fit in frame and you can only see part of it, which is the point.

Change the accent colour from magenta to warm rust-orange (#e2845c): two light sources — a cold shaft from above AND a hard warm rim coming from the low right — dramatic chiaroscuro, dense airborne spores drifting through both beams.

Tier boss: the space is actively hostile. Heavy dark foreground frame across the bottom (out-of-focus dark cracked ground, no detail, game UI text sits there), dramatic contrast, the mass reads as alive and looming.

COMPOSITION: vertical 2:3. The point of interest sits in the band from 10% to 72% of the image height; the top 10% stays dark and empty, and the bottom 28% is a dark empty foreground with no detail. Full-bleed background, no inner panel, no frame.

NEGATIVE: text, letters, numbers, watermark, signature, logo, frame, border, card template, UI mockup, rounded inner panel, photorealistic, photograph, glossy 3D render, harsh specular highlights, legs, feet, arms, eyes, face, giant humanoid, multiple unrelated subjects, busy background, humans, hands, creatures, blurry, low contrast
```

---

## a7 · small — `art_blind_blind_a7_small` · "Salar"

**Ancla:** `art-source/art_card_neutral_common.png`

```text
Keep the EXACT rendering style of the reference image: same clean digital illustration look, same thick dark outline, same smooth airbrushed shading, same matte finish, same near-black teal background (#080b10 to #0d131b), same thin bright rim glow, same vertical shaft of light from the top centre. No film grain, never photorealistic.

REPLACE the subject with: an EMPTY ENVIRONMENT SCENE, no mushroom specimen centred. A salt flat: a vast plain of cracked white-grey salt crust stretching away, the plates separated by dark fissures, a few pale crystallised pillars standing at the sides, the horizon lost in haze. Almost nothing lives here. Change the accent colour from blue-grey to a cold desaturated blue-grey (#9aa5b1): the light is flat, pale and enormous, coming from everywhere at once with no visible source.

Tier small: a quiet, almost empty room. One soft desaturated light source, no floating particles, low contrast, muted palette, a wide empty dark foreground across the bottom half. It should read as "safe, for now".

COMPOSITION: vertical 2:3. The scene's point of interest sits in the band from 10% to 72% of the image height; the top 10% stays dark and empty, and the bottom 28% is a dark empty foreground with no detail at all (game UI text sits there). Full-bleed background, no inner panel, no frame.

NEGATIVE: text, letters, numbers, watermark, signature, logo, frame, border, card template, UI mockup, rounded inner panel, photorealistic, photograph, glossy 3D render, harsh specular highlights, a single hero mushroom in the centre, desert sky, blue sky, sun, clouds, multiple unrelated subjects, busy background, humans, hands, faces, creatures, blurry, low contrast
```

---

## a7 · big — `art_blind_blind_a7_big` · "Campo Marchito"

**Ancla:** `art-source/art_card_neutral_uncommon.png`

```text
Keep the EXACT rendering style of the reference image: same clean digital illustration look, same thick dark outline, same smooth airbrushed shading, same matte finish, same near-black teal background (#080b10 to #0d131b), same thin bright rim glow, same vertical shaft of light from the top centre. No film grain, never photorealistic.

REPLACE the subject with: an EMPTY ENVIRONMENT SCENE, no mushroom specimen centred. A withered crop field: rows of collapsed grey stalks bent over and rotting into the ground, a crooked scarecrow frame in the middle distance with nothing left on it, the soil dry and cracked between the rows, everything collapsing inward. Change the accent colour from blue-grey to a saturated mint (#4fd18b): the light is sickly green and comes from a single source above, picking out the few stalks still standing.

Tier big: the same space under pressure. A secondary light source deeper between the rows, faint drifting spore motes, richer contrast, silhouetted shapes at the edges of frame. It should read as "this will cost you something".

COMPOSITION: vertical 2:3. The scene's point of interest sits in the band from 10% to 72% of the image height; the top 10% stays dark and empty, and the bottom 28% is a dark empty foreground with no detail at all (game UI text sits there). Full-bleed background, no inner panel, no frame.

NEGATIVE: text, letters, numbers, watermark, signature, logo, frame, border, card template, UI mockup, rounded inner panel, photorealistic, photograph, glossy 3D render, harsh specular highlights, a single hero mushroom in the centre, a person, a body on a pole, multiple unrelated subjects, busy background, humans, hands, faces, creatures, blurry, low contrast
```

---

## a7 · boss — `art_blind_blind_a7_boss` · "El Anillo de Ceniza"

**Ancla:** `art-source/art_card_decay_legendary.png`

```text
Keep the EXACT rendering style of the reference image: same clean digital illustration look, same thick dark outline, same smooth airbrushed shading, same matte finish, same near-black teal background (#080b10 to #0d131b), same thin bright rim glow, same vertical shaft of light from the top centre. No film grain, never photorealistic.

REPLACE the subject with: a HOSTILE ENVIRONMENT SCENE, no single mushroom specimen centred. A perfect ring of black ash burnt into the ground, wide enough that the viewer is standing outside it looking in. Everything inside the ring is dead and grey; the ring itself is a thick charred band still smouldering faint orange at its edges, and thin ash is lifting off it into the air. The circle should read as a boundary that marks you if you cross it.

Change the accent colour from rust-brown to warm rust-orange (#e2845c): two light sources — a cold shaft from above AND a hard warm rim coming from the low right off the smouldering ash — dramatic chiaroscuro, dense airborne ash drifting through both beams.

Tier boss: the space is actively hostile. Heavy dark foreground frame across the bottom (out-of-focus dark charred ground, no detail, game UI text sits there), dramatic contrast, the ring reads as active.

COMPOSITION: vertical 2:3. The point of interest sits in the band from 10% to 72% of the image height; the top 10% stays dark and empty, and the bottom 28% is a dark empty foreground with no detail. Full-bleed background, no inner panel, no frame.

NEGATIVE: text, letters, numbers, watermark, signature, logo, frame, border, card template, UI mockup, rounded inner panel, photorealistic, photograph, glossy 3D render, harsh specular highlights, a single hero mushroom in the centre, open flames, bonfire, runes, glowing magic circle, multiple unrelated subjects, busy background, humans, hands, faces, creatures, blurry, low contrast
```

---

## a8 · small — `art_blind_blind_a8_small` · "Floración Final"

**Ancla:** `art-source/art_card_symbiosis_rare.png`

```text
Keep the EXACT rendering style of the reference image: same clean digital illustration look, same thick dark outline, same smooth airbrushed shading, same matte finish, same near-black teal background (#080b10 to #0d131b), same dark mossy ground, same thin bright rim glow, same vertical shaft of light from the top centre. No film grain, never photorealistic.

REPLACE the subject with: an EMPTY ENVIRONMENT SCENE, no mushroom specimen centred. A quiet clearing at the end of everything: soft deep moss across the floor, a handful of small pale caps growing in a loose scattered arc in the middle distance, a single wide shaft of moonlight coming straight down onto the moss, everything calm and still. This is the last peaceful room before the end. Change the accent colour from mint green to a cold desaturated blue-grey (#9aa5b1): the only light is the one shaft, dim and silver.

Tier small: a quiet, almost empty room. One soft desaturated light source, no floating particles, low contrast, muted palette, a wide empty dark foreground across the bottom half. It should read as "safe, for now".

COMPOSITION: vertical 2:3. The scene's point of interest sits in the band from 10% to 72% of the image height; the top 10% stays dark and empty, and the bottom 28% is a dark empty foreground with no detail at all (game UI text sits there). Full-bleed background, no inner panel, no frame.

NEGATIVE: text, letters, numbers, watermark, signature, logo, frame, border, card template, UI mockup, rounded inner panel, photorealistic, photograph, glossy 3D render, harsh specular highlights, a single hero mushroom in the centre, multiple unrelated subjects, busy background, humans, hands, faces, creatures, blurry, low contrast
```

---

## a8 · big — `art_blind_blind_a8_big` · "Mar Micelial"

**Ancla:** `art-source/art_card_mycelium_rare.png`

```text
Keep the EXACT rendering style of the reference image: same clean digital illustration look, same thick dark outline, same smooth airbrushed shading, same matte finish, same near-black teal background (#080b10 to #0d131b), same thin bright rim glow, same vertical shaft of light from the top centre. No film grain, never photorealistic.

REPLACE the subject with: an EMPTY ENVIRONMENT SCENE, no mushroom specimen centred. An ocean of mycelium: the whole floor is a rolling mat of interwoven violet-white filaments, undulating in slow waves like water, with taller filament pinnacles and arches rising out of it at the sides. Everything is connected by cords that run across the surface in long converging lines. Change the accent colour from violet to a saturated mint (#4fd18b): the light comes from a single source above and from the filaments themselves, which glow faintly from within.

Tier big: the same space under pressure. A secondary light source deeper across the filaments, faint drifting spore motes, richer contrast, silhouetted shapes at the edges of frame. It should read as "this will cost you something".

COMPOSITION: vertical 2:3. The scene's point of interest sits in the band from 10% to 72% of the image height; the top 10% stays dark and empty, and the bottom 28% is a dark empty foreground with no detail at all (game UI text sits there). Full-bleed background, no inner panel, no frame.

NEGATIVE: text, letters, numbers, watermark, signature, logo, frame, border, card template, UI mockup, rounded inner panel, photorealistic, photograph, glossy 3D render, harsh specular highlights, a single hero mushroom in the centre, water, waves, ocean, tentacles, multiple unrelated subjects, busy background, humans, hands, faces, creatures, blurry, low contrast
```

---

## a8 · boss — `art_blind_blind_a8_boss` · "Dios Micelio"

**Ancla:** `art-source/art_card_mycelium_mythic.png`

```text
Keep the EXACT rendering style of the reference image: same clean digital illustration look, same thick dark outline, same smooth airbrushed shading, same matte finish, same near-black teal background (#080b10 to #0d131b), same thin bright rim glow, same vertical shaft of light from the top centre. No film grain, never photorealistic.

REPLACE the subject with: a HOSTILE ENVIRONMENT SCENE, no single mushroom specimen centred. The end of everything: a colossal dome of mycelium filling the entire back of the image, its surface a labyrinth of ridges and glowing veins, with thick cables fanning out from it across the floor in every direction toward the viewer. A ring of floating filaments orbits slowly around it like a halo. Nothing is in scale with it: it is a landscape, not an object.

Change the accent colour from magenta to warm rust-orange (#e2845c): two light sources — a cold shaft from above AND a hard warm rim coming from the low left — dramatic chiaroscuro, dense airborne spores drifting through both beams.

Tier boss: the space is actively hostile. Heavy dark foreground frame across the bottom (out-of-focus dark cables, no detail, game UI text sits there), dramatic contrast, the mass reads as alive and aware.

COMPOSITION: vertical 2:3. The point of interest sits in the band from 10% to 72% of the image height; the top 10% stays dark and empty, and the bottom 28% is a dark empty foreground with no detail. Full-bleed background, no inner panel, no frame.

NEGATIVE: text, letters, numbers, watermark, signature, logo, frame, border, card template, UI mockup, rounded inner panel, photorealistic, photograph, glossy 3D render, harsh specular highlights, a single hero mushroom in the centre, eyes, face, mouth, halo with religious symbols, glowing magic circle, humanoid god, multiple unrelated subjects, busy background, humans, hands, creatures, blurry, low contrast
```
