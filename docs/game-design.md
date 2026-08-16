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
right wall, beside the serving window where customers (children) appear. The
shelf and the queue share that side of the board, so a candy's whole path —
bench, shelf, child — stays in one place (§10).

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

1. **The opening levels are the primary hint channel** (§7). A stocked board
   teaches the recipe by making the wrong dye impossible to reach; the queue
   itself shows only the candy each child wants, never the jars that go into
   it. A recipe printed beside every order is a table the player reads instead
   of playing, and it makes the mixing rule someone else's answer.
2. **Collapsible cheat-sheet panel.** A small tab at the screen edge (bottom
   corner on desktop, top edge on portrait mobile) expands into a compact
   mixing wheel: the three primaries with each pair's result drawn between
   them, in jars and candies with their symbols (§4) rather than in letters —
   the HUD carries no prose (§11), and a wheel is read at a glance where a
   written table has to be studied. Expanded by default for the first run;
   state persisted. Semi-transparent, never covers the play grid's active area,
   auto-collapses after a few seconds of play input.

### Color accessibility

Color-matching gameplay must not rely on hue alone:

- Every color pairs with a **symbol** shown on dyes, body segments, candies,
  and the candy a waiting child holds up (e.g. R=♥, Y=★, B=●, O=▲, G=♣, P=◆,
  Raw=○, Brown=✖).
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

- A fixed station occupying a small run of cells down the right wall, next to
  the serving window. Only a few cells tall, so the column it sits in is still
  a lane the player can use — crossing the bench must be a decision, not a toll.
  It sits off the row the maker spawns in rather than centred on the wall. The
  maker starts empty-handed and drives straight until the player turns, so a
  bench in that lane would chop the first strand they build a few cells after
  they built it — the spawn lane has to be somewhere to gather.
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

- Appear at the serving window (the right side of the kitchen, beside the
  chopping block and the shelf), up to a cap that grows with difficulty
  (start 1, later up to 3–4 queue slots).
- Each child is **a character, not a card**: they walk on from the door end of
  the queue, take their place in line, and hold the candy they came for in a
  speech bubble over their head — the color and its symbol, and nothing else.
  The recipe is not shown (§4): what they want is an order, not instructions.
- Their **patience** shows twice, both without words: a bar draining in real
  time at their feet, and their own face, which turns from calm to wide-eyed
  once the clock is into its last stretch.
- Serving is automatic the moment a matching candy exists (just produced or on
  the shelf). Served customer → score, a delighted face, and a walk-off.
- Patience reaches zero → the face turns cross, the child walks out, **−1
  life**.
- A child on their way out **steps clear of the line first**, and walks off in
  front of it: the queue closes up the moment they are off it, so a leaver who
  stayed in lane would be walked through by whoever is moving up.

#### Who gets the candy

Matching is **exact** — a purple order takes purple and nothing else, and brown
matches no regular order — and the two directions resolve differently:

- **A candy leaving the block is offered to the queue first**, and goes to the
  **most impatient** of whoever wants it (ties to whoever has waited longest).
  A candy that could have saved a life must never go to someone with time to
  spare. Only what nobody wants is racked.
- **A customer walking up sweeps the shelf first**, taking the **oldest**
  match — the same end staleness eats from, so a candy is never stepped over
  and left to go stale behind a newer twin.

Together those make one state unreachable: a customer waiting beside a candy
they ordered. The simulation tests assert it on every tick.

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

### Opening levels (built-in tutorial)

Every run — not only the first — starts with three scripted levels. Each is a
single customer, and the board is stocked with exactly what that order needs
and nothing else:

| Level | Order                   | On the board                   | What it teaches                       |
| ----- | ----------------------- | ------------------------------ | ------------------------------------- |
| 1     | Raw                     | sugar, no jars                 | pull sugar, chop at the block         |
| 2     | One primary             | sugar, **then** that jar       | cross the sugar *first*, then the jar |
| 3     | That primary + one more | sugar, **then** those two jars | two dyes blend into one color         |

A restricted board teaches better than any text can, and it restricts *when* as
well as *what*:

- **Which jars.** In level 2 the only jar on the floor is the one the order
  wants, so "wrong dye" is not a mistake the player is able to make.
- **When they arrive.** A level lays no jar at all until the first cube is on
  the strand, so crossing the jar first is not a mistake the player is able to
  make either. A board holding a cube and a jar at once offers two moves and the
  wrong one is the *louder* one — the jar is a saturated color wearing a symbol
  and the cube is off-white — which is how a playtester came to drive straight
  at the jar, over and over, and never take a cube at all. With the jar withheld
  there is one thing on the floor to take, and when it does arrive the strand is
  already carrying something, so crossing it *visibly turns a segment*. That is
  the lesson delivered as cause and effect rather than as a mistake to be
  inferred from a splash.
- **When they stop.** A level lays a jar only while that jar still has something
  to do, so once the candy carries the color the floor goes bare and the block is
  the only thing left on it. Re-laying the jar the moment the strand cleared the
  last one is eating food and food respawning — a playtester who had passed level
  1 read it exactly that way and went on crossing jars with a finished candy in
  hand. The two halves are one rule: a jar is out while the strand still needs
  it, which for an empty strand is never and for a dyed one is no longer.

