# Candy Snake — Game Design Document

Working title: **Candy Snake** (a.k.a. *The Candy Puller*)

## 1. Pitch

You are an old-fashioned candy maker. Boil sugar, pull it into a long glistening
strand, knead dye into it, then chop the strand into bite-sized candies for the
children lining up at your shop window.

Mechanically: a **snake-like** game crossed with **Overcooked-style order
serving**. The snake *is* the pulled sugar strand. Eating sugar grows it, eating
dye colors it, and driving it into the chopping block converts body segments
into candies that are served to waiting customers.

- **Platforms:** Web (desktop browser + mobile browser), landscape and portrait.
- **Session shape:** Endless arcade run. Difficulty ramps until lives run out;
  final score goes to a local high-score table.
- **Audience:** Casual, all ages. One-hand playable on mobile.

## 2. Theme & fantasy

Traditional candy making, step by step, mapped onto game verbs:

| Real-world step            | Game verb                                      |
| -------------------------- | ---------------------------------------------- |
| Boiling / gathering sugar  | Drawing the strand over **sugar** → grows      |
| Kneading dye into the mass | Drawing it through **dye** → segments tint     |
| Pulling into a thin strand | The snake body itself                          |
| Chopping into candies      | Driving into the **chopping block**            |
| Serving the shop window    | Auto-matching candies to **customer orders**   |

The board is the kitchen floor. The chopping block is a fixed bench along the
top wall, beside the serving window where customers (children) appear.

### Art direction — pastel cotton candy (chosen in Phase 1)

Pixel art in an **8-bit format** — sprites authored at 8×8 source pixels and
scaled up by an integer factor with nearest-neighbour filtering — but styled
as **pale cotton candy** rather than arcade neon: soft pastels, minimal
detail, and a floor of faint diagonal rainbow bands that never competes with
the candy sitting on it.

- Sprites are ASCII pixel maps in `render/textures.ts` — still zero image
  assets, still generated at boot. Textures are baked at 16×16 so the strand
  (below) can sit inset from its cell and still carry the same soft edge; the
  8×8 maps are doubled into that, so they render exactly as authored.
- Detail is deliberately minimal: a flat fill and one soft edge, no interior
  shading. The head adds two dots for eyes and nothing else.
- Sprite pixels are grays because Phaser tinting *multiplies*: white takes the
  full candy color and the gray edge becomes a deeper shade of it. One texture
  therefore serves every color in §4 and stays readable without a hard outline.
- **Comfort is a constraint, not a polish item.** The snake occupies whole
  cells five times a second, but the view slides sprites between them —
  teleporting a high-contrast sprite a whole cell at 5 Hz reads as a strobe
  and is genuinely painful to look at. For the same reason effects stay local
  and soft: a self-hit puffs at the cells that broke, never a screen flash.
- The narrative stays the candy-maker fiction (dye jars, chopping block); the
  look is purely aesthetic and constrains only the generated textures and the
  juice pass (Phase 7).

#### The strand is drawn as one continuous rope (revised after Phase 3)

The body was a chain of identical lozenges, each carrying a soft edge on all
four sides, so every joint between two segments showed a seam — and a seamed
chain of beads reads as a snake game however the mechanics behave. Each cell
now draws a rope piece instead — **straight, elbow, or end cap** — chosen from
where its neighbours sit, and rotated. The soft edge runs along the rope's
flanks only, never across a joint, so the strand is unbroken and a color change
simply runs along it.

Everything else above still holds. The strand keeps the same flat
fill-plus-soft-edge in the same palette — no gloss, no interior shading — and
a piece cut loose is not rope any more, so debris and the shard puff still come
apart as the old lozenges.

**Only the shape was wrong, so only the shape changed.** A literal
confectioner's bench (stone slab, steel cutter, dark workshop), a maker's gloved
hand in place of the head, and a wet-sugar gloss down the rope were all built
for this and thrown away: the pastels are the identity, *Candy Snake* is the
joke, and photo-reference is for how the sugar behaves, never for how the room
is painted.

## 3. Core loop

```
        ┌──────────────────────────────────────────────┐
        │                                              │
        ▼                                              │
  eat sugar (grow) ──► eat dye (tint body) ──► reach chopping block
        ▲                                              │
        │                                   body → candies, one per segment
        │                                              │
        │                                              ▼
        │                              candies auto-match customer orders
        │                                   │                    │
        │                                match: score        no match: shelf
        │                                              │
        └──────────── plan next batch ◄────────────────┘
```

Failure pressure comes from customer patience timers (expired customer = −1
life) and from self-collision destroying carried sugar.

## 4. The color system (RYB, discrete)

Dyes are the three **paint primaries**: Red, Yellow, Blue. A color is simply
*the set of primaries mixed in*, giving exactly 8 states:

