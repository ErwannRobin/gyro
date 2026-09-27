# GYROLL

**How far can you go?**

GYROLL is an endless 3D marble game for your phone. Tilt the phone to roll a heavy glass or metal marble along a narrow track floating in the void. The track twists, narrows, has holes, gaps and obstacles, and it slowly falls apart behind you. Don't fall off.

**▶ Play: [gyroll.vercel.app](https://gyroll.vercel.app/)** (best on a phone)

[![CI](https://github.com/ErwannRobin/gyro/actions/workflows/ci.yml/badge.svg)](https://github.com/ErwannRobin/gyro/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

![The five worlds of GYROLL](docs/worlds.jpg)

The whole game is **one self-contained `index.html` file** (about 230 KB): HTML, CSS, JavaScript, GLSL shaders and synthesized audio.
- It uses no libraries and no external assets, and it needs no network to play.
- It is assembled from readable source files in [`src/`](src) by a tiny build script that has no dependencies.
- A few optional files next to it make it installable and nice to share: icons, a manifest, a service worker and a preview image.

---

## Features

- **Gyroscope control.** Tilt left/right to steer, forward to speed up, back to brake and roll backwards. It handles the iOS motion permission prompt, calibrates to your natural holding position, and smooths the sensor signal.
- **Fallback controls.** If the sensors are missing or the permission is refused, touch control turns on automatically (a floating joystick where you put your finger). On desktop you can use the arrow keys, WASD, ZQSD or drag with the mouse.
- **Endless procedural track** that gets harder with distance:
  - straights, big curves, zigzags, hairpins and narrow passages
  - banked platforms, holes, gaps with jumps, boosters, posts and moving sliders
  - checkpoints every 250 m and coins to collect
  - The generator always leaves a safe line, so no section is impossible.
- **Two game modes:**
  - **Random**: one endless track to explore. After a fall, the next run (and the menu scene) starts again just before the spot where you fell, so you can go further each time. The track and the restart point are saved on the device. **↻ New track** on the menu starts a fresh track from 0 m.
  - **Daily run**: everyone gets the same track on the same day, and every run starts from the beginning. The seed comes from the UTC date, and the daily best is saved separately. The link `?mode=daily` opens the daily run directly.
- **Star power.** Coins fill a gauge at the bottom of the screen. Coins taken in a row raise the coin multiplier (×2 after 4, ×3 after 8, ×4 after 12), so the gauge fills faster; missing a single coin resets it. When the gauge is full, flick the phone up quickly (or double-tap, press Space, or tap the gauge): glowing side rails appear, the ball lights up, the music speeds up and the score is doubled. The gauge then drains in about 6 seconds and the rails go away.
- **Kid mode (side rails).** A menu toggle adds small glowing rails along both edges of the track, so the ball bounces back instead of falling off the side. A hit that is too hard still jumps the rail, and holes and gaps still count. Kid-mode runs keep their own best scores, and the game over screen, the share text and the share video all say "with side rails".
- **Five worlds** that change every 500 m of track and blend smoothly into each other:
  - **Tech** (0–500 m): towers with lit windows, beacons, a glowing grid below
  - **Landscape** (500–1000 m): sunset, floating rock islands, mountains, a sea of clouds
  - **Neon** (1000–1500 m): synthwave sun, neon grid, neon rings to roll through
  - **Abstract** (1500–2000 m): floating pastel primitives
  - **Chaos** (2000 m and beyond): red storm, lava cracks, spinning shards, lightning
- **Parallax depth.** Objects in the foreground pass close to the track, structures sit in the midground, and slow-moving giant objects, the sky and a floor far below form the background. Fog, dust, light shafts and speed lines add to the sense of speed.
- **Real rolling physics:** acceleration, inertia, friction, gravity on slopes and banks, rail bounces, jumps and falls. There is no hard speed limit: the push gets weaker as you go faster, but it never stops.
- **Premium effects:**
  - a reflective marble with dynamic highlights and a contact shadow
  - a speed trail and particles
  - bloom, radial speed blur and chromatic aberration when boosting
  - slow motion when you fall
- **4 track skins and 5 marble skins** (chrome, glass, gold, plasma, candy). You can change them from the menu or the pause screen.
- **Sound.** Every sound is synthesized with the Web Audio API, including the rolling sound, impacts, coins, checkpoints, boosts, falls, thunder and generative ambient music. Music and sound effects have separate toggles and volume sliders.
- **Share my score.** During the run the game records a light timelapse. When you press **Share my score** at game over, it builds a short accelerated video (intro, run, fall, score card) with `MediaRecorder`; press **Share the video** when it is ready. On phones it is shared through the Web Share API; elsewhere it is downloaded. If video is not supported, a score-card image is used instead.
- **English and French**, detected from the browser language. You can switch on the menu.
- **Look around on the menu.** When motion access is on (Android at once, iPhone after you allowed it once), turning the phone walks the camera around the ball and tilting it raises or lowers the camera.
- **Built for phones:**
  - portrait first, landscape supported
  - no scrolling or zooming, large touch targets, readable in sunlight
  - screen stays awake while playing, pauses on focus loss
- **Adaptive quality.** Resolution, bloom, particles and scenery density adjust automatically to hold the frame rate. Repeated scenery is drawn with GPU instancing: about 35 draw calls per frame instead of about 105.
- **Installable app (PWA).** Add GYROLL to your home screen. It then opens full screen, locked in portrait so the screen does not rotate while you tilt, and it works offline.
- **Nice link previews.** Shared links show a preview image and a description.

## Screenshots

| Menu | Tech | Landscape |
|---|---|---|
| ![Menu](docs/menu.jpg) | ![Tech world](docs/world-tech.jpg) | ![Landscape world](docs/world-landscape.jpg) |

| Neon | Abstract | Chaos |
|---|---|---|
| ![Neon world](docs/world-neon.jpg) | ![Abstract world](docs/world-abstract.jpg) | ![Chaos world](docs/world-chaos.jpg) |

## Controls

| Input | Action |
|---|---|
| Tilt phone left / right | Steer |
| Tilt phone forward / back | Accelerate / brake and roll backwards |
| Touch and drag (fallback) | Virtual joystick |
| Arrows · WASD · ZQSD | Keyboard control (desktop) |
| Mouse drag | Joystick (desktop) |
| Quick tilt up · double-tap · `Space` · tap the gauge | Start star power (when the gauge is full) |
| `P` / `Esc` | Pause / resume |
| `Space` / `Enter` | Start / play again |

## Scoring

- **Distance** is the furthest point you have reached in this run (meters), counted from where the run started.
- **Score:** each meter is worth 10 points × a speed multiplier. The multiplier is ×2 above ~29 km/h, ×3 above ~43 km/h, ×4 above ~72 km/h or while boosting, and ×5 above ~108 km/h.
- **Coin:** 250 × the coin multiplier. **Checkpoint:** +1000.
- **Star power** doubles every point while it lasts.
- The track collapses behind you, so you can't stand still forever.

## Run it locally

- **Quick:** open `index.html` in a recent Chrome, Edge, Firefox or Safari on your computer.
- **With a local server** (needed for the installable app and offline mode):

  ```sh
  npm run serve        # http://127.0.0.1:4173/ (no install needed, Node 20+)
  ```

- **On a phone:** motion sensors only work on **HTTPS** pages, so use a hosted copy (see below). On plain HTTP the game still works, but falls back to touch control.

## Development

```
src/shell.html        page markup + CSS (the <head> and screens)
src/js/01-core.js     math, i18n, themes, world zones, daily seed, analytics
src/js/02-track.js    track storage + procedural generator
src/js/03-shaders.js  all GLSL shaders
src/js/04-…11-*.js    geometry, renderer, physics & camera, input & audio,
                      particles & environment, UI, replay/share, game loop
scripts/build.mjs     src/ → index.html (and --check for CI)
scripts/serve.mjs     tiny static server
tests/                Playwright browser tests
sw.js, manifest.webmanifest, icons/, og.jpg   installable app + link preview
```

The files in `src/js/` are joined, in name order, into one classic `<script>`. Their top-level names are therefore shared between files.

```sh
npm install          # dev tools only: ESLint + Playwright (the game has no dependencies)
npm run build        # rebuild index.html after editing src/
npm run lint
npm test             # headless Chromium, software WebGL (first time: npx playwright install chromium)
npm run ci           # check + lint + test, same as GitHub Actions
```

Always commit `src/` **and** the rebuilt `index.html`; CI fails if they differ.

The tests drive the game loop step by step instead of waiting for real frames, so they are fast and stable even with software rendering. They cover:
- booting and a full keyboard run (play, pause, fall, game over, replay)
- NaN checks over a long run
- track feasibility over 4 km on many seeds
- daily-run determinism
- tilt directions and the touch fallback
- language switching, sound toggles and skins
- the share link and the share video
- all five worlds rendering
- the installable app, including offline play
- kid mode, safety rails that give way to hard hits, and speed past 50 km/h
- coins, streak multiplier, star gauge, the tilt-up flick and star power
- scenery staying out of the track corridor, including giant objects that drift onto it
- random mode restarting where you fell (and "new track"), daily runs restarting from 0
- the share video only being made on request
- the menu camera following the phone

## Deploy

It is a static site.

- **Vercel** (production: <https://gyroll.vercel.app/>): import the repository. `vercel.json` already sets the build (`node scripts/build.mjs`, nothing to install), the output folder (the repository root) and cache headers for the service worker. To get statistics, enable **Web Analytics** in the Vercel project settings.
- **GitHub Pages**: Settings → Pages → deploy from the `main` branch, root folder. The built `index.html` is committed, so no build step runs there.

If you fork the project, change the `PROD_URL` constant in `src/js/01-core.js`. It is the link used in shared scores, on the video end card and for analytics, and it also appears in the `og:` tags of `src/shell.html`.

## Privacy

- **No cookies, no accounts.** Best scores and settings stay in the browser (`localStorage`).
- **Anonymous statistics, official site only.** On `gyroll.vercel.app`, and only when "Do Not Track" is off, the game loads Vercel Web Analytics. It counts page views and sends a few anonymous game events:
  - `run_start`: game mode and control type
  - `game_over`: mode, world reached, distance rounded to 50 m
  - `share`: how the score was shared
  - `install`: whether the app was installed
- Local copies, forks and other domains send nothing.

## How it works

The game code lives in `src/js/` and is built into `index.html`. It is split into small classes:

| Part | Role |
|---|---|
| `TrackGenerator` | Seeded procedural sections (curves, zigzags, holes, gaps, obstacles…) with a difficulty ramp. The generated values are rate-limited so the geometry stays smooth, and a heading guard makes sure the track never loops back on itself. |
| `Track` | Ring buffer of centerline samples and per-row solid intervals. Handles point-to-track projection and support tests. |
| `TrackMesher` | Builds GPU meshes in 32 m chunks: deck, rims, rails, underside beams, hangers. |
| `Renderer` + GLSL shaders | WebGL1 forward renderer. The shaders handle procedural materials, zone-blended sky panoramas, the floor layer, point-sprite particles and additive FX, followed by a bloom/composite post chain. |
| `Physics`, `Ball` | Fixed 120 Hz steps for a sphere rolling without slipping: slope and bank gravity, rails, props, landing and falling. |
| `CameraRig` | Chase camera with look-ahead, roll in turns, speed FOV, shake, fall and attract modes. |
| `InputManager` | DeviceOrientation (with the iOS permission), calibration, low-pass filtering, joystick and keyboard. |
| `AudioManager` | Web Audio synthesis and a generative music scheduler, with separate music and SFX buses. |
| `ParticleSystem`, `FxBuilder` | Pooled particles, trail ribbon, glows, light shafts, speed lines and lightning. |
| `Environment` | Zone-driven scenery in three parallax layers. Nothing may enter a keep-out zone around the track; objects that newer track bends towards shrink away, and anything between the camera and the ball is hidden. |
| `Replay` | Timelapse capture and share-video composition. |
| `QualityManager`, `UI`, `Game` | Adaptive quality, DOM overlay with FR/EN strings, and the state machine / main loop. |
| `Analytics`, `sw.js` | Opt-out-friendly stats on the official site, and the offline cache for the installable app. |

## Browser support and known limitations

- **WebGL** is required. It works on recent Chrome, Safari (iOS 15+), Edge and Firefox.
- **Motion sensors:**
  - They need HTTPS.
  - iOS asks for permission when you tap "Play with gyroscope".
  - Android Chrome gives access directly.
- **Sound on iPhone.** The silent switch mutes Web Audio.
- **Share video:**
  - The format depends on the browser: MP4 (H.264) where supported, otherwise WebM.
  - Sharing a file needs Web Share support with files, which mostly means mobile browsers. Otherwise the file is downloaded.
- **Not yet verified on real devices:**
  - Landscape tilt directions have not been checked on a real phone. Portrait tilt was checked with simulated sensor events.
  - Development and automated tests ran in headless Chromium (software rendering). Reports from real phones are very welcome.
- **Analytics events.** Page views work whenever Web Analytics is on. Custom events (`run_start`, `game_over`…) may need a Vercel plan that supports them; if not, they are simply ignored.

## Contributing

Issues and pull requests are welcome, see [CONTRIBUTING.md](CONTRIBUTING.md). The game must stay a **single dependency-free HTML file**. Please test on a real phone when you touch controls, performance or sharing.

## Credits

Created by [Erwann Robin](https://github.com/ErwannRobin). The code was written with [Claude Code](https://claude.com/claude-code) from the prompts below.

## License

[MIT](LICENSE)

---

## Prompt history

The game was generated from these prompts. They are kept verbatim; the first prompt is in French.

<details>
<summary><strong>Original prompt</strong> (in French)</summary>

````markdown
Crée un jeu vidéo HTML5 complet et extrêmement soigné dans **un seul fichier `index.html`**.

## Concept

Le joueur contrôle une **bille** qui roule sur une **longue planche étroite en 3D**, suspendue dans le vide.

La planche contient un **chemin sinueux en virages et zigzag**, avec des virages de plus en plus difficiles. Le chemin avance continuellement vers l’avant et est généré/prolongé au fur et à mesure : le jeu est donc **endless**.

Objectif : **aller le plus loin possible sans tomber**.

Le score augmente continuellement avec la distance parcourue. Afficher :

* distance
* score
* meilleur score
* vitesse actuelle

Le joueur doit avoir immédiatement la sensation d'un **jeu arcade mobile premium**, pas d'une simple démo technique.

## CONTRAINTE ABSOLUE : UN SEUL HTML

Tout doit être contenu dans **un unique fichier HTML** :

* HTML
* CSS
* JavaScript
* shaders éventuels
* effets visuels
* sons générés par Web Audio API

**Aucune librairie externe.**
Pas de Three.js.
Pas de Babylon.js.
Pas de Cannon.js.
Pas de CDN.
Pas de fichiers externes.
Pas d'images externes.
Pas de polices externes.

Le fichier doit pouvoir être sauvegardé puis ouvert directement dans un navigateur moderne.

## Contrôle mobile

Le contrôle principal doit utiliser **l'accéléromètre / gyroscope du téléphone**.

Sur mobile :

* incliner le téléphone vers la gauche → la bille se déplace vers la gauche
* incliner vers la droite → la bille se déplace vers la droite
* Incliner vers l’avant → la bille se déplace vers l’avant
* Incliner vers l’arrière → la bille ralentit puis se déplace vers l’arrière 
* l'orientation doit être filtrée/lissée pour éviter les mouvements brusques
* prévoir une calibration initiale afin que la position naturelle du téléphone corresponde au centre

IMPORTANT :
Sur iOS, gérer correctement la permission `DeviceOrientationEvent.requestPermission()` lorsqu'elle est nécessaire.
Afficher un bouton clair :
**« ACTIVER LE CONTRÔLE PAR INCLINAISON »**

Si les capteurs ne sont pas disponibles ou refusés :

* proposer automatiquement un contrôle tactile de secours
* le jeu doit rester parfaitement jouable

Sur desktop :

* WASD / flèches
* éventuellement souris ou trackpad comme contrôle secondaire.

## Gameplay

La bille doit avoir une vraie sensation de poids et d'inertie.

Implémenter une physique suffisamment crédible :

* accélération
* friction
* inertie
* gravité
* vitesse maximale
* collisions avec les bords du chemin
* chute lorsque la bille quitte la planche

Le joueur ne doit pas simplement déplacer directement la bille avec une coordonnée X.

La bille doit réellement sembler rouler.

### Génération du parcours

Créer un parcours endless procédural.

Le chemin doit :

* être étroit
* zigzaguer
* avoir des virages doux et des virages serrés
* varier sa largeur
* introduire progressivement davantage de difficulté
* contenir occasionnellement des sections spéciales

Exemples de sections :

* ligne droite rapide
* grand virage
* succession de petits zigzags
* passage étroit
* plateforme légèrement inclinée
* trous / zones dangereuses
* plateformes discontinues
* obstacles simples
* accélérateurs

La difficulté doit augmenter progressivement avec la distance.

Éviter que la génération produise des situations impossibles.

## Direction artistique

Je veux quelque chose de **visuellement extraordinaire**.

Pas un simple canvas avec des rectangles.

Direction artistique :
**arcade futuriste premium + jouet physique + environnement spectaculaire.**

Imagine un mélange entre :

* un jouet miniature extrêmement détaillé
* une piste suspendue dans un immense espace
* une esthétique arcade moderne
* des matériaux réalistes
* des effets lumineux élégants

La planche doit être très travaillée :

* matériau détaillé
* bords visibles
* dessous de la plateforme
* petites pièces mécaniques
* rivets
* bandes lumineuses
* texture subtile
* variations de matériaux

La bille doit être magnifique :

* matériau métallique/verre
* réflexions simulées
* highlight dynamique
* ombre portée
* légère traînée lumineuse à grande vitesse

Potentiellement on peut choisir plusieurs textures pour la planche et la bille. 

L'environnement autour de la planche doit donner une vraie impression de profondeur :

* immense vide
* brume
* particules
* étoiles ou architecture abstraite
* lumière volumétrique simulée
* éléments qui défilent à différentes vitesses

## Rendu

Puisqu'aucune librairie 3D externe n'est autorisée, construis toi-même un moteur de rendu suffisamment convaincant avec **Canvas 2D**, éventuellement avec WebGL natif si tu estimes que cela apporte une amélioration majeure.

Tu peux utiliser :

* Canvas 2D
* WebGL natif
* Web Audio API
* DeviceOrientation API
* requestAnimationFrame
* Pointer Events
* CSS avancé

Si WebGL est utilisé, écris directement les shaders GLSL dans le fichier HTML.

Priorité :
**60 FPS sur téléphone moderne.**

Prévoir une adaptation automatique :

* résolution
* pixel ratio
* nombre de particules
* qualité des ombres
* effets post-processing

afin de maintenir de bonnes performances.

## Caméra

Caméra troisième personne légèrement au-dessus et derrière la bille.

Elle doit suivre la bille avec :

* interpolation fluide
* léger retard cinématique
* anticipation dans la direction du déplacement
* léger mouvement de caméra avec la vitesse

Lors des gros virages, la caméra doit donner une sensation spectaculaire de mouvement.

## Effets

Ajouter de nombreux petits détails qui donnent une sensation premium :

* particules lors des collisions
* particules lorsque la bille accélère
* poussière/étincelles très légères
* traînée lumineuse
* motion blur simulé si performant
* vignette
* légère profondeur atmosphérique
* flash subtil lors d'un événement important
* effets de particules lors de la chute
* caméra dynamique

Ne pas surcharger l'écran.

L'ensemble doit rester élégant.

## Sons

Créer **tous les sons avec Web Audio API**, sans fichiers audio externes.

Créer au minimum :

* son de roulement de la bille
* petites variations sonores selon la vitesse
* son lors d'une collision avec le bord
* son lorsqu'un bonus est récupéré
* son lors du passage d'un checkpoint
* son lors d'une accélération
* son de chute
* son de game over
* musique d'ambiance générative minimaliste

La musique doit être générée procéduralement et rester agréable en boucle.

IMPORTANT :
les navigateurs bloquent généralement l'audio avant une interaction utilisateur. Initialiser l'AudioContext après le premier clic/tap.

Ajouter un bouton :
🔊 / 🔇

Prévoir une gestion propre du volume.

## Interface

L'interface doit être minimaliste et magnifique.

En haut :
**SCORE**
`12 840`

**DISTANCE**
`284 m`

**BEST**
`1 920 m`

Afficher éventuellement la vitesse de façon discrète.

Au démarrage :
un écran élégant avec :

**ROLL**

*How far can you go?*

Puis :

**ACTIVER LE CONTRÔLE PAR INCLINAISON**

et une petite indication :
**Inclinez votre téléphone pour contrôler la bille**

Après la calibration, lancer immédiatement le jeu.

## Game Over

Lorsque la bille tombe :

ralentir brièvement le temps,
faire tomber la caméra avec elle,
ajouter des particules,
jouer le son de chute,
puis afficher :

**GAME OVER**

`1 284 m`

`SCORE 48 920`

`BEST 2 041 m`

Bouton :

**REJOUER**

Si le score est un record :

**NOUVEAU RECORD**

avec une animation spectaculaire mais courte.

## UX mobile

Le jeu doit être pensé d'abord pour un écran de smartphone en portrait.

* aucun scroll
* aucun élément minuscule
* boutons facilement utilisables au doigt
* interface lisible en plein soleil
* aucune dépendance à un hover
* gestion correcte du changement d'orientation
* empêcher les gestes tactiles accidentels pendant le jeu lorsque nécessaire

Prévoir aussi un mode paysage si pertinent.

## Architecture du code

Même si tout est dans un seul HTML, organiser proprement le JavaScript en modules/classes logiques :

* Game
* Renderer
* Physics
* TrackGenerator
* Ball
* Camera
* InputManager
* AudioManager
* ParticleSystem
* UI

Ne pas écrire un énorme bloc de code spaghetti.

Ajouter des commentaires uniquement là où ils sont réellement utiles.

## Robustesse

Le jeu doit :

* fonctionner sans serveur si possible
* fonctionner sur Chrome/Safari modernes
* fonctionner sur iPhone et Android
* gérer l'absence de DeviceOrientation
* gérer le refus de permission
* gérer la perte de focus
* mettre le jeu en pause si nécessaire
* reprendre proprement
* éviter les fuites mémoire
* limiter le nombre de particules
* ne jamais produire de NaN ou d'objets invalides
* ne jamais générer un parcours impossible

## Très important

Ne me donne pas une simple maquette.

Je veux **un jeu réellement jouable et fini**.

Avant de terminer, vérifie mentalement :

1. que le fichier est autonome ;
2. qu'il ne dépend d'aucune ressource externe ;
3. que le contrôle gyroscopique fonctionne sur mobile ;
4. que la permission iOS est correctement demandée ;
5. qu'un fallback tactile existe ;
6. que le parcours est réellement endless ;
7. que le score augmente avec la distance ;
8. que la bille peut réellement tomber ;
9. que le bouton Rejouer fonctionne ;
10. que les sons sont générés sans fichiers externes ;
11. que le jeu reste performant sur mobile.

**Donne-moi directement le contenu complet du fichier `index.html`, prêt à être copié-collé et exécuté.**
````

</details>

<details>
<summary><strong>Follow-up prompt</strong> (worlds, daily run, sharing, i18n)</summary>

````markdown
We should have 2 sound controls on the menu: for the music or for sound fx. And the music toggle should work. It’s not needed in game, but it can stay in the pause menu. 

And we can also add the ball and teach theme in the pause menu too. 

Also, the game should be translated in English, with auto detection of the browser language, or a manual selection on the menu, but not in-game. 

Also the menu first CTa should be “Jouer avec le gyroscope », without a sub title 

And is would be great to have 2 game mode: random or a daily pre-computed game that would be identical for all players the same
Day. 

At the end of a game, we could have a “share my score” button that would include an accelerated video of the game itself

And could we render a more stunning environment? 

brume
particules
étoiles
structures abstraites
éléments en arrière-plan
éléments passant lentement
profondeur atmosphérique

Ajouter un parallaxe entre :

foreground

midground

background.

Cela doit donner une vraie sensation de vitesse.

À mesure que le joueur avance, le monde évolue.

Par exemple :

0–500 m :

TECH

500–1000 m :

Landscape

1000–1500 m :

NEON

1500–2000 m :

ABSTRACT

2000 m+ :

CHAOS

Ne pas nécessairement afficher ces noms.

Ils servent de thèmes visuels.


Ha and the game name is “gyroll”
````

</details>

<details>
<summary><strong>Later prompts</strong> (open-source release)</summary>

````markdown
Yes please switch to main and create the readme with all relevant information to then open source the repo. Also include the original prompt. And please fix the link to the prod url
````

````markdown
What else can we improve ?
````

````markdown
Let’s apply : 
* Sharing and growth
* Open-source quality
````

</details>

<details>
<summary><strong>Gameplay prompts</strong> (kid mode, speed, star power)</summary>

````markdown
Let’s do a kid mode with small lateral side rails, that allow for some lateral mistakes. It should be clear in the success screen that it was achieved with side rail on if relevant
````

````markdown
The kid mode should not block all errors. The ball should still be able to fail if the hit to side rails is too high. Also, the mode made me realized that the max speed is limited to 50km/h. When tilting the phone heavily, we should keep accelerating up to very high speed. Let’s slow down the acceleration with speed but not block it. And I noticed a few collisions with surrounding objects. I was entering the object and could see the road anymore. Also, let’s use the new kid mode for a special game bonus : collecting coins fills a power bar gauge to trigger a star power mode, like in guitar hero. When ready, the player would need to tilt its phone up very quickly and the side rails would be activated. The ball become enlightened and the music speed up. The power bar would then drain quickly and remove the side rails. Collecting all coins increase their multipliers, which trigger the star power mode quicker. Missing 1 coin reset the multiplier
````

</details>

<details>
<summary><strong>Exploration prompt</strong></summary>

````markdown
The star power should be called as is in all
Languages. 

And I still had collisions with an object from the decors. It totallly hid the road for a while. It should not occur. 

Nb: the final video generation should not start automatically but be triggered by the button instead. 

Also, on the menu screen, if the gyroscope is activated, it should control the camera to be able to see around. 

And the scene should be where we last lost. And we should continue with the same “scene” for the next game in random so that we can explore further more easily. 

Of course daily challenge start over every time.
````

</details>
