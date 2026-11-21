# DEAD CENTER

**A collection of impossible little shots.** One ball. One shot. One target.

A browser precision puzzle from [HaveAnApp](https://haveanapp.com). Twelve handcrafted miniature tabletop arenas in walnut, ivory ceramic and brass. Pull back, let go, and watch: once the steel ball leaves, you can't touch it. It drops into the pocket or it doesn't.

## Play

Pull back from anywhere on the screen and let go. Pull length is power; the brass beads show direction. Move slowly to fine-tune the angle. After a miss, a faint graphite trace shows where the last shot went.

Keyboard: arrows aim (Shift for fine steps), Space launches, R resets, G toggles the previous-shot trace, M sound, C the Collection.

## Downhill (prototype)

`/downhill/` is a separate, playable prototype of a possible evolution: a third-person, hands-off downhill longboard run. **You choose the line. Gravity tells the story.** Drag left or right to set where the rider starts, press **Launch**, and watch. There is no steering after launch.

It is isolated from the puzzles: its own page (`downhill/index.html`) and code (`src/downhill/`), sharing only Three.js, the design tokens and the Pulse helper. The puzzle game at `/` is unchanged.

- `course.ts`: one handcrafted hill (Gravity Hill) as data plus a height function: three lanes, the Table (long ramp) over a gap, the Kicker (short steep ramp) over a boulder row, a banked turf wall, a tyre wall, pines, rocks and the finish gate.
- `sim.ts`: deterministic 240 Hz rider physics, computed in full at launch. The board rolls along its heading and side-slope gravity turns it (a carve) instead of sliding it, so it doesn't behave like a marble; lips launch it, landings are absorbed or crash.
- `rider.ts`, `world.ts`, `main.ts`: the procedurally posed rider, the diorama on a walnut plinth, the course preview, the chase camera, the crash tumble and the UI.

```sh
npx tsx tools/downhill-sweep.ts 0.1   # what happens from every start line
node e2e/downhill.mjs http://localhost:4173
```

## Develop

```sh
npm install
npm run dev        # local server
npm run check      # typecheck, unit tests, production build
npm run solve      # verify every stored solution and print its tolerance window
npm run solve -- the-elbow            # search one level for sinking shots
npm run solve -- the-elbow 46 0.77    # describe one shot (contacts, events, outcome)
npm run e2e -- http://localhost:4173  # play every piece in Chromium (desktop + emulated iPhones); needs `npm run preview`
```

## How it is built

| Area | Where | Notes |
|---|---|---|
| Physics | `src/physics/` | Custom deterministic 2D solver at a fixed 240 Hz. Circle vs oriented box, circle and capsule, closest-feature contacts (corners act as points), material restitution and grip, rolling resistance, pocket pull and capture. Steps are far smaller than any wall, so nothing tunnels. |
| Shots | `src/physics/sim.ts` | The whole shot is simulated at release and played back, so frame rate, backgrounding or a slow device never change an outcome. |
| Levels | `src/levels/` | Pure data (`collection.ts`), validation, solution search and tolerance measurement (`validate.ts`). |
| Rendering | `src/render/` | Three.js, orthographic tilted camera, procedural walnut and brushed brass textures, room-environment reflections, soft shadows. Handles resize, orientation and WebGL context loss. |
| Input | `src/game/aim.ts` | Drag-back aiming with screen-to-board projection and a "steady hand" fine adjustment for slow movement. |
| Audio | `src/audio/sound.ts` | Web Audio modal synthesis per material, rolling texture, the pocket clunk. No audio files. Vibration only where the browser supports it. |
| Progress | `src/game/save.ts` | Versioned localStorage save with migration. First completions are kept separate from practice bests. |
| Modes | `src/modes/workbench.ts` | Foundation for the daily Workbench (selection by date and records). The Range (endless) would generate levels and accept only those `validate.ts` can solve. |
| Analytics | `src/analytics/pulse.ts` | HaveAnApp Pulse (`data-app="dead-center"`): page views plus `game_start`, `shot_launch`, `game_complete`. No coordinates or personal data. |

Every level's stored solution is replayed by `tests/levels.test.ts`, which also requires at least ±0.3° and ±2% power of tolerance around it, so a physics change that breaks a puzzle fails the build.

Made by HaveAnApp.