Difficulty here is authored by removing options.

- The orders are **rolled from the run's seed**, so the levels teach the rule
  rather than a memorised answer. Level 3 deliberately *extends* level 2's
  primary instead of drawing a fresh pair — it reads as a progression (you made
  yellow, now add red for orange), and it means the stocked set only ever grows,
  so no jar is ever taken off the board mid-run. Nothing on this board
  teleports, and that includes the tutorial's own furniture. Holding a jar back
  until there is a strand to dye is not an exception to that: withholding is a
  jar not yet laid, never one removed, so a jar already on the floor stays there
  whatever the maker is carrying.
- **Opening customers have no patience at all**: no bar, no countdown, no way
  to lose a life. A tutorial that plays on every single run must not be able to
  cost the run, and a bar that drained toward nothing would be a lie about the
  rules. They pay base points with no patience bonus (§9) and do build the
  streak.
- **One cube at a time.** A level asks for one candy, so the floor carries one
  sugar cube and does not lay another until that one has come back through the
  block. Restocking the moment the first is pulled would offer a second segment
  the level never asked for — the same "remove the options" rule the jar stock
  is authored by. (The endless game keeps §8.1's floor of one cube on the map
  at all times.)
- A level ends when its customer is served; the next child walks up a second
  later — and so does the endless game's first, which inherits that beat rather
  than opening on the handover's own empty-window gap (4s at Mixing — a third
  of its 12s interval, the window being empty of all three slots — which would
  read as the game having ended rather than started). Nothing can
  be soft-locked: a level's jar is not on the floor until there is a strand to
  dye, and a strand that still needs the color still calls the jar back, however
  it came to need it. The level-2 lesson is not taught by retry — retry was
  tried, and a playtester met it by driving at the jar again rather than by
  learning from it. It is taught by not offering the wrong move.
- These three levels **are** the teaching, on their own: no captions, no
  toasts, no words anywhere on the screen. What the player is shown is a board
  holding exactly one useful move and a child holding up what they want, which
  is a thing to try rather than a thing to read.

The endless ramp below starts only once level 3 is served, and it starts at the
**Mixing** row rather than Warm-up: the opening levels have already taught raw,
primary and secondary, so dropping back to 100% raw orders would read as going
backwards. (Warm-up's row is kept in the table as the shape of what the ramp
grew out of.)

Endless ramp, driven by elapsed time and/or candies served (whichever fires
first — keeps both slow and fast players on curve):

The curve is anchored on the rows below and interpolated between them, so every
knob moves smoothly rather than stepping at a stage boundary. Time here is
counted from the **handover** — the moment the third opening level is served —
not from the start of the run, so a player who takes their time learning does
not find the rush already waiting. `core/difficulty.ts` holds the table.

| Stage    | Since handover | Order mix (T1/T2/T3) | Max queue | Patience | Arrival | Snake speed |
| -------- | -------------- | -------------------- | --------- | -------- | ------- | ----------- |
| Warm-up  | *(pre-tutorial — kept as the shape the ramp grew out of)* | 100 / 0 / 0 | 1 | 45 s | — | 5 cells/s |
| Handover | 0 s            | 10 / 50 / 40         | 3         | 35 s     | 12 s    | 5 cells/s   |
| Settled  | 1 min          | 10 / 50 / 40         | 3         | 35 s     | 10 s    | 7 cells/s   |
| Rush     | 3 min          | 5 / 35 / 60          | 4         | 30 s     | 6 s     | 8 cells/s (cap) |
| Past it  | 7 min          | 5 / 35 / 60          | 4         | 28 s     | 4 s     | 8 cells/s (cap) |
| Backstop | 15 min         | 5 / 35 / 60          | 4         | 22 s     | 2.8 s   | 8 cells/s (cap) |

- Demand starts at the **Mixing** row but speed starts at Warm-up's, and eases
  up to Mixing's over the first minute. The opening levels have already taught
  all three tiers, so dropping the order mix back would read as going backwards
  — but a strand that jumped 40% faster the instant the third child was served
  would lurch.
- **Arrival interval is the lever that ends a run.** Speed caps at 8 cells/s, so
  past the Rush row the window is the only thing still tightening; a curve that
  flattened while the player still had headroom would never bring the run to an
  end (§1: difficulty ramps *until lives run out*).
- **The Arrival column is the gap with one slot left to fill**, not a flat
  metronome, and an emptier window fills proportionally faster. Of three slots:
  an empty window waits a third of the column figure, one child already waiting
  makes it two thirds, and two makes it the whole figure. So an empty window
  fills in two intervals rather than three, and a window near capacity is under
  exactly the pressure the column always named. That is more demand over a run
  rather than the same demand rearranged, and deliberately so: on this same
  table it ends a batching run at 5 minutes where a flat interval took 8.
