# Throwables

Walk-only toys (spike): toss a sliotar and swing the hurl through it, or throw a boomerang that loops back. `terrain-walk.ts` drives them through the `WalkToy` interface; `terrain-3d.ts` creates them. State is ephemeral and never reaches links or exports.

A short tap (under ~150 ms) with the sliotar held rolls the hurl bas-up and rests the ball on it; tap again to return it to the off hand. A hold-release from there hops the ball off the bas into the usual toss → swing.

| File            | Owns                                                                               |
| --------------- | ---------------------------------------------------------------------------------- |
| `throwables.ts` | The controller: input stages (toss → swing, boomerang), per-frame order, look lift |
| `physics.ts`    | Projectile types, launches, and stepping (bounce, roll, boomerang loop)            |
| `swing.ts`      | The hurl's swing arc, swept bas–ball contact, and strike aim                       |
| `toss-view.ts`  | How far the look lifts to keep a tossed ball in view                               |
| `models.ts`     | Meshes: the held viewmodel (loads `public/models/hurl.glb`) and the thrown mesh    |
| `hurl-slap.ts`  | The strike sound, respecting the studio mute                                       |

## Key decisions

- **Everything is sized in eye heights** (`getWalkScale`), so the toys feel the same on any map.
- **Real contact, not proximity.** The bas is a flat face posed by the swing; a strike needs the ball's path to cross it between frames, within the bas's radius. Timing skews the face, so early and late swings pull the shot.
- **The viewmodel isn't parented to the camera** (the camera isn't in the scene); it copies the camera pose each frame and trails the look slightly.

## Gotchas

- `step()` order matters: physics, then look lift, then pose, then contact, so the bas is tested where it's drawn.
- Physics and swing maths are pure and unit-tested; the controller needs pointer lock, so verify it by hand (or fake `document.pointerLockElement` in Playwright).
