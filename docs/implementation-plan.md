# Candy Snake — Implementation Plan

Phased so that **every phase ends in something runnable**, and gameplay-risk
items (does the core loop feel good?) are validated before polish is spent.
Sizes are relative (S < M < L), not calendar promises.

References: [game-design.md](./game-design.md), [architecture.md](./architecture.md).

> **Status: Phase 7 is the current phase**; 0–6 are done and marked ✅ below,
> with Phase 6's real-device pass called out there as outstanding — it has now
> had its first report, which is not the same as having been run.
> This plan is where phase status is tracked — anything else that mentions it
> (the README) links here rather than restating it.

## Phase 0 — Scaffold (S) ✅

- Vite + TypeScript (strict) + Phaser 3 project; ESLint, Prettier, Vitest.
- `npm run dev / build / test / lint / typecheck` all green.
- Empty BootScene → GameScene showing a colored rectangle at fixed
  `Scale.FIT` 960×640.
- Git repo initialized; first commit.

**Done when:** `npm run dev` shows a Phaser canvas; CI-ready scripts pass.

## Phase 1 — Gray-box snake core (M) ✅

The engine-free core plus minimal rendering. No colors, no customers yet.

- `core/`: types, rng, board (16×16, wrap), snake (tick movement, growth),
  spawner (sugar only, ≥1 invariant), `Game.step` + events.
- `input/`: keyboard adapter + DirectionQueue (buffering, 180° rejection).
- `render/`: generated textures; boardView draws snake + sugar per state.
- Self-collision shatter (segment-at-impact through tail destroyed) with a
  placeholder flash.
- Unit tests: movement/wrap, growth, shatter boundaries, spawn invariant,
  input queue edge cases.

**Done when:** playable snake on desktop — eat sugar, grow, shatter on
self-hit — and `core/` tests pass. **This is the "does steering feel right?"
checkpoint; tune tick rate before moving on.**

## Phase 2 — Color system (M) ✅

- `core/colors.ts` palette table (mask → hex, symbol, name, tier) + `blend`.
  The values are constrained, not free — see game-design §4 "Palette
  constraints" before picking any.
- Dye pickups (primaries, ≤1 per color on map). Pickups are passed *through*
  rather than eaten (design §5): the head opens one, it tints/feeds one
  segment per move as the strand is drawn across it, and it leaves the board —
  and only then respawns — once the strand has cleared its cell. A sugar cube
  becomes the new tail segment on its own cell; new sugar still appends raw.
- Self-hit breaks the strand instead of vaporising it: the severed piece
  freezes and crumbles one block per move, impact end first (design §6).
- Rendering: per-segment tint + symbol glyph; dye jars and debris on board.
- Unit tests: full blend table, per-segment independence, dye-with-no-body
  no-op, pass-through timing, crumble order.

**Done when:** you can build a `[purple, purple, raw]` strand on screen and
every color state renders distinctly (check symbols with grayscale filter),
and the strand visibly turns one segment at a time as it crosses a jar.

## Phase 3 — Chopping block & shelf (M) ✅

- Chopping block station cells down the right wall, on the serving side of the
  board with the shelf and (Phase 4) the queue. Reaching one cuts the whole
  strand loose (design §5): the maker drives on empty-handed, and the batch
  freezes where it lay and is drawn into the block one segment per move, block
  end first. No chop mode, no halt — the strand is never dragged or teleported.
- A cut piece is one concept whichever way it was cut: `crumble` (self-hit) and
  `chop` share the frozen-and-consumed-one-per-move machinery, and differ only
  in what each segment becomes.
- Shelf model (6 slots, oldest-evicted) + minimal shelf strip in a temporary
  HUD corner, in the right column level with the block.
- Events wired to placeholder effects (pop per chop).
- Unit tests: chop ordering & colors, batch drain, pickups re-closed by a cut,
  shelf eviction, block cells excluded from spawns.

**Done when:** grow → dye → chop produces the right candies in the right
order, visible on the shelf.

## Phase 4 — Customers, orders, lives → first real game (L) ✅

The phase where it becomes a *game*.

- `core/orders.ts` + `customers.ts`: arrivals, patience countdown, queue cap;
  order generation per difficulty stage table, from one static stage row.
- `core/tutorial.ts`: the three opening levels every run starts with (design
  §7) — one customer each, the board stocked with exactly what that order
  needs, and no patience clock until they are done. They also decide what the
  spawner stocks, so `ensurePickups` takes its stock list from the caller.
- Matching: on candy produced and on customer arrival, serve from
  production/shelf automatically.
- Scoring (base + patience bonus + streak), lives, game over.
- `UIScene`: the queue drawn as children — each walks up, holds the candy they
  want in a bubble, drains a patience bar, and leaves pleased or cross — plus
  lives, score, and the shelf strip moved here.
- Menu → Game → GameOver scene flow; restart.
- Unit + simulation tests: matching precedence, expiry → life loss, scoring
  math, opening-level stock and non-expiry, bot-run invariants.

**Done when:** a full run — opening levels, serve customers, lose lives, game
over, restart — is playable start to finish with keyboard.

## Phase 5 — Difficulty ramp & spawn fairness (M) ✅

- `core/difficulty.ts`: continuous curve over (time, serves) driving order
  tier mix, arrival interval, patience, queue cap, snake speed (per the table
  in the design doc). It replaces the single static `StageConfig` Phase 4
  pinned, starting from the Mixing row the opening levels hand over at.
- Pity spawner: needed-primary detection and forced spawn ≤5 s; brown-mercy
  customer.