- **Read flat, the Max queue column was unreachable.** Children arrived on a
  fixed beat whatever the window held, so any maker who served faster than the
  interval emptied it and kept it empty, and the queue never rose above one on
  any seed at any point on the ramp. A player who can only ever see one order
  cannot plan a ladder against the window, which is the whole point of the
  window being deeper than one.
- Whichever of elapsed time and candies served is further along drives the
  curve, so a fast player is not held back by the clock and a slow one is not
  overrun by it.
- The rare **brown-accepting customer** (~5% once the ramp has settled) only
  appears if a brown candy is on the shelf. Because a new arrival sweeps the
  rack, they are served the moment they walk up: the cleanup is the whole visit.
- Measured against the reference bots, a maker who batches dies around 5 minutes
  on most seeds, against a target of 4–6. The target read 8–10 until the seventh
  sitting, which is where the case for moving it is: **every lever that adds a
  new thing to do is spent by the 3-minute mark** — max queue at 2 min, the order
  mix and the speed cap at 3 — and past those only patience and the arrival
  interval move, neither of which adds anything, only subtracts slack. A target
  set past the last of the levers was asking this table to hold attention with
  arithmetic. See the implementation plan for those runs — including the one
  finding this table could not fix.

## 8. Spawn fairness rules

1. ≥1 sugar on the map at all times; respawn once spent. (The opening levels
   narrow this to exactly one cube per level — see §7.)
2. ≤1 dye jar per primary on the map at a time.

A pickup the strand is still passing through counts as on the map for both
rules, so nothing respawns until the whole snake has cleared it.

3. **Pity timer:** for each active order, compute the set of primaries needed
   that are not satisfiable from (shelf stock ∪ candies derivable from current
   body ∪ dyes on map). Any missing primary is force-spawned within 5 s.
4. Pickups never spawn on the snake, stations, or the cell directly in front
   of the head (no "free" accidental pickups).

5. **Baseline jar:** if rule 3 is asking for nothing and the floor is bare, one
   jar is put out anyway, rolled. Without it the only jars that ever appeared
   would be ones a waiting child already needed, and a maker could never build
   ahead of the window — which is the whole point of the strand.

Rule 3's "within 5 s" is a **ceiling on how long an order may be unfillable**,
not a wait every pickup has to serve. Measured at the full five, two dyes cost
more than most orders have patience for and the game grinds to a halt; the
implementation keeps the actual delay well under it (`core/pity.ts`), long
enough that a jar does not reappear under the maker's feet the instant it is
spent. Scarcity here is *which* jars, not how long they take.

Rules 3 and 5 replaced Phase 4's stopgap, which kept one jar of every primary on
the map at all times. That floor was deliberately more generous than the
finished game — it made every color reachable without asking what anyone
ordered — and with it gone the *order* dyes are picked up in starts to matter.
The opening levels are untouched by any of this: their board is stocked with
exactly what their one order needs (§7), so nothing on it can starve.

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
| Serve an opening-level customer| Base only — no clock, so no bonus (§7)    |

The streak multiplier is the run standing *before* the serve, so the first
serve after a loss pays flat and the bonus has to be earned back. Points are
rounded once, at the end, rather than per term.

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
- The serving side is whichever side of the grid the chopping block is on, in
  both orientations: customer window, shelf and score anchor there, so the
  candy's path (bench → shelf → child) never doubles back across the screen.
- Landscape: bench on the right wall, customer window + shelf + score in the
  right column — and the window is the **bench's own row**, with the shelf
  running down the column beneath it. A child waiting at the far end of the
  column from the counter their candy is cut on is the one thing a playtester
  asked about unprompted; the order also happens to be the order a candy
  travels in (offered to the queue first, racked only if nobody wants it, §5).
  On the shortest phones sideways the column cannot pay for it: the line then
  sits as high as the score and lives allow and no higher.
- Portrait: same right column, narrowed — grid on the left, serving strip
  beside it; grid stays square-ish so both orientations share one logical
  board.
- Board is a fixed logical grid (target **16 × 16** playfield cells) scaled to
  fit; no gameplay difference between devices.

## 11. HUD & screens

- **HUD:** score, lives (heart pips), the queue of children with their bubbles
  and patience bars (§5), shelf contents (6 slots), cheat-sheet tab, pause. The
  hearts are inked in the symbol's own dark value rather than red: a life is
  not a candy, and hue in this game belongs to candies alone (§4, palette
  constraints).
- **No prose in the HUD.** The only text on the play screen is the score, and
  that is a number. Everything else — what a child wants, how long they will
  wait, how they took it — is carried by a drawn thing, because the HUD is read
  in glances taken from steering.
- **Screens:** Boot/loading → Menu (play, settings, high scores) → Game →
  Game Over (score breakdown, high-score entry-free — auto-saved, restart CTA).
- **First-run teaching:** no modal tutorial, no toasts, and no captions. The
  three lessons — pull sugar and chop, sugar before the jar, two dyes make one
  color — are the three opening levels of §7, taught by what the board does and
  does not hold. Levels that always run cannot be missed or dismissed, which is
  what the persisted seen-once flags were working around.

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