| Color      | Primaries in the mix | Tier      | Notes                          |
| ---------- | -------------------- | --------- | ------------------------------ |
| Raw        | (none)               | 1 — easy  | Uncolored sugar, off-white     |
| Red        | R                    | 2         |                                |
| Yellow     | Y                    | 2         |                                |
| Blue       | B                    | 2         |                                |
| Orange     | R + Y                | 3 — hard  |                                |
| Green      | Y + B                | 3         |                                |
| Purple     | R + B                | 3         |                                |
| Brown      | R + Y + B            | mistake   | Over-mixed. No regular orders. |

Rules:

- **Blending, never overwriting.** A dye adds its primary to a segment's mix.
  A red segment taking blue becomes purple; a purple segment taking yellow
  becomes brown. Applying a primary a segment already holds does nothing.
- **The jar dyes one segment per move, as that segment crosses it.** The jar
  stays where it is and the strand is drawn through it (see §5). Because the
  body retraces the head's path exactly, every segment on the strand when the
  head opened the jar *will* cross it — so the strand ends up uniformly
  blended, but it turns visibly, one segment at a time, from the head end
  back. The head is the candy maker, not sugar, so it takes no color — it only
  **flashes** the jar's hue as it passes through, then washes back to its own
  dark tint. That is confirmation, not color: nothing about the head is dyed,
  and the flash lasts less than one grid move at the ramp's fastest speed, so
  it is always gone before the first segment turns.
- **New sugar is raw.** A cube taken *after* the head passed a jar plants its
  segment only once the tail has cleared the cube — which is a move later than
  the jar is spent, so it can never catch that dye. The body therefore becomes
  a multi-colored production line (e.g. `[purple, purple, raw, raw]`). A cube
  taken *before* the jar is part of that batch and does get dyed.
- **Brown is the over-mix trap.** It punishes careless dye pickups. Brown
  candies still go to the shelf; a rare "mystery flavor" customer who accepts
  brown appears occasionally as a mercy/cleanup mechanic.
- **Dyes on the map are primaries only.** Secondary colors must be mixed by the
  player — that's the skill.

### Mixing cheat sheet (in-game, non-obstructive)

The mixing table must always be discoverable without blocking play:

1. **Order cards show component dots.** A purple order card displays two small
   dots (red, blue) beneath the candy icon. This teaches mixing passively and
   is the primary hint channel.
2. **Collapsible cheat-sheet panel.** A small tab at the screen edge (bottom
   corner on desktop, top edge on portrait mobile) expands into a compact
   `R+Y=O · Y+B=G · R+B=P · all=Brown` strip. Expanded by default for the first
   run; state persisted. Semi-transparent, never covers the play grid's active
   area, auto-collapses after a few seconds of play input.

### Color accessibility

Color-matching gameplay must not rely on hue alone:

- Every color pairs with a **symbol** shown on dyes, body segments, candies,
  and order cards (e.g. R=♥, Y=★, B=●, O=▲, G=♣, P=◆, Raw=○, Brown=✖).
- A "high-contrast symbols" toggle in settings makes symbols larger.

### Palette constraints (binding on the Phase 2 `colors.ts` table)

A segment's color *is* the thing the player produces and matches, so the eight
states are mechanics, not decoration. The pastel art direction (§2) therefore
has to earn its palette rather than pick pretty values:

- **All eight states stay mutually distinguishable at pastel saturation.**
  Pale tints compress exactly the differences that separate red from orange
  and blue from purple. If a pair collides, the palette gives way, not the
  mechanic.
- **Non-candy elements must not use candy hues.** The maker's head, sugar
  cubes, HUD chrome and the floor are not candies. They are separated by
  *value* — the head is the darkest thing on the board, the floor the palest —
  which leaves the whole hue range free to carry meaning. Picking a "spare"
  hue does not work: the eight states already span most of the wheel. The one
  exception is momentary: the head borrows a jar's hue for the length of its
  pickup flash (§4). A borrowed hue is readable precisely *because* the head
  never otherwise has one, and it must always end back at its own value.
- **Raw is off-white, so a raw strand and a sugar cube share a color.** That
  is correct — they are the same material. Size and symbol separate them.
- Symbols are the fallback wherever two pastels read alike, which is why they
  are in from Phase 2 rather than bolted on during polish.
- The table lives only in `core/colors.ts`; board, HUD and cheat sheet all read
  it from there, so they cannot drift apart (architecture §7).

## 5. Entities & stations

### The snake (candy maker)

- **Head** = the candy maker (a little chef sprite). Never destroyed.
- **Body** = pulled sugar segments, each with its own color state.
- Moves on a grid at a fixed tick rate (see §9 tuning). Constant motion,
  classic snake steering: can turn 90°, never reverse 180° directly.