- Balancing pass: scripted bot simulations + human playtests; adjust the
  tuning table. **Expect to iterate here — budget real playtime.**

**Done when:** a decent player survives ~8–10 min on a first real run and
death feels earned (post-playtest judgment call), simulation asserts no order
is ever primary-starved, and the batching bot outscores the grinder.

Two of those three are met. The third — the batching bot outscoring the grinder
— is **not**, and the balance record below sets out why it is a rules question
rather than a tuning one, along with the three candidate rule changes it opened
with — of which the sittings since have struck one, added three more, and hold a
fourth pending a measurement. It is carried forward as an open finding rather
than counted as done. The human playtest half of the first criterion has now had
five sittings, and none of them answered that half — nobody has played long
enough to die. They answered other things instead, including the open finding
arrived at from the far end, three times, by three different players. See the
five records below.

### Where the balance landed

Measured the same way it was measured going in — two seeded bots over ten
minutes on four seeds (`core/simulation.test.ts`, "the reference players, after
the ramp went in"). Two of the three findings this phase opened with are
answered; the third is not, and it turned out not to be a tuning problem.

- **Losing is possible.** A maker who batches now dies around the 8-minute mark
  on three seeds in four, against a target of 8–10 minutes. Before, neither bot
  could be touched in ten.
- **Demand is no longer the only constraint.** The arrival interval comes down
  from 12 s to under 3 s, past what either maker can keep up with, so a run ends
  on a queue that outgrew the maker rather than on the clock running out of
  customers. Serves roughly doubled, to ~110 over the same ten minutes.
- **Batching is still punished — the open finding.** The maker who builds a
  production line chops *more* candy than the grinder on every seed, and scores
  less on every seed. This is not a number that was left untuned. The levers
  were measured one at a time: removing staling entirely (a 60-slot shelf) does
  not fix it, flattening the tier mix does not fix it, deepening the queue does
  not fix it, and teaching the bot to plan against the whole window rather than
  the child at the front of it narrows the gap by about half and no more.

The reason is structural rather than numeric. A nested ladder is a **fixed
bundle** — one secondary, over one particular primary, over a raw — because a
jar tints everything already on the strand and a cube taken afterwards stays
raw (design §4). Demand is spread uncorrelated across seven colors. So the
extra candy a longer strand buys is mostly candy nobody ordered: the batching
maker's sell-through measures ~40% against the grinder's ~65%.

Making batching pay is therefore a **rules** question, not a tuning one, and it
is left open here rather than papered over. The candidates, none of them in
this phase's scope:

- a combo bonus for serving several children off one chopped batch, so the
  batch is worth something as a batch;
- orders that ask for a nested set rather than a single color, so demand has the
  shape a ladder produces;
- one jar-crossing tinting the whole strand in a single move rather than one
  segment per move, so a long strand is genuinely faster to dye.

Both bots are still kept, for the reason they always were: tightening the ramp
until the *grinder* dies on schedule would calibrate the game around the
strategy it least wants to reward. The ramp is tuned so the maker playing as
intended dies on schedule, and the grinder outliving them is the open finding
made visible rather than hidden.

### What the first sitting said

Two players, both game-literate, on the build as it stood partway through Phase
6. The sitting is worth recording because one of them walked into the finding
above from the other end: without having seen a bot run, they asked for a combo
bonus and for a slower snake with a deeper window — the first of the three
candidates, and a lever the list has not got.

What came out of it, and what is to be done about each:

- **"Could serving several customers at once be worth more?"** — candidate one,
  proposed independently. It is cheap: `Severed` gains a serve counter,
  `consumeSevered` already holds the piece that counter belongs to, and the term
  itself goes in `core/scoring.ts`. It is also, on the sell-through measured
  above, unlikely to be enough on its own — it pays better for the matched
  *part* of a batch, and the batching maker's problem is everything outside that
  part. Worth doing, second. The second sitting asked for the same thing and
  called it a *meter*, which is a correction to that scope rather than an echo
  of it — see below.
- **"Slow it down a bit and put more children at the window, so you can pull a
  longer strand."** — a lever the candidate list does not have, because the
  record above measured queue depth and speed *one at a time*. Together they
  compound on sell-through: a slower strand is in play longer, and a deeper
  window gives a fixed bundle more targets to land on. One edit to
  `core/difficulty.ts`'s anchor table and one sweep of the bots says whether
  that is true. Worth doing, **first** — it is the cheapest test of the likeliest
  fix, and it is a table diff, which is what that module is for. The second
  sitting names which knob of the two actually matters; see below.
- **"The candy preparation area — does it score for me or against me?"** — the
  shelf is unreadable, and the reason is in the code rather than in the design:
  `candy-staled` reaches `GameScene` and plays nothing, so a candy pushed off a
  full rack goes in silence. Design §5 already asks for the toss, and Phase 7
  already owns it; this is that item with a playtest behind it now.
- **"Maybe the dye shouldn't respawn straight away, or cap how many there are."**
  — **rejected**, and worth writing down why, because the instinct is right and
  the effect is backwards. Two things put a jar out (design §8.3): pity, which
  answers what a *waiting* order needs, and the baseline jar, which is the only
  way to build ahead of the window. Scarcity taxes the second while the pity
  floor keeps the first supplied — so it throttles the maker pulling a strand
  and leaves the one playing off the front of the queue topped up. It would
  widen the very gap this phase is trying to close. If more constraint is
  wanted, the row above is the constraint that pushes the right way.

The order of attack, once Phase 6 is landed and not before: retune the anchor
table and measure; build the combo only if that leaves the gap open; and if
neither closes it, escalate to the second candidate — orders that ask for a
nested set — rather than keep tuning. The success criterion is already written
and already committed. `core/simulation.test.ts` asserts *today* that the
batching maker scores less on every seed, so closing this finding means
inverting that assertion, not deleting it.

Candidate three — one jar-crossing tinting the whole strand in a single move —
is **struck**. The argument against it was theory: it makes a long strand faster
to dye and also more uniform, so a five-segment batch leaves the block as five of
the same candy against demand spread over seven colors, which is the half of the
problem that is not the problem. The second sitting turned that into evidence — a
player reported the uniformity unprompted, as something that already bothers them
at the *current* tint speed. A candidate whose whole effect is to arrive at that
state sooner does not need scheduling.

### What the second sitting added

Two more players, one of them new to it. This is the more useful of the two
sittings, and most of that is one player's two sentences.

- **"I kept wondering whether I had a reason to make the strand longer — one or
  two sugars plus the jars already spends the whole of a customer's patience."**
  — the open finding, reached from the chair rather than from a bot sweep, and
  with a *different* mechanism under it. The record above is economic: the extra
  candy a long strand buys is candy nobody ordered. This one is temporal: the
  trip cannot be afforded at all, so the strand never gets long enough for
  sell-through to be what bites. Both can be true at once, and they do not have
  the same fix.
- **That is a gap in the bot harness as much as it is a finding.** The bots path
  optimally and never hesitate, so they finish a ladder inside a patience window
  a human cannot — which is why the seeded sweeps measured the economics and
  never once saw the clock. Worth remembering the next time the simulation is
  taken as the last word on a tuning question.
- **It also names the knob.** What the first sitting asked for was "slower, with
  more children"; what actually wants moving is `patienceMs` against what a
  ladder costs in trip time. Queue depth is the second-order half of it.
- **"A combo meter would feel very good on multiple delivery."** — candidate one
  again, from a different player, and *meter* is the correction: the first
  sitting's version is a term in `core/scoring.ts`, and a term that quietly pays
  more delivers none of the feel being asked for. What gets built is a meter
  **and** a term, and the meter may be the load-bearing half. Note the tension
  with the row above — a combo pays for a batch nobody can currently afford to
  build — which is why the order of attack stands rather than being reshuffled
  toward the thing two players have now asked for.
- The same player described their strategy as taking whatever was nearest. That
  is the grinder, played by a human, and it is the plainest argument yet for
  keeping both bots: the cheap way to play is what people find on their own.

The rest of the thread was about making the game harsher, and the answer is
worth recording once rather than re-derived each time it comes up.

- **Shattering the strand against a wall** — **no**, and there is no rule here to
  tune: `core/board.ts` wraps the edges unconditionally, so this would be
  net-new. It would also delete a tactic a player in that same thread had just
  found and liked — using the wrap to save distance — and design §6 gives wrap a
  stated reason, that it keeps flow forgiving on mobile, which is the phase in
  hand. Read instead as "is the self-hit too harsh?", it is already the harsh
  version: everything from the impact back is destroyed.
- **Debris scattering onto the floor to be picked back up** — offered as the
  gentler alternative to the above. The harsher rule is not going in, so the
  mitigation is not needed for what it was proposed for; it joins the candidate
  list anyway, because it is the first suggestion in either sitting that pushes
  the *right* way on the open finding. Recoverable debris makes a long strand
  cheaper to lose, which is a reason to pull one. It is not free: it would want
  an answer for flooding the floor, for what §8.1's ≥1-sugar restock does when a
  break lays six cubes at once (`ensurePickups` only lays sugar when there is
  none), and for self-collision becoming nearly costless.

Three harshening instincts have now come up across the two sittings — scarcer
dye, wall shatter, and the standing temptation to tighten the ramp until the
grinder dies. All three tax a long strand more than a short one, which is to say
all three push toward the way of playing this phase is trying to stop rewarding.
That is the first thing to check any difficulty proposal against.

And the question the thread opened with — whether the game should be gentler or
more hellish — is already answered in writing, which is worth saying because it
will be asked again: design §1 sets the audience as casual, all ages, one-hand
playable on mobile. The players arrived at the document's answer unprompted.

### What the third sitting settled — level 2 taught nothing

A player driving straight at level 2's jar, repeatedly, without ever taking the
cube, and staying confused about why nothing happened. This is the fourth
comprehension data point in three sittings and much the sharpest, because it
names the level and the exact wrong move rather than describing a general fog.

It also falsifies something the docs asserted: design §7 claimed the level-2
lesson was "taught by retry rather than by text". Retry was the mechanism, and
four players have now come through level 2 without it landing — this is the one
who showed why, by taking the retry and spending it the same way. Two things
were working against it.
The board laid the cube and the jar **at the same time**, so the level offered
two moves where its own "remove the options" rule says it offers one — and the
wrong one is the louder, being a saturated color wearing a symbol against an
off-white cube. And the punishment was illegible: a wasted jar splashes, leaves,
and the stock rule re-lays it *at a different random cell*, which is exactly what
eating food and food respawning looks like. The board was teaching the eat-model
the player had brought with them.

**Fixed by stocking, not by a rules change.** A level now lays no jar until the
first cube is on the strand (`tutorial.ts`'s `stocksDyes`), so crossing the jar
first is not a move the level offers, and when the jar does arrive the maker is
carrying something — so crossing it visibly turns a segment. Cause and effect on
screen, still no captions. Withholding is not removal: the spawner only ever
adds, so §7's promise that none of the tutorial's furniture leaves mid-run holds
unchanged, which is why `stockedPrimaries` (what a level permits) is now a
separate question from `stocksDyes` (what it lays right now).

Two things this deliberately did **not** do:

- **It did not touch the wasted-dye rule** (design §5). The proposal on the table
  was to stop spending a jar the strand crosses with no body at all. Measured
  over the bot sweeps, that fires on 2–5% of jars opened — one every 1.5–3
  minutes — at the same rate for both reference players, so it is not the tax on
  batching it might look like. With the stocking fixed it is no longer a
  tutorial question at all, and what is left is an endless-only call with a real
  cost: a stale jar that never leaves suppresses `endlessStock`'s baseline
  reroll, which is the only thing that lets a maker build ahead of the window.
  Open, unscheduled, and not urgent.
- **It did not retune anything.** The gate shifts *when* a jar spawns, which
  re-rolls every free cell drawn after it, so runs either side of it are
  different runs rather than the same run played harder. Measured across sixteen
  seeds: the ramp closed out 14/16 batching runs before and 12/16 after — the
  same rate, re-rolled. The four canonical seeds happened to sit on the edge of
  it (3 died, then 2), which is why `simulation.test.ts` now asks that rate of
  the wider draw and keeps the seven-minute floor on the four. (The floor has
  since moved to that draw as well — see the fourth sitting below.)

One finding fell out of that sweep and is **not** about this change: on the wider
draw the ramp does not hold its seven-minute floor everywhere — seed 88 kills the
batcher at 309 s, before this change and after. The four tuned seeds do not
contain a case that shows it. That belongs to the balance work above, not here.

### What the fourth sitting settled — level 2 taught the wrong thing

The same level, the same player model, one step further in. This player *passed*
level 1 — they pulled the cube and chopped it — and then, in level 2, went on
crossing jars long after the candy was dyed, with nothing left to do but carry it
to the block.

The third sitting fixed the wrong move at the *start* of the level and left the
identical bug at the end of it. `stocksDyes` withheld the jar until there was a
strand to dye, but nothing ever said the level was *finished* with dye: the
spawner's floor of one jar per stocked primary re-laid it the instant the strand
cleared the last one, at a fresh random cell. That is eating food and food
respawning, drawn on the board in the loudest thing on it — and it is the same
diagnosis as last time, which is the point. A player who has learned "the
colored thing is the thing to take" is not going to unlearn it from a board that
keeps putting one out.

Note what was *not* wrong: nothing broke. Re-crossing a jar for a primary the
candy already holds is a no-op (`blend`), so the player was not punished, not
soft-locked, and not making brown. They were being told there was more to do.

**Fixed in the same place, by finishing the same rule.** `stocksDyes` now lays
the level's primaries that would still change the strand — which is one test
covering both ends, because a jar with nothing left to do is a jar the level is
not asking for. An empty strand has no segment to change, so the jar is still
held back; a dyed one has nothing left to gain, so it stops coming. Level 3 gets
it per-jar for free: cross the red and the red stops respawning while the yellow
stays out. The floor going bare is the level saying it is done, in the only
language §7 allows itself.

- **Sugar already worked this way**, which is what makes the fix a completion
  rather than an addition: `stocksSugar` has always rationed the cube by
  *quantity* — one per level, no restock until it has come back through the
  block. Dye was rationed by identity and by timing but never by need, and the
  gap between those two is exactly what the player was reading.
- **Nothing here can soft-lock a level.** The test is "would this jar still
  change the strand", so a strand that needs the color still calls the jar back,
  however it came to need it — including a candy chopped raw by mistake and a
  fresh cube pulled after it.
- **It did not retune anything, again, and this time it was measured wider.**
  The same re-roll caveat applies: one fewer jar spawn shifts every free cell
  drawn after it. Over 96 seeds, before and after: 81/96 batching runs closed out
  against 79/96, mean death 475 s against 473 s, 65 of 81 deaths past seven
  minutes against 61 of 79. The same curve, re-rolled. On the four canonical
  seeds the re-roll landed badly — 404 now dies at 331 s — which is why the
  seven-minute floor moves off the four and onto the sweep as the rate it always
  was.
- **One assertion was measuring the wrong thing and this exposed it.** "The
  batcher chops more candy than the grinder" compares a run the ramp closed out
  at six minutes with one still going at ten, and calls the short one less
  productive; it held on the four by luck and on only about two thirds of the
  wider draw, before this change as much as after. Per minute alive, the batcher
  leads on 96 of 96 seeds either side of it. That is the claim the sentence was
  always making, so that is what it now asserts — the open finding above is
  untouched, since it is about what the candy is *worth* and not how fast it is
  made.

### What the fifth sitting proposed — six items against one test

One player, the sixth. Unlike the four sittings before it, this one did not
report confusion — it arrived with a list of six designs instead, which is why
it adds nothing to the comprehension count Phase 7 keeps. It is the most useful
sitting yet for the open finding and the easiest to get wrong: one of the six
puts a new lever on the half of that finding the second sitting named, two more
push at it from the side, and two fail the test this document already wrote for
exactly this kind of proposal.

- **"Nothing tells you a child is about to leave — make them flash."** —
  **scheduled, and it is a legibility bug rather than a missing feature.** There
  *is* a warning: `ui/customerView.ts` swaps the face at 40% of the bar, and
  design §5 asks for the clock to show twice. So this is the wrong stage shown
  the wrong way, which is a different job from adding one. Phase 7's juice list
  already carried the urgency pulse; the rule it now has to satisfy is recorded
  there rather than here.
- **A low-patience, high-cost customer (技安).** — **rejected, by the test at
  the end of the second sitting.** A child who demands one candy quickly and
  takes an extra life for missing rewards the maker who takes whatever is
  nearest — the grinder, which that same sitting confirmed is what people find
  on their own. It taxes the long strand, and it worsens the *temporal* half of
  the open finding at the moment that half is what we are trying to fix.
  Half of it is also already built, and that is the trap rather than the
  feature: `matchIndex` serves the most impatient first, so a low-patience child
  would silently divert every matching candy away from the rest of the queue.
  The character is worth keeping and the knobs want inverting — a memorable
  child who wants a **secondary**, pays a premium, and waits **longer** than the
  rest is a customer worth pulling a strand for. That version joins the
  candidate list. The version proposed does not.
- **A rush period (高峰期): many children at once, worth more.** — **on the
  list, and the strongest new idea in the batch**, for a reason that is not
  variety. The batching maker's problem is a fixed bundle of about four colors
  against three or four places at the window; a rush deepens the window, which
  gives the bundle more targets, and a rush that can be *seen coming* is an
  invitation to build ahead of it. That is the first sitting's "more children at
  the window" lever in the one shape that does not have to be paid for as a
  permanently harder game. It fits `core/difficulty.ts` cleanly: a rush is one
  more pure term over ramp position, with no rng in it, so determinism survives
  and it is unit-tested like the rest of the table. Three things constrain it.
  - **It cannot deepen the queue past four.** `ui/layout.ts` sizes the portrait
    pitch as `(board.width - 60) / 4` with a comment naming four, landscape runs
    a flat 84 px pitch inside a column of at most 300, and
    `CustomerQueue.standingX` clamps nothing. A fifth child walks off the frame.
    So the rush moves `arrivalIntervalMs` and nothing else, or it is a layout
    job first.
  - **A rush is only a peak if the trough is shallower**, which means the anchor
    table moves — and every change to spawn timing re-rolls every free cell
    drawn after it, as the third and fourth sittings both had to measure. It
    rides the retune's sweep rather than paying for its own.
  - **It has to be telegraphed without words** (design §11): children crowding
    at the door, a bell. A drawn thing, not a caption.

  On "and worth more points": the rush already pays more by volume, and
  `core/scoring.ts` has three terms in it already. A flat per-serve bonus inside
  the window if anything, never a fourth multiplier.
- **A combo for serving several children in a row.** — **candidate one, now
  asked for by three players in three sittings.** The scope is unchanged from
  the first sitting's entry — a serve counter on `Severed`, the term in
  `core/scoring.ts` — as is the second sitting's correction that the **meter**
  may be the load-bearing half. It stays second in the order, for the reason the
  second sitting gave: it pays for a batch nobody can currently afford to build.

  The Overcooked half of the proposal — **serving in the order the children
  arrived** — is **struck**, on two grounds. There is no verb for it: matching
  is automatic (`deliverCandy` → `matchIndex`), design §5 states the
  most-impatient rule with a reason and asserts an invariant on it, and design
  §10 has no action button to hold a candy back with, which is the thing that
  makes this game work one-handed. And it would pay out for nothing anyway: the
  ramp moves `patienceMs` by a few seconds over minutes while every bar drains
  in real time, so the most impatient child is always the one who has waited
  longest. The bonus would fire on almost every serve and mean nothing.
- **A longer strand moves faster.** — **held, and the target is right.** This is
  the open finding reached from the chair again, and it aims at the half the
  second sitting named — that a ladder costs more trip time than a customer's
  patience affords. It is only the second lever anyone has aimed at that half
  and the first that is not `patienceMs`, which is why it is held rather than
  rejected. But the lever fights three things already written down.
  - Design §7 gives the 8 cells/s cap a job: past the Rush row speed has capped
    and the window is the only thing still tightening, which is what brings a
    run to an end at all. Length-boosted speed punches through that.
  - 125 ms is a floor rather than a preference. `GameScene`'s catch-up ceiling
    is 100 ms, and under it one frame advances two grid moves with nothing
    adjacent to slide between — the strand would teleport, which is the one
    thing this board does not do.
  - And it fails the harshening test *quietly*, which makes it the subtlest one
    yet. A long strand is already harder to steer, having more of itself to
    run into; making it faster as well compounds the difficulty exactly where
    the player is most invested. That is a tax on batching wearing a reward's
    clothes.

  It also pulls against the item below: a faster strand is a shorter window for
  the same gesture. The cheaper lever for the same target is already named —
  `patienceMs` against what a ladder costs in trip time — and it is one number
  in one table. **Retune and measure first.** If trip time is still binding
  afterwards this comes back **bounded**: the ramp's `moveIntervalMs` is the
  slow end, length pulls toward the existing 125 ms cap, and the cap stays
  exactly where design §7 put it. Early on that is a real reward (200 ms down
  toward 150); late on it offers nothing, which is the honest tension in it and
  the thing a sweep would have to answer.
- **Swipe steering lags the grid on a phone.** — **this is Phase 6's
  outstanding real-device pass reporting in, and it goes first.** Recorded
  there rather than here, since it is not a balance question.

Two of the six tax a long strand more than a short one, which makes five such
instincts across three sittings. Two of them push the other way, which is the
first time a sitting has produced more than one. The test is earning its place,
and it is still the first thing to check any difficulty proposal against.

**The order of attack is unchanged in its first step and gains two entries.**
Retune `patienceMs` and measure; build the combo *and* the rush against that
same sweep; and only if trip time is still binding does the speed candidate come
back, bounded. What has changed is that the first two things to actually do are
no longer balance work at all — the swipe and the expiry warning are Phase 6 and
Phase 7 items with playtest evidence behind them now, and both are cheaper than
anything in this paragraph.

## Phase 6 — Mobile & responsive (L) ✅

- Touch input: swipe adapter (dead zone, dominant axis, mid-drag threshold).
  The **virtual D-pad was dropped, not deferred** — see below.
- Replace fixed FIT with `Scale.RESIZE` + `ui/layout.ts` (landscape/portrait
  anchoring per architecture §9).
- Page hardening: the document-level half already sits in `index.html`
  (`touch-action: none`, `viewport-fit=cover`, no zoom, no pull-to-refresh),
  so what is left here is ≥44 px HUD hit areas.
- Real-device pass (at least one iOS Safari + one Android Chrome): input feel,
  perf (60 fps target), safe-area insets.

**Done when:** the same run is comfortably playable one-handed on a phone in
both orientations.

The code half is done and the geometry is covered by `ui/layout.ts`'s unit
tests plus smoke runs at 960×640, 390×844 and 844×390. **The real-device pass
is outstanding** — it cannot be run headless, and it is what the "comfortably"
in the criterion actually rests on. Until a phone has been held, this phase is
complete in code and unconfirmed in the hand.

A phone has now been held once, and it reported one thing. That is not the pass
— one player on one device is a data point, not a validation — but it landed on
exactly the risk this phase was told to check early and checked late. See "What
the first device report said", below.

### What the responsive pass settled

- **The board scales as one container; the HUD does not.** The board keeps
  drawing at a fixed `CELL_SIZE` in its own coordinates, and `BoardView` fits it
  to the device with a single position and scale. The alternative — computing a
  cell size per device and threading it through the render layer — was rejected
  on inspection rather than on taste: `CELL_SIZE` is the default scale argument
  of `makeSprite`, so it reaches every sprite in the game, and the accessibility
  symbols are deliberately baked at their display size (`GLYPH_SIZE`) so
  nearest-neighbour samples them 1:1. A per-device cell would have made the
  colorblind fallback of design §4 the thing that went soft. Architecture §9 has
  been amended to record the container model.
- **The HUD staying at native size is what makes a phone work at all.** It is a
  parallel scene with its own camera — a separation originally made so camera
  shake would not move the score (architecture §6) — and that is now also what
  keeps text legible and touch targets full-size while the kitchen shrinks.
- **Portrait puts the HUD either side of the board, not beside it.** A board
  that fills the width leaves no column, so score and lives take a band above
  and the rack and queue a strip below, with the rack right-aligned and the
  queue running back from it. A square board on a tall screen cannot use the
  whole height whatever it does; splitting the HUD spends that slack on both
  edges instead of leaving one dead band in the middle.
- **Two collisions only a phone-sized frame produces**, both found by laying the
  frames out across eight viewports rather than by looking at a screenshot: six
  rack slots at the desktop pitch run off the bottom of a phone in landscape
  (the rack now sizes itself to the run it is given), and the rack hung level
  with the bench is drawn straight through the hearts once the board rides high
  enough (it now clears the lives row). Both are asserted per viewport.
- **The ≥44 px hit-area item was already satisfied, and is worth recording as
  such rather than as work done.** Every interactive surface in the game is
  scene-wide: steering is a swipe anywhere (`input/swipe.ts`), and both message
  screens advance on a tap anywhere (`input/anyInput.ts`). There is no discrete
  tap target in the game to undersize. When Phase 7 adds the settings screen and
  the cheat-sheet tab, this stops being true and the floor has to be applied.
- **The D-pad is dropped rather than carried.** The plan put it "behind a
  setting" and the settings screen is Phase 7, so building it here would have
  meant a toggle with nowhere to live. Whether it is wanted at all is a question
  for the real-device pass, and if the answer is yes it lands beside the setting
  that switches it.
- **The swipe adapter needed no change *for the resize*.** `bindSwipe` divides
  pointer coordinates by `scene.scale.displayScale` to get CSS pixels, which
  under `RESIZE` is 1 — so the conversion degrades to a no-op and the thumb
  threshold stays the same physical distance it always was. That is a claim
  about scaling and it stands. It was read at the time as the adapter being
  *finished*, which is a different claim and not one this pass tested: what the
  threshold should be was never in question here, only that resizing did not
  move it. The first device report says the threshold itself is too long.

### What the first device report said — the swipe commits too late

It came in on the fifth playtest sitting, alongside five balance proposals
recorded under Phase 5.

**The complaint.** A swipe is a gesture with travel in it and the strand moves a
cell at a time regardless, so the turn lands a block past the one that was
meant. That is a touch complaint rather than a steering complaint — a key press
has no travel at all, which is why four sittings on a keyboard never raised it.

**What is and is not the cause.** Three things could produce it and only one is
likely.

- `SWIPE_THRESHOLD_PX` is 20 CSS pixels. A thumb covers that in something like
  50–100 ms; against the ramp's floor of 125 ms per cell, that is most of a cell
  travelled before the turn is even *recognised*. This is the suspect.
- Tick quantisation is already minimal and is not it: `advance` calls
  `takeTurn` before it moves anything, so a buffered turn is spent at the top of
  the move rather than waiting one out.
- The view interpolates between cells (`moveProgress`), so a turn that landed on
  time can still *look* late. This cannot be ruled out from a description and
  wants watching on the device rather than reasoning about here.

**What to try, in order.** Drop the threshold to 12–14 px — a tap jitters under
five, so there is room, and it is one constant with unit tests already around
it. Do **not** deepen the buffer: `MAX_QUEUED` is 2, and raising it makes the
game feel worse rather than better, because the extra turns it would hold are
ones the player has already stopped wanting. Then hold the phone again, which is
the half of this that cannot be done from here.

**It makes the D-pad question live for the first time.** This phase dropped the
D-pad with a condition attached — whether it is wanted at all is for the
real-device pass, and if the answer is yes it lands beside the setting that
switches it — and Phase 7 is building that settings screen now, so the decision
finally has somewhere to go. It is *not* made yet, and the order above is why: a
threshold that is simply too long is a swipe problem with a swipe fix, and a
D-pad added to cover for it would be the wrong answer permanently installed.

**It also pulls against the fifth sitting's speed candidate** — a faster strand
is a shorter window for the same gesture. Recorded in both places, because the
two would be worked by different phases and neither should discover the other
late.

## Phase 7 — Cheat sheet, hints & UX polish (M) ◀ current

- Collapsible mixing cheat sheet (edge tab, auto-collapse, persisted state) —
  the non-obstructive requirement from design §4, drawn as the wordless mixing
  wheel that section specifies. It is the only place in the game a recipe is
  shown at all, now that the queue holds none. **This one is built** — three
  jars with each pair's candy between them and a spoke from each jar to what it
  makes; see below. Persisted only as far as the page is loaded, which is where
  Phase 8 picks it up.
- (The three lessons are already carried by Phase 4's opening levels and what
  they stock — design §11 — so no toasts, no captions, no seen-once flags. That
  is the position the note under "Done when" now puts on trial.)
- Settings screen: sound, D-pad toggle, left-hand mode, high-contrast symbols.
  The D-pad's *existence* is a live question again rather than a settled one —
  the first device report (Phase 6) is the condition it was dropped under coming
  due. The swipe threshold is tried first; the toggle is only built if that
  leaves the gesture wanting.
- Juice pass: eat squash, chop pop + particles, shatter shards + camera shake,
  serve confetti, patience-bar urgency pulse, and the stale-candy toss off the
  rack (design §5) — `candy-staled` reaches `GameScene` today and plays nothing,
  which is why the first sitting could not tell whether the shelf was scoring
  for the player or against them. Now that the strand is drawn as one rope
  (design §2), stretching it along its travel axis as it is pulled belongs here
  too.
- **The urgency pulse is the one juice item with a rule attached**, and it has a
  playtest behind it now: the fifth sitting reported no warning at all before a
  child walks out. There is one — `ui/customerView.ts` swaps the face to
  `FaceWorried` at `IMPATIENT_AT`, 40% of the bar — so this is a legibility
  failure of something already built rather than a missing feature, and it is
  worth building against what is actually wrong with it.
  - **The stage that is missing is a later one, on an absolute clock.** 40% is
    the *mood* threshold and can stay fractional; the alarm cannot, because the
    ramp takes patience from 35 s to 22 s and a fraction therefore shrinks the
    warning exactly as the game speeds up. What the player is asking is whether
    they can still get there, which is a question in seconds — so the critical
    stage fires on remaining **ms**, at something like the last five.
  - **Motion is the whole point.** A texture swap is invisible in peripheral
    vision, and design §11 has the queue read in glances taken from steering.
  - **Design §2's comfort constraint binds it**: soft and slow, an alpha or
    scale breath rather than a hard high-contrast blink, and worth pulsing only
    the child who is actually in trouble — four alarms at once is noise, not
    urgency.
  - **`patienceFraction` stays untouched.** The bar and the score bonus read it
    together on purpose (design §9), so the alarm reads the clock beside it and
    never changes what a serve pays.
- Audio: SFX set + ambient loop, gesture-gated unlock, mute persisted.

**Done when:** a new player understands mixing without leaving the game, and
every core event has audiovisual feedback.

The first of those is the criterion at risk, and it now has evidence against it
from five players across four sittings, all of whom came through Phase 4's
opening levels first. One was "a bit confused at first, just chasing the colored
things". One understood the game but credited the other games they had played
for it rather than this one. The third asked, unprompted, for a picture showing
which color plus which color makes what — which is the mixing wheel design §4
already specifies, requested by someone who had just been taught mixing by three
scripted levels. The first two describe the *strand* failing to land as the thing
being produced; the third says the table did not stick either. Design §11's
position — that the opening levels teach on their own, with no captions anywhere
— is what is on trial here; if the cheat sheet does not carry the rest, that
position gives way before the criterion does.

The fourth is the one that has been answered rather than logged, and it is the
reason the position has not given way yet: that player drove at level 2's jar
over and over without ever taking a cube, which turned out to be a level offering
the wrong move rather than a player failing to read the right one (see the third
sitting, above). It was fixed by what the level stocks and when. That is one
comprehension failure traced to a board that could be re-authored — so before the
cheat sheet is treated as the fix for the other three, they are worth re-asking
the same question of.

The fifth says the same thing from a step further along, and says it about the
same level: a player who had *passed* level 1 kept crossing jars in level 2 after
the candy was already dyed, because the board kept laying them. Also answered by
what the level stocks and when (the fourth sitting, above). Two of the five
comprehension data points are now board-authoring bugs rather than evidence
against design §11 — which is the case for re-asking the other three, not for
declaring the position safe.

**A sixth player, in the fifth sitting, adds nothing to this count** — and that
is worth writing down rather than leaving as a silence, since every sitting so
far has added to it. They understood the game well enough to propose six changes
to it, so they are evidence neither for design §11 nor against it. The one thing
they could not read was the patience clock, which is a juice item on this
phase's own list and not a teaching one. The count stays at five players across
four sittings, and the case for re-asking the other three stands unchanged.

### What the cheat sheet settled

**The wheel is one number.** Three jars on a circle and each pair's candy at the
midpoint of the two that make it — which on an equilateral triangle is exactly
half the radius out — so the panel's whole size is a multiple of the node, and
fitting it to a phone is one `clamp`. That is `shelfRun`'s bargain again and it
is written the same way, because "shrink a run to the space it was given" is now
the second thing this layout has had to do and will not be the last.

**Two bugs the arithmetic caught that an eye would not have.** A triangle's
bounding box is *not* centred on the circle it is drawn on — it reaches a full
radius up and half a radius down — so the wheel had to drop a quarter radius
inside its own panel or the top jar sat outside it by about four pixels. And
bottom-anchoring the portrait panel to the board's edge pushed it three pixels
off the top of the screen on the smallest phone, where the band above the board
is 78 px and the wheel at its floor is 73. Both were found by the swept
assertions before any of it was drawn, which is the case for `layout.ts` staying
Phaser-free stated as a result rather than as a principle.

**The 44 px floor cost nothing, which was not the expectation.** Phase 6
recorded that the floor "has to be applied" once a discrete tap target exists,
and the obvious way to pay for it was to reserve a band and let the board
shrink. It turned out unnecessary: landscape boards are height-bound at every
viewport in the table, so the tab takes the frame's bottom corner beside the
serving column, and upright the header band is already 56 px. No board is a
pixel smaller than it was.

**Brown stays off the wheel, and now there is a measurement behind it.** The
centre of the wheel is where an over-mix belongs, but the results ring has to
move out to about 2.2 nodes before there is room — and mutating the spread to
2.2 fails the on-screen assertion on a 320×568 phone. Design §4 asks for six,
six is what fits, and the constant that would change is one line with a comment
saying this.

**Auto-collapse hangs off `DirectionQueue.push` and nothing else.** It is the
one place that knows a turn was *accepted* rather than merely pressed, and both
adapters converge on it, so the HUD learns "the player is steering" without
either adapter knowing the other exists. The rule it feeds — armed once on the
first turn, never restarted, latched after it fires, cancelled for good by a
manual toggle — is pure and unit-tested, and deliberately does **not** persist:
a courtesy collapse that was remembered would leave every player collapsed
forever a few seconds into their first game.

**The tab is the first hit-testable object in the game, and it needed a dead
zone rather than a flag.** UIScene and GameScene hold separate input plugins, so
pressing the tab does not stop GameScene's scene-wide swipe from seeing the same
pointer — a drag off the tab would have opened the drawer *and* turned the
strand. `bindSwipe` now declines to arm its tracker inside a rect the layout
hands it, which kills the whole gesture rather than its first pixels, so there
is no state to raise and forget to lower. GameScene reads the rect from the
frame it already subscribes to, so the one-way HUD direction survives.

**What is not yet known** is whether it teaches anybody anything. That is the
phase's own criterion, five players deep, and it cannot be answered from here.

## Phase 8 — Persistence, high scores & release (S)

- `persist/storage.ts` (versioned blob): high scores top-10, settings
  (wire-up — earlier phases used in-memory defaults). No seen-hints: the
  opening levels replaced them. The cheat sheet is the first of those defaults
  and names what it wants: two function bodies in `ui/cheatSheet.ts` read and
  write whether the player has asked for the wheel, holding it in module state
  so it already survives menu → game → game over → game. Pointing them at the
  settings blob is the whole of that wire-up, and nothing else about the sheet
  moves.
- Game-over score breakdown + high-score table on menu.
- Social-card meta and a lighthouse sanity pass. (Title and an inline favicon
  are already in `index.html`, and the Pages workflow has been deploying `main`
  since well before this phase — what is left is verifying that build on
  desktop and phone, not standing it up.)

**Done when:** the public URL serves the finished game; scores survive reload.

## Milestone summary

| Phase | Deliverable                              | Risk it retires                 |
| ----- | ---------------------------------------- | ------------------------------- |
| 0     | Running scaffold                         | Toolchain                       |
| 1     | Gray-box snake                           | Movement feel                   |
| 2     | Color blending on-screen                 | Core novelty works              |
| 3     | Chop → candies → shelf                   | Production loop                 |
| 4     | Full playable game (desktop)             | Is it fun?                      |
| 5     | Balanced endless ramp                    | Fairness / pacing               |
| 6     | Mobile parity                            | Touch feel, perf                |
| 7     | Teachability + juice                     | New-player comprehension        |
| 8     | Shipped URL                              | Release mechanics               |

## Risks & mitigations

- **Chop-mode feel** — *retired in Phase 3*, by dropping chop mode outright:
  the block cuts the strand loose and the maker never stops moving. The
  fallback held in reserve (instant chop, staggered animation) is close to
  what shipped, minus the freeze.
- **Swipe latency vs. grid ticks** — mid-drag threshold detection (arch §8);
  validate on real devices early in Phase 6, not at the end. **This one fired.**
  It was validated at the end rather than early, and the first device report
  (Phase 6) says the 20 px threshold commits the turn a block late. The
  mitigation was the right one and was simply not exercised in time; the fix is
  identified and is one constant. Open.
- **Color confusion for colorblind players** — symbols are in from Phase 2,
  not bolted on later.
- **Balance is opinion** — seeded simulations make tuning comparable
  run-to-run; keep all knobs in `difficulty.ts` + one tuning table.
- **Scope creep** — future ideas live in design doc §13; nothing from that
  list enters before Phase 8 ships.
