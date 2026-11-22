# DEAD CENTER

**A collection of impossible little shots.** One ball. One shot. One target.

A browser precision puzzle from [HaveAnApp](https://haveanapp.com). Thirty-six handcrafted miniature tabletop arenas, in twelve collections of three, each made in its own timber, in walnut, ivory ceramic and brass. Pull back, let go, and watch: once the steel ball leaves, you can't touch it. It drops into the pocket or it doesn't.

## Play

Pull back from anywhere on the screen and let go. Pull length is power; the brass beads show direction. Move slowly to fine-tune the angle. After a miss, a faint graphite trace shows where the last shot went.

Keyboard: arrows aim (Shift for fine steps), Space launches, R resets, G toggles the previous-shot trace, M sound, C the Collection.

## Beyond the Collection

- **The Workbench**: a fresh board every day, the same for everyone. Your first run is your score; the week builds from a gentle Monday to a demanding Sunday, and the Collection shows your streak. Boards are generated ahead of time (`npm run workbench`) and every one is verified by the solver.
- **Mastery**: each piece has two marks beyond solving it: *aced* (sunk on a first attempt) and *dead center* (dropped through the middle of the pocket, within a quarter of its radius). Every piece has a verified dead-center shot (`tests/fixtures/dead-center.json`).
- **Shared shots**: after a sink, Share sends a link with the board and the exact shot (`?piece=the-elbow&shot=46,0.7`). Whoever opens it can watch the shot played back (nothing is recorded) or play it themselves.
- **Felt and slopes**: baize inlays take the pace off a ball; sloped marquetry panels bend a slow one downhill.

## Develop

```sh
npm install
npm run dev        # local server
npm run check      # typecheck, unit tests, production build
npm run solve      # verify every stored solution and print its tolerance window
npm run solve -- the-elbow            # search one level for sinking shots
npm run solve -- the-elbow 46 0.77    # describe one shot (contacts, events, outcome)
npm run dead-center -- the-ring       # find and store a dead-center shot for a piece
npm run workbench -- 365              # regenerate the daily boards (deterministic per day)
npm run e2e -- http://localhost:4173  # play every piece in Chromium (desktop + emulated iPhones); needs `npm run preview`
```

## How it is built

| Area | Where | Notes |
|---|---|---|
| Physics | `src/physics/` | Custom deterministic 2D solver at a fixed 240 Hz. Felt panels add rolling drag; slope panels add a downhill pull (a ball only rests on a slope against something). Circle vs oriented box, circle and capsule, closest-feature contacts (corners act as points), material restitution and grip, rolling resistance, pocket pull and capture. Steps are far smaller than any wall, so nothing tunnels. |
| Shots | `src/physics/sim.ts` | The whole shot is simulated at release and played back, so frame rate, backgrounding or a slow device never change an outcome. |
| Levels | `src/levels/` | Pure data (`collection.ts`), validation, solution search and tolerance measurement (`validate.ts`). |
| Rendering | `src/render/` | Three.js, orthographic tilted camera. Every collection has its own lacquered timber (`finishes.ts`) with inlaid stringing and brass corner caps; procedural grain, baize, slope marquetry and brushed brass (no image files); reflections from a small warm workshop (window, skylight, bench lamp); soft cast and contact shadows; a brass burst when a ball drops (not with reduced motion). Handles resize, orientation and WebGL context loss. |
| Input | `src/game/aim.ts` | Drag-back aiming with screen-to-board projection and a "steady hand" fine adjustment for slow movement. |
| Audio | `src/audio/sound.ts` | Web Audio modal synthesis per material, rolling texture, the pocket clunk. No audio files. Vibration only where the browser supports it. |
| Progress | `src/game/save.ts` | Versioned localStorage save with migration. First completions are kept separate from practice bests. |
| Modes | `src/modes/workbench.ts` | Foundation for the daily Workbench (selection by date and records). The Range (endless) would generate levels and accept only those `validate.ts` can solve. |
| Analytics | `src/analytics/pulse.ts` | HaveAnApp Pulse (`data-app="dead-center"`): page views plus `game_start`, `shot_launch`, `game_complete`. No coordinates or personal data. |

Every level's stored solution is replayed by `tests/levels.test.ts`, which also requires at least ±0.3° and ±2% power of tolerance around it, so a physics change that breaks a puzzle fails the build.

Made by HaveAnApp.