- **Starting length:** head only (length 1, no body).

### Pickups are passed *through*, not eaten

Sugar and dye share one rule, and it is the rule that gives both their feel:

- The head **opens** a pickup by entering its cell. The pickup does not
  disappear — it stays put, under the strand, and does not respawn.
- It is **spent** only once the strand has cleared its cell again, which
  (since the body retraces the head's path) is the move after the tail
  crosses it. A long strand therefore sits on a pickup for many moves.
- Nothing on the board teleports: a cube is never "swallowed" at the head and
  re-materialised as length at the far tail.

### Sugar

- Spawns at random free cells. **Invariant: at least one sugar is always on
  the map.**
- The cube stays where it is while the whole strand passes over it. When the
  tail clears the cube's cell, **the cube becomes the new tail segment**, raw,
  on that exact cell — visually it is never gone, it just stops being a cube.
  (The tail vacated that cell on the same move, so the strand stays unbroken.)

### Dye

- Spawns as red / yellow / blue jars at random free cells; at most one jar of
  each primary on the map at a time.
- The jar tints **one segment per move** — whichever is standing on it — and
  is spent when the strand clears it (see §4). A jar the strand crosses with
  **no body** kneads nothing and is wasted (small "splash" feedback).
- **Pity spawner:** if an active order requires a primary that the player
  cannot currently obtain (not on map, not derivable from shelf stock or the
  current body), that dye is guaranteed to spawn within a few seconds — orders
  are never unwinnable by spawn luck (see §8).

### Chopping block

- A fixed station occupying a small run of cells along the top wall, next to
  the serving window. Only a few cells wide, so the row it sits in is still a
  lane the player can use — crossing the bench must be a decision, not a toll.
- **Reaching it cuts the strand loose.** The head entering a bench cell severs
  the whole strand there and keeps going: the maker drives on, empty-handed
  and immediately free to start pulling the next batch.
- The cut batch **stays exactly where it lay** and is drawn into the block
  **one segment per move, from the block end**, each leaving as a candy of
  that segment's color. Nothing is dragged across the board and nothing
  teleports — the same rule pickups follow above, and breaks in §6.
- Candies therefore come out **oldest sugar first**: the dyed head end of the
  batch leads and the raw tail end trails, which is the production line read
  back in the order it was made.
- Chopping the whole strand is intentional — there is no partial cut. Anything
  no customer wants isn't wasted: it goes to the shelf.
- The maker is not sugar, so a head crossing the bench alone cuts nothing.

### Shelf (candy cache)

- Holds up to **6** candies that didn't match any active order.
- When a new customer arrives, the shelf is checked first — instant serve if a
  match exists.
- If the shelf is full, the **oldest** candy is discarded (with a visible
  "stale candy" toss animation) to make room. A batch longer than the shelf is
  therefore a real risk: chop twelve segments with no customers waiting and the
  first six are gone.

### Customers (children)

- Appear at the serving window (top of the kitchen), up to a cap that grows
  with difficulty (start 1, later up to 3–4 queue slots).
- Each shows: candy icon in the requested color, component dots, and a
  **patience bar** draining in real time.
- Serving is automatic the moment a matching candy exists (just produced or on
  the shelf). Served customer → score + happy walk-off.
- Patience reaches zero → customer leaves angry, **−1 life**.

## 6. Movement, collision & failure rules

- **Self-collision does not kill.** Running the head into your own body
  **breaks** the strand at the impact point: the hit segment *and everything
  behind it* (toward the tail) is cut loose. The head and segments in front of
  the impact survive and keep moving. Loss of material and time, not of life.
- **The severed piece freezes and crumbles.** It stops dead where it broke and
  comes apart **one block per move, starting at the impact and travelling
  toward the loose tail end** — the crack propagating down the strand. Debris
  is inert: it blocks nothing and collides with nothing, but pickups will not
  spawn on it while it is still there.
- A pickup the lost length was still passing through is **left on the board,
  closed again** — the strand that was drawing through it no longer exists, so
  the head has to come back for it. A batch cut at the block leaves its
  pickups the same way, for the same reason.
- **Walls:** the kitchen edges wrap (pass-through service doors on each wall —
  exit left, re-enter right). This keeps flow forgiving on mobile. Station
  cells (the chopping block) are crossed, not collided with: they interact
  with whatever passes over them and are never hazards.
- **Lives:** start with **3**. Lost only by letting a customer's patience
  expire. 0 lives → game over → score screen + local high-score table.

## 7. Orders & difficulty ramp

Order tiers map to color tiers: Tier 1 = raw, Tier 2 = primary, Tier 3 =
secondary (mix required).

Endless ramp, driven by elapsed time and/or candies served (whichever fires
first — keeps both slow and fast players on curve):

| Stage    | Approx. time | Order mix (T1/T2/T3) | Max queue | Patience | Snake speed |
| -------- | ------------ | -------------------- | --------- | -------- | ----------- |
| Warm-up  | 0–2 min      | 100 / 0 / 0          | 1         | 45 s     | 5 cells/s   |
| Primary  | 2–5 min      | 30 / 70 / 0          | 2         | 40 s     | 6 cells/s   |
| Mixing   | 5–8 min      | 10 / 50 / 40         | 3         | 35 s     | 7 cells/s   |
| Rush     | 8+ min       | 5 / 35 / 60          | 4         | 30 s     | 8 cells/s (cap) |

- Arrival interval shrinks smoothly within each stage.
- The rare **brown-accepting customer** (~5% after the Mixing stage) only
  appears if a brown candy is on the shelf.
- All numbers above are initial tuning targets, expected to change in the
  balancing phase (see implementation plan).

## 8. Spawn fairness rules

1. ≥1 sugar on the map at all times; respawn once spent.
2. ≤1 dye jar per primary on the map at a time.

A pickup the strand is still passing through counts as on the map for both
rules, so nothing respawns until the whole snake has cleared it.

3. **Pity timer:** for each active order, compute the set of primaries needed
   that are not satisfiable from (shelf stock ∪ candies derivable from current
   body ∪ dyes on map). Any missing primary is force-spawned within 5 s.
4. Pickups never spawn on the snake, stations, or the cell directly in front
   of the head (no "free" accidental pickups).

Rule 3 needs orders to spawn against, so until they exist (Phase 5) rule 2's
cap doubles as a floor: one jar of each primary is kept on the map at all
times. That is deliberately more generous than the finished game — it makes
every color reachable while the color system is the only thing being judged,
and the pity spawner replaces it rather than adding to it.

## 9. Scoring

| Event                          | Points                                    |
| ------------------------------ | ----------------------------------------- |
| Serve Tier 1 (raw)             | 10                                        |
| Serve Tier 2 (primary)         | 25                                        |
| Serve Tier 3 (secondary)       | 50                                        |
| Serve brown to mystery customer| 40                                        |
| Patience bonus                 | + up to 50% of base, scaled by bar left   |
| Serve streak (no losses)       | ×1.1 per consecutive serve, cap ×2        |
| Shelf serve                    | Same as normal (planning ahead is valid)  |

High scores (top 10, with date) persist in `localStorage`.

## 10. Controls

### Desktop
- **Arrow keys / WASD** — steer.
- **P / Esc** — pause. **M** — mute. **C** — toggle cheat sheet.
- Input is **buffered**: up to 2 queued turns so fast double-turns (e.g.
  up-then-left within one tick) execute crisply.

### Mobile
- **Swipe anywhere** on the play area — steer (dominant-axis swipe detection,
  small dead zone; a swipe queues a turn just like a key press).
- Optional **virtual D-pad** (settings toggle) for players who prefer taps;
  bottom corner, mirrored for left-handed mode.
- Pause / cheat-sheet as HUD buttons (≥44 px touch targets).
- No action buttons are needed at all — every interaction is movement-based,
  which is what makes the game viable on mobile.

### Responsiveness
- Landscape: customer window across the top, HUD right or bottom.
- Portrait: customer window on top, grid below, HUD bottom; grid stays
  square-ish so both orientations share one logical board.
- Board is a fixed logical grid (target **16 × 16** playfield cells) scaled to
  fit; no gameplay difference between devices.

## 11. HUD & screens

- **HUD:** score, lives (candy hearts), customer queue with patience bars,
  shelf contents (6 slots), cheat-sheet tab, pause.
- **Screens:** Boot/loading → Menu (play, settings, high scores) → Game →
  Game Over (score breakdown, high-score entry-free — auto-saved, restart CTA).
- **First-run teaching:** no modal tutorial. Three contextual hint toasts:
  "Eat sugar to grow" (on first spawn), "Dye colors your whole strand" (first
  dye near), "Chop at the block to serve" (first time body ≥ 3). Each shows
  once, persisted.

## 12. Audio & juice (polish targets)

- Squash/stretch on eat; pop + particles on chop; shard burst on self-hit;
  chime + confetti on serve; muffled sad trombone-ish cue on customer loss.
- Light looping kitchen ambience; all audio behind a mute toggle (and starts
  only after first user gesture, per mobile autoplay rules).

## 13. Out of scope (v1) / future ideas

- Online leaderboard, accounts, or any backend.
- Level/day progression mode.
- Special candies (striped = speed boost, sour = customer patience refill).
- Obstacles/moving hazards in the kitchen; second chopping block.
- PWA install / offline packaging (trivial later; not a v1 requirement).
