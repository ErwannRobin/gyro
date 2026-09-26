# GYROLL

**How far can you go?**

GYROLL is an endless 3D marble game for your phone. Tilt the phone to roll a heavy glass or metal marble along a narrow track floating in the void. The track twists, narrows, has holes, gaps and obstacles, and it slowly falls apart behind you. Don't fall off.

**▶ Play: [gyroll.vercel.app](https://gyroll.vercel.app/)** (best on a phone)

![The five worlds of GYROLL](docs/worlds.jpg)

The whole game is **one self-contained `index.html` file** (about 230 KB): HTML, CSS, JavaScript, GLSL shaders and synthesized audio. It uses no libraries, no build step, no network requests and no external assets.

---

## Features

- **Gyroscope control.** Tilt left/right to steer, forward to speed up, back to brake and roll backwards. It handles the iOS motion permission prompt, calibrates to your natural holding position, and smooths the sensor signal.
- **Fallback controls.** If the sensors are missing or the permission is refused, touch control turns on automatically (a floating joystick where you put your finger). On desktop you can use the arrow keys, WASD, ZQSD or drag with the mouse.
- **Endless procedural track** that gets harder with distance:
  - straights, big curves, zigzags, hairpins and narrow passages
  - banked platforms, holes, gaps with jumps, boosters, posts and moving sliders
  - checkpoints every 250 m and gems to collect
  - The generator always leaves a safe line, so no section is impossible.
- **Two game modes:**
  - **Random**: a new track every run.
  - **Daily run**: everyone gets the same track on the same day. The seed comes from the UTC date, and the daily best is saved separately. The link `?mode=daily` opens the daily run directly.
- **Five worlds** that change every 500 m and blend smoothly into each other:
  - **Tech** (0–500 m): towers with lit windows, beacons, a glowing grid below
  - **Landscape** (500–1000 m): sunset, floating rock islands, mountains, a sea of clouds
  - **Neon** (1000–1500 m): synthwave sun, neon grid, neon rings to roll through
  - **Abstract** (1500–2000 m): floating pastel primitives
  - **Chaos** (2000 m and beyond): red storm, lava cracks, spinning shards, lightning
- **Parallax depth.** Objects in the foreground pass close to the track, structures sit in the midground, and slow-moving giant objects, the sky and a floor far below form the background. Fog, dust, light shafts and speed lines add to the sense of speed.
- **Real rolling physics:** acceleration, inertia, friction, gravity on slopes and banks, top speed, rail bounces, jumps and falls.
- **Premium effects:**
  - a reflective marble with dynamic highlights and a contact shadow
  - a speed trail and particles
  - bloom, radial speed blur and chromatic aberration when boosting
  - slow motion when you fall
- **4 track skins and 5 marble skins** (chrome, glass, gold, plasma, candy). You can change them from the menu or the pause screen.
- **Sound.** Every sound is synthesized with the Web Audio API, including the rolling sound, impacts, gems, checkpoints, boosts, falls, thunder and generative ambient music. Music and sound effects have separate toggles and volume sliders.
- **Share my score.** During the run the game records a light timelapse. At game over it builds a short accelerated video (intro, run, fall, score card) with `MediaRecorder`. On phones it is shared through the Web Share API; elsewhere it is downloaded. If video is not supported, a score-card image is used instead.
- **English and French**, detected from the browser language. You can switch on the menu.
- **Built for phones:**
  - portrait first, landscape supported
  - no scrolling or zooming, large touch targets, readable in sunlight
  - screen stays awake while playing, pauses on focus loss
- **Adaptive quality.** Resolution, bloom, particles and scenery density adjust automatically to hold the frame rate.

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
| `P` / `Esc` | Pause / resume |
| `Space` / `Enter` | Start / play again |

## Scoring

- **Distance** is the furthest point you have reached (meters).
- **Score:** each meter is worth 10 points × a speed multiplier. The multiplier is ×2 above ~29 km/h, ×3 above ~43 km/h and ×4 while boosting.
- **Gem:** +250. **Checkpoint:** +1000.
- The track collapses behind you, so you can't stand still forever.

## Run it locally

Desktop: just open `index.html` in a recent Chrome, Edge, Firefox or Safari.

Phone: motion sensors only work on **HTTPS** pages, so you need a hosted copy (see below). On plain HTTP the game still works, but falls back to touch control.

To serve the folder locally:

```sh
npx serve .
# or
python3 -m http.server 8080
```

## Deploy

It is a static site with no build step.

- **Vercel** (production: <https://gyroll.vercel.app/>): import the repository, choose the "Other" framework preset, and leave the build command empty. The output directory is the repository root.
- **GitHub Pages**: Settings → Pages → deploy from the `main` branch, root folder.

If you fork the project, change the `PROD_URL` constant near the top of the script in `index.html`. It is the link used in shared scores and on the video end card.

## How it works

Everything lives in `index.html`. The script is split into small classes:

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
| `Environment` | Zone-driven scenery in three parallax layers. |
| `Replay` | Timelapse capture and share-video composition. |
| `QualityManager`, `UI`, `Game` | Adaptive quality, DOM overlay with FR/EN strings, and the state machine / main loop. |

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

## Contributing

Issues and pull requests are welcome. Please keep the project a **single dependency-free HTML file**. Test on a real phone when you touch controls, performance or sharing.

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
