# Candy Snake — Implementation Plan

Phased so that **every phase ends in something runnable**, and gameplay-risk
items (does the core loop feel good?) are validated before polish is spent.
Sizes are relative (S < M < L), not calendar promises.

References: [game-design.md](./game-design.md), [architecture.md](./architecture.md).

> **Status: all nine phases are done** and marked ✅ below, and the game is
> served from <https://williamchong.github.io/candy-snake/>. What is still open
> is not a phase but a risk: the swipe threshold has had one device report and
> one fix since, and neither of those is the same as a phone having confirmed
> it — see the risk register at the foot of this file.
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

**Done when:** a decent player survives ~4–6 min on a first real run and
death feels earned (post-playtest judgment call), simulation asserts no order
is ever primary-starved, and the batching bot outscores the grinder.

That first figure read ~8–10 min until the seventh sitting, which retargeted it
against when the ramp runs out of new things to introduce rather than against
how long the curve can be made to take. The measurements below were taken under
the old target and are left as they were written; the seventh sitting's record
says what moved and why.

Two of those three are met. The third — the batching bot outscoring the grinder
— is **not**, and the balance record below sets out why it is a rules question
rather than a tuning one, along with the three candidate rule changes it opened
with — of which the sittings since have struck one, added three more, and hold a
fourth pending a measurement. It is carried forward as an open finding rather
than counted as done. The human playtest half of the first criterion has now had
seven sittings, and none of them answered that half — nobody has played long
enough to die. They answered other things instead, including the open finding
arrived at from the far end, three times, by three different players. The five
records below are this phase's; the sixth and seventh sat late enough to be
recorded under Phase 7, and the seventh is the one that moved this criterion's
target from ~8–10 min to ~4–6.

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
  `candy-staled` reached `GameScene` and played nothing, so a candy pushed off a
  full rack went in silence. Design §5 already asks for the toss, and Phase 7
  already owned it; this was that item with a playtest behind it. **Done** — see
  Phase 7's juice bullet, including what building it turned up.
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
  there rather than here. **Built** — and not as a flash: the player asked for
  the loudest thing they could name, and what the rule asked for was the softest
  one that still moves.
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
  asked for by three players in three sittings. Built; see the combo-meter pass
  below.** The scope shipped is the one this entry spelled — a serve counter on
  `Severed`, the term in `core/scoring.ts`, and the meter the second sitting
  called the load-bearing half. It did **not** close the open finding, and the
  measurement says no constant could. The second sitting's objection ("it pays
  for a batch nobody can currently afford to build") had expired by the seventh;
  what replaced it is a plainer problem, which is that the grinder does not die.

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

**Those first two are now done**, along with the stale toss the first sitting
asked for, which is why they are struck from the front of this order rather than
still standing at it. What is left in the paragraph above is the balance work,
and it is next — starting where it always did, at `patienceMs`.

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

**The first half is done: the threshold ships at 13 px.** Not 12, and the reason
is in the tests rather than in the thumb — `swipe.test.ts` asserts that a drag of
12 px on the dominant axis stays inside the dead zone, and that case is a
deliberate one. 13 is inside the range this report asked for and still leaves
better than twice the jitter of a tap under it. The buffer was left at 2.

**The second half is still owed, and cannot be done from here.** Nothing about
this is settled until the phone has been held again: whether the turn now lands
on the cell it was meant for, and whether any of the complaint was the view's
interpolation rather than the threshold — the one cause on the list that a
description could not rule out.

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

## Phase 7 — Cheat sheet, hints & UX polish (M) ✅

- Collapsible mixing cheat sheet (edge tab, persisted state) — the
  non-obstructive requirement from design §4, drawn as the wordless mixing
  wheel that section specifies. It is the only place in the game a recipe is
  shown at all, now that the queue holds none. **This one is built** — three
  jars with each pair's candy between them and a spoke from each jar to what it
  makes; see below. Persisted only as far as the page is loaded, which is where
  Phase 8 picks it up.
  - **The auto-collapse is gone**, asked for from the chair: the wheel is shown
    unless the player has hidden it. See the ninth sitting. It took the tested
    `SheetState` half of the file with it — visibility stopped being a rule with
    a decision in it — and the `DirectionQueue` → `UIScene.steered` channel
    too, which existed for nothing else.
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
  rack (design §5). Now that the strand is drawn as one rope (design §2),
  stretching it along its travel axis as it is pulled belongs here too.
  - **All seven are built.** The urgency pulse and the stale toss went first,
    being the two with a player behind them rather than only a checklist entry;
    the other five landed together in the pass recorded below.
  - **The toss taught the list something.** `candy-staled` fires once per candy
    pushed off, and one chop can overflow a full rack several times inside a
    single tick — and every one of those candies leaves the *same* slot. Played
    straight they superimpose, so eight losses read as one, which is the very
    illegibility the effect was added to fix. The tosses are staggered by how
    many are already in the air — capped, because the stagger drains slower than
    two batches coming apart can fill it. Any later effect that plays per-item
    off a single event has the same trap under it: the chop pop is per-cell and
    so is safe, the serve confetti is per-customer and so is too.
  - **A pooled HUD effect is not a pooled board effect.** The board's puffs
    ride inside `BoardView`'s container, so a resize moves them with everything
    else; the rack has no container, so a toss in mid-air is aimed at
    coordinates the next `applyFrame` invalidates — and `Scale.RESIZE` fires
    that on every frame of a window drag. It cuts them instead. Worth knowing
    before the next effect is hung off the HUD rather than the board. This is
    now a constructor argument rather than a footnote: `Burst` takes a
    container or does not, and a host without one calls `clear` from its own
    `applyFrame`.
- **The urgency pulse is the one juice item with a rule attached**, and it has a
  playtest behind it now: the fifth sitting reported no warning at all before a
  child walks out. There is one — `ui/customerView.ts` swaps the face to
  `FaceWorried` at `IMPATIENT_AT`, 40% of the bar — so this is a legibility
  failure of something already built rather than a missing feature, and it is
  worth building against what is actually wrong with it. **Built to the four
  rules below, unchanged** — below `CRITICAL_MS`, 5 s, the bubble swells up to
  12% and settles again on an 800 ms cycle, and nothing else on the child moves.
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
  - **The bubble breathes and the candy inside it does not.** The order is the
    one thing in the queue the player has to actually read off a glance, so the
    motion is put on the frame around it rather than on it.
- Audio: SFX set + ambient loop, gesture-gated unlock, mute persisted. **All of
  it is built**, which is what finally makes the criterion below true. The bed
  came second and on its own, so it could be judged by ear without unpicking the
  cues. See the audio pass below.

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

### What the sixth sitting settled — the window was not at the bench

One question, and it is the whole finding: *why are the customers not waiting
near the cutting counter?* They were not. The block cuts on rows 2–4 of the
right wall — the top of it — and the standing line was pinned to the bottom of
the kitchen, so on a desktop frame the child stood some 340 px below the bench,
with the rack and the cheat sheet filling the gap. Design §2 and §5 both say the
window is beside the block; **this was the layout disagreeing with the docs, not
a decision anyone had made.** The line is the block's own last row now, and the
rack takes the column below it.

**It cost nothing in the queue's own code, because a customer has no position.**
`Customer` is `{ id, want, patience }` and always was, so where a child stands
is HUD geometry and one anchor in `ui/layout.ts`. The line also stays
*horizontal*, which is what kept `CustomerView` out of the diff: children walk
along x, and a vertical line would have meant rewriting the walk, the door and
the step-out-of-lane on a second axis to gain nothing the swap gives for free.

**The column is oversubscribed on the smallest phone sideways, and always was.**
At 568×320 it has to hold the score, the hearts, a child (112 px of bubble, body
and walk-off lane), six rack slots (106 px at their floor) and a cheat sheet
(73 px) in about 290 px of height, with only the rack and the sheet able to
share a row. Moving the taller thing to the top costs more than the column has,
so the standing line is fenced on both sides — no higher than the hearts allow,
no lower than leaves the rack its floor — and where the two fences cross, the
rack wins and the bubble is what overlaps: a rack drawn off the bottom of the
screen is not a crowded HUD but a missing one. The alternative was a second
landscape arrangement, which is two layouts to keep true rather than one.

**The review caught two things the screenshots did not.** `hud.shelf.at` is the
first slot's *centre*, not the rack's top edge, so budgeting the child's
clearance against it left the top slot half a slot too high — on every desktop
and tablet frame the patience bar drained straight across whatever candy was
racked there, invisible in a screenshot because the opening levels have no
clock. And the rack, now hung off the window rather than off the board, no
longer had the board's own bottom bounding it: on a phone sideways with a home
indicator it ran into and past the safe area. Both are why the standing line is
clamped from below as well as above, and why `layout.test.ts` now asserts
against the child's *bar* rather than the line they stand on.

**A constant set by eye was wrong by twelve pixels, and only this move exposed
it.** `CHILD_HEADROOM` claimed a child needs 78 px above their standing line;
`customerView.ts` puts the bubble's box 90 px above it. Nothing had ever been
placed against the top of a child before — the rack cleared them from below —
so the error was invisible until the hearts landed on it, which they did
immediately on a phone held sideways. It is measured from the view's own
constants now, and the lives row moved up 8 px to pay for the difference.

### What the seventh sitting settled — the window never filled

One report, from a player 481 points into a run: *the customers still appear
just one by one, and the difficulty is too easy.* Both halves were true, and the
first is the cause of the second.

**The queue could never hold more than one child, on any seed, at any point on
the ramp.** `admitCustomer` counted a flat interval and reset it on every
arrival, so children came on a metronome whatever the window held. The queue can
only grow when the maker serves *slower* than the interval — 8.8 s at the point
this player was reporting from — so any competent maker emptied the window and
kept it empty. Design §7 has said "max queue 3" since Phase 4 and **nobody had
ever seen it.** Simulated at 2.5 s, 3.5 s and 5 s per serve, the peak queue depth
over twelve minutes was 1, 1 and 1.

**That is also the second sitting's finding, arrived at from the other end.** A
player who asked *"do I have a reason to make the strand longer?"* was looking at
a window showing one order. A nested ladder is a bundle aimed at several orders
at once; against a window of one there is nothing to aim it at. The economic
reading of the open finding — the extra candy is candy nobody ordered — had a
mechanical floor under it the bot sweeps never showed, because the sweeps
measured score and sell-through and never once measured **queue occupancy**.

**A second lever was inert for the same reason.** `rampMs` takes
`max(elapsedMs, served × 6000)` so that a fast player is not held back by the
clock — but no player can serve faster than children arrive, so `served`
converges on `elapsed / arrivalInterval`, and the serve term can only win when
the interval drops under 6 s. It does not until the 3-minute mark. Measured: at
94 s of play the ramp also read 94 s. Serving briskly bought **nothing**.

**The fix is one expression.** The gap is a share of the interval scaled by how
full the window is, so `arrivalIntervalMs` now means the gap with one slot left
to fill and an emptier window fills proportionally faster. Counting `length + 1`
rather than `length` is load-bearing twice over: a window with no interval stays
shut (`Infinity × 0` is `NaN`, which would admit everyone, where `Infinity ×` a
positive share is still `Infinity`), and the tutorial's one-slot window comes out
bit-identical, so the opening levels needed no special case.

**The anchor table was not touched.** Over the 16-seed sweep, batching runs
closed out 14/16 → **16/16**, median death 8.4 → **5.1 min**, and the grinder —
immortal on every seed through six sittings — now dies on 4 of 16. The serve-driven
lever woke up on its own: a maker serving every 2.5 s is at the Rush row's demand
by real-minute 2.

**The 8–10 minute target did not survive the question "is that fun, or is it
labour?"** It does not, and the ramp table says why: every lever that introduces
a *kind* of thing is spent by the 3-minute mark — max queue is done at 2 min, the
order mix and the speed cap at 3 — and past those exactly two numbers move,
patience and the arrival interval, neither of which adds anything to do. Minutes
3 through 10 were one number getting smaller. **Six sittings and not one player
has ever played long enough to die**, which is the same verdict from the chair:
the figure was calibrated against bots, and bots do not get bored. The target is
**4–6 minutes** now — a minute or two past the last lever, so the peak is played
at full intensity rather than approached and then endured, and a retry is a
decision rather than a commitment.

To be plain about the order of events: the retarget and the measurement agree,
but the fix was not tuned to hit 4–6. It landed there with the table untouched,
and the target was then argued from the levers rather than from the number.

- **This does not close the open finding, and it moves it for the first time.**
  The batching maker now outscores the grinder on 1 seed of 16, against 0 before
  — a deeper window gives a fixed bundle more targets to land on, which is
  exactly the compounding the first sitting predicted and the record dismissed as
  measured-one-at-a-time. One seed is not a closure. `simulation.test.ts` says so
  in the assertion it now makes: the score comparison was a per-seed invariant on
  four seeds and has become a proportion on sixteen, per that file's own rule
  that four seeds cannot carry a rate. Closing the finding still means this
  number crossing half and the assertion inverting, not the assertion going away.
- **If longer runs are ever wanted, the answer is a new element past 3 minutes,
  not a gentler curve.** The candidates are already on the list and unchanged:
  the combo meter (asked for by two separate sittings) and orders that ask for a
  nested set. Both add something to do at the point the table currently runs out.
- **The bot harness still cannot see the thing it was blindest to.** The second
  sitting noted the bots never feel the patience clock; this sitting adds that
  they never reported the queue they were standing in front of. Both gaps were
  found from a chair. A sweep that asserts a death rate and a score gap can be
  entirely green while a headline mechanic is dead on the board.

### What the sugar-supply pass measured — the harness has never built a long strand

A proposal from the chair: more than one sugar cube on the map later on. It is
the first lever anyone has aimed at the *temporal* half of the open finding that
is not `patienceMs`, and it has a mechanism in the code rather than only in the
argument. `missingPickups` lays a cube only when none is on the map, and a pickup
is spent only once the **whole strand** has cleared it (design §5) — so the Nth
segment costs a trip to the cube *plus* N moves of dragging before the next cube
exists at all. Growth is quadratic in length: a six-rung ladder is ~69 moves,
near ten seconds at the Settled row, before a single jar. Raising the floor
deletes that N term, and it is the rare proposal that makes a long strand
*cheaper* — the five harshening instincts recorded across three sittings all
push the other way. It is also the fifth sitting's held speed candidate in the
one shape that does not punch through the 8 cells/s cap or the 125 ms teleport
floor.

It was built as a quota (`ensurePickups` counting cubes rather than switching
them), a `sugar` column on the anchor table, and a term that counts a cube the
strand is still dragging as already spent. Four arms, plus the `patienceMs`
retune the order of attack has had at its front since the second sitting, over
the same sixteen seeds:

| Arm                           | deaths | median | past 7 min | **batcher ahead** | chopped/min | staled |
| ----------------------------- | ------ | ------ | ---------- | ----------------- | ----------- | ------ |
| baseline                      | 16/16  | 5.12   | 2/16       | **1/16**          | 22.5        | 56     |
| cube while dragging           | 16/16  | 5.33   | 2/16       | **0/16**          | 22.3        | 56     |
| 1 → 3 cubes up the ramp       | 16/16  | 6.84   | 7/16       | **1/16**          | 26.1        | 84     |
| both                          | 15/16  | 6.70   | 6/15       | **0/16**          | 26.5        | 91     |
| patience +15% (Settled, Rush) | 16/16  | 6.10   | 4/16       | **0/16**          | 22.7        | 65     |

**Nothing shipped, and the reason is the column that was added to find out.**
The sweep now reports how long the strand actually gets, which no sweep ever has:
the batching maker carries a mean of **1.20 segments** and has never in sixteen
seeds exceeded **4**. Tripling the sugar on the floor moved that mean to 1.29.
Supply was never what bound it — `batcherGoal` sizes its batch from `bestLadder`,
which is the primaries of one waiting order plus the raw beneath them, so the
tallest thing any order can ask for is two dyes over a raw. The bot never *asks*
for a fourth segment; four is simply the most it has ever ended up carrying.

**So the verdict is not "the lever is worthless", it is "this harness cannot be
asked".** The proposal is about what a *long* strand costs, and the bot standing
in for the maker who builds one has been building three. That is the third time
the harness has been blind in the same way — the second sitting found the bots
never feel the patience clock, the seventh that they never reported the queue
they stood in front of, and this pass that they never wanted the strand the whole
open finding is about. All three were found by asking the sweep a question it had
not been built to answer, and none of them showed up as a failing assertion.

What the arms *do* say is worth keeping. Three cubes on the floor buys the maker
16% more candy a minute and 50% more staling, and pushes the median run from 5.1
to 6.8 minutes with 7 of 16 past seven — an easier, longer run producing more
candy nobody ordered, which is the economic half getting worse while the temporal
half stays untouched. And the retune at the front of the order of attack was
measured on the same draw for the first time: **+15% patience moves the open
finding not at all** (1/16 → 0/16) and costs half a minute of the death target.
The first step in that paragraph has now been tried and it is not the answer
either.

**Two assertions survive the pass**, both pinning what was measured rather than
what was hoped: the window reaches all four slots on every seed of the draw, and
the batching maker's strand stays under two segments on average and never passes
four. The second says in the file itself that a green sweep here is evidence
about a maker who batches three and about nothing longer.

**Before any of this is retried, the ceiling comes first.** A bot that builds
ahead of the window rather than for the order in front of it is what would make
the question askable, and it is a change to `bestLadder`, not to the game. After
that, both bots need to take the *nearest* cube rather than the first in the
array — inert while the floor is one, since with a single cube on the map they
are the same cube, which is exactly why it can be done ahead of time and proven
not to move a number. Only then does a sugar column mean anything. The candidates
that add something to do past three minutes — the combo meter and the rush — are
unaffected by all of this and are still the ones on the list.

### What the eighth sitting settled — the rush is built, and a jar was immortal

Two reports from one player, 1225 points into a run: *the game feels stale*, and
*a dye that spawns near the cutting table doesn't go away after use*. They turned
out to be the same complaint twice, which nobody expected and which is the most
useful thing this sitting produced.

**The jar was the stale part.** `recloseAbandonedPickups` closed every open
pickup the strand no longer covered, and a chop severs the *whole* body, so the
snake is head-only the instant it reaches the bench. A jar on the cell before the
block therefore kneaded the segment behind the head and was then re-closed by the
chop itself — paid out and still standing, every pass. That is a two-move grind
loop beside the bench with free dye in it, which is a description of stale
gameplay rather than a bug next to it. And rule 2 of §8 caps dye at one jar per
primary, so the immortal jar held its color's only slot: `starvedPrimaries`
counts a jar on the map as satisfying the need and `endlessStock` lays nothing
while any dye exists, so the pity spawner could not lay that primary anywhere
reachable for the rest of the run. **A cube is re-closed and a jar is spent**,
because a cube pays at spend time and a jar pays at knead time — see design §8.

**The rest of the staleness is the seventh sitting's, confirmed from a chair
that had not read it.** 1225 points is 16–18 serves, and `rampMs` takes
`max(elapsed, served × 6000)`, so that player was at *minimum* ramp-minute 1.7
and in practice past three. Which is exactly where the record already said the
table stops introducing things.

**So the rush was built.** Design §7 carries the shape and the measurements; what
belongs here is what the sweep said, including the thing it said first.

Every figure below is measured against a **re-baselined** sweep, and that has to
be said before any of them are read. The jar fix changes when a pickup is
spent, which changes when the next one is drawn — and this file has had to note
three times already that anything moving a spawn re-rolls every free cell drawn
after it. The batching maker's median death reads **5.80 min** with the rush off
and the jar fixed, where the sugar-supply pass recorded 5.12 with the jar still
immortal. That 0.7 is the re-roll and the exploit going away, not the rush,
which was not in the build for either number. The rush is measured against 5.80.

- **A rate-neutral tide made the game easier.** Arrivals at 0.8× in the lull and
  1.5× at the peak — mean rate 1.04, balanced on paper — moved the batching
  maker's median death from 5.80 min to **6.6**. The cause is `admitCustomer`:
  it stops admitting at `maxQueue`, so surplus rate at a peak is clipped the
  moment the window fills, while every millisecond of a longer lull is recovery
  time paid to the maker in full. **The lull is the expensive half.** Nothing in
  six sittings of tuning notes had said this, because nothing had ever varied
  arrival rate *within* a run before.
- **Tuned to 0.95× / 2.6×, the curve did not move.** 5.79 min median against a
  no-rush 5.80, 16/16 closed out either way, 2 of 16 past seven minutes either
  way. The anchor table was not touched, again.
- **And the tide is visible on the board, which is the claim that matters.**
  Mean queue occupancy over a period swings 2.64 → 3.37 and arrivals 12.6 → 16.4
  a minute, against 2.60 → 2.67 with the rush off. That is the measurement the
  seventh sitting invented (`peakQueue`) being asked a question it was built for.
- **It does not move the open finding, and the harness is why.** The batcher is
  ahead on **0 of 16 with the rush in and 0 of 16 without** — on the re-baselined
  draw, where the 1 of 16 the seventh sitting won is one of the things the
  re-roll took back. So the rush neither gained nor cost anything here. The whole point
  of a telegraphed rush is building a ladder *into* a peak that has not arrived
  yet, and `batcherGoal` sizes its batch from the window in front of it — it
  cannot want a candy for a child who is not there. **This is the fourth time the
  harness has been blind in the same direction**, after the patience clock
  (second sitting), the queue (seventh) and the strand length (sugar-supply
  pass). The `bestLadder` change that pass already listed as the prerequisite is
  now the prerequisite for two separate measurements.
- **The doorway crowd is the half that cannot be measured from here.** Whether
  nine seconds of warning is enough to act on, and whether anyone reads the
  doorway at all, is a chair question. Every sitting so far has answered
  something nobody asked, so it will probably not be that.

### What the ninth sitting settled — the rush was waiting in the wrong place

Two reports again, and again one of them was not the one anybody was braced for:
*always show the colour wheel unless I hide it*, and **the game feels stale at
~400 points**.

**The staleness report moved, and that is the whole finding.** The eighth
sitting's came at 1225 points and the tide was built for it, starting where the
anchor table stops introducing things — the Rush row, three minutes. This one
came at 400. Measured on both reference bots across the sixteen-seed sweep, 400
points is reached at **ramp-minute 0.5–0.6** (clock 0.7–0.8), which is five or
six serves past the handover: the flat stretch being complained about is the one
*before* the tide, not the one after it. The eighth sitting reasoned from 1225
points to "at minimum ramp-minute 1.7 and in practice past three" and got the
right answer for that report; nobody then asked what the same arithmetic says
about a smaller number, and the answer is that most of a run was flat.

So the tide moved to `SETTLED_MS`, which is where the speed ease-in ends and the
ramp proper begins. It is a one-constant change — `RUSH_FROM_MS` had been read
off `RAMP[2]` and now reads off `RAMP[1]`, so the anchor table was not touched
for the third time running.

- **The opening minute is deliberately still flat.** It is the speed ease-in,
  and a tide laid over a strand still being brought up to pace is two things
  moving at once with no way to tell which one bit.
- **It moves the curve, where the tide going in did not.** Batching maker's
  median death **5.79 → 4.66 min**, 16/16 closed out either way, deaths running
  3.7 … 7.7 against 3.2 … 7.8. Still inside the 4–6 window, and it is the first
  change in three sittings that was allowed to spend some of that headroom
  rather than being tuned to cancel — a shape the player meets a minute in is
  one they then have to hold off for the rest of the run.
- **Four candidate start points were measured, not two.** Ramp-minute 3
  (5.79 median), 2 (4.95), 1 (4.66) and the handover itself (5.94). The
  handover reading *easier* than minute 1 is the eighth sitting's asymmetry
  again — down there the baseline interval is 12 s and even a 2.6× peak does
  not fill a three-slot window, so all the tide buys is lull. Minute 2 measured
  marginally better than minute 1 on every axis, and was not taken: it is a
  number between two anchors, where `SETTLED_MS` is a row of the table, and this
  file has said three times that the tuning should be one thing to read.
- **The only assertion that moved was a floor, and it moved for an arithmetic
  reason.** `batcher.ladders > 30` reads 29 now, because a run that ends a
  minute sooner makes a minute fewer cuts. Lowered to 25, against a grinder's
  4 … 10 — the separation is what the number is for, and it is still 2.5×.

**The colour wheel now stays up until the player puts it away.** Design §4 had
it auto-collapse a few seconds after the first turn, which is what
"non-obstructive" was originally read to mean. From the chair it read as the
game confiscating the one reference it has: the panel is semi-transparent, sits
outside the play grid, and *what makes purple* does not stop being a question
once a player starts steering. The tab is how a player who disagrees puts it
away, and that choice was already remembered.

- **It took a tested rule out of the codebase, which is the right direction.**
  `SheetState` existed because *when the sheet hides itself* was a decision with
  a countdown, a first-turn arming rule and a "settled" latch in it. With the
  countdown gone there is no decision left — only a remembered preference — so
  the class, its test file and the carve-out for it in `CLAUDE.md` all went.
- **And a whole one-way channel with it.** `DirectionQueue.onAccepted` →
  `GameScene` → `UIScene.steered()` → `SheetState.steered()` existed for this
  one consumer. Left wired to nothing it would read as a feature.

### What the score-ramp pass measured — the curve keys on the score now

Not a sitting: one question from the same chair as the ninth, and it turned out
to have a measurement behind it that nobody had taken — *can the difficulty
curve key on score instead of time?*

**Half of it already did.** `rampMs` has taken `max(elapsed, served × 6000)`
since Phase 5, so a count of serves was already pulling the curve ahead of the
clock. The question was really whether *score* was the better of the two
progress measures, and that is answerable rather than arguable.

**Traced, score is the steadier measure — which nobody expected.** Sampling
endless score against ramp position across the sixteen-seed sweep:

| ramp | batcher score | ms/point | grinder score | ms/point |
| ---- | ------------- | -------- | ------------- | -------- |
| 1.5m | 1108          | 81.3     | 1321          | 68.2     |
| 2m   | 1623          | 74.0     | 1806          | 66.4     |
| 3m   | 2570          | 70.0     | 2826          | 63.7     |
| 4m   | 3465          | 69.3     | 3910          | 61.4     |
| 5m   | 4445          | 67.5     | 4906          | 61.1     |

Two bots that serve at very different rates agree on ms-per-point to within
about 10% from ramp-minute 1.5 on. So **70 ms per point is a fitted number, not
a chosen one**: it is where the score term delivers the curve the serve term
delivered.

- **The swap on its own is not a rebalance.** Batching maker's median death
  4.66 → 4.67 min, 16/16 closed out either way. That was the calibration target
  and it is the whole reason 70 was picked over anything else.
- **Then the review found the bug the swap had exposed, and the median moved.**
  `rollWant`'s brown-mercy gate read `endlessMs >= SETTLED_MS` — the raw clock —
  while its own comment said "held back until the ramp has settled" and every
  other reader of that anchor goes through `rampMs`. The two questions were
  nearly the same while the clock and the curve tracked each other. They are not
  once score drives the curve: a maker scoring well crosses the settled row
  first, and the old gate held their mercy back from exactly the player the rest
  of the ramp had already moved on. Fixed, and the median reads **5.16 min**,
  because a mercy customer is a free serve and strong scorers now get theirs
  earlier. Both arms re-measured with the gate fixed: **4.66 (serve count)
  against 5.16 (score)**, both inside 4–6. Nothing above this line was measured
  on that draw — the fix moves an rng draw, which re-rolls everything after it,
  for the fourth time in this file.
- **It tightens the tail, and that survives the re-baseline.** On the
  mercy-fixed draw, runs past seven minutes 3 → 2 of 16 and IQR 4.3–6.7 →
  4.7–6.2 min — closing in from *both* ends. Score reads how well a run is
  *going* where a serve count reads how long it has been going on, so the runs
  that used to get away are the ones the curve now catches. That is the second
  finding back to back to come out of the tail rather than the middle.
- **Four calibrations were measured, and the grinder is the reason 70 won.** At
  85 and 100 ms/point the grinder — untouchable at 11.9 min for five sittings —
  comes down to 9.4 and 7.9 min, closing out 15/16 and 16/16. That is a real
  result on a real problem and it was **not taken**: it costs the batcher
  headroom (median 4.38 at 100, floor of the target window), and this file has
  said since Phase 5 that tuning until the *grinder* dies on schedule is tuning
  the game around the strategy it least wants to reward. Recorded here so the
  next person does not have to re-measure it — though these four were drawn
  before the mercy gate was fixed, so they compare with each other and not with
  the 5.16 above.
- **It does not move the open finding either.** Batcher ahead on 0 of 16 at 70
  and 85, 1 of 16 at 100 — noise, and for the reason the eighth sitting already
  gave: `bestLadder` cannot plan ahead of the window, so no ramp change can
  reach it. **Fifth time the harness has been blind in the same direction.**
- **The legibility argument is the one that is not a measurement.** The HUD
  shows a score and nothing else — there is no serve counter — so keying on
  score makes the ramp a rule the player can read off the screen. Design §11
  wants the rules legible and this is the one the whole run hangs on.
- **The curve advances in jumps now, and the telegraph is what that could
  cost.** A serve is worth up to 150 points, so it can move the ramp 10.5 s in
  one step — 17.5% of `RUSH_PERIOD_MS`, and the tide's phase is a modulo of ramp
  position. A single well-paid serve can therefore skip the doorway crowd
  forward through a fifth of the cycle, including out of the middle of a swell,
  and the nine-second warning `RUSH_SHAPE` is built around is the thing that
  gets shortened. It is monotonic, so the tide never runs backwards, and the
  serve count had the same property at 6 s a step — this is 1.75× that at worst.
  Whether it is visible from a chair is a chair question; it is written down
  here so that "the rush jumped out at me" is diagnosed rather than re-derived.
- **The double-count is the thing to watch from a chair.** §9 multiplies a serve
  by tier, by patience and by streak, so the spread per serve is 10 points to
  150 where the old count paid a flat 6 s for both. Playing well now pulls the
  curve forward, which is what keying on score *means* — but it also makes the
  streak bonus partly self-limiting, and whether that reads as pressure or as
  punishment is a chair question. If it reads as punishment, the fix is to key
  on base tier points and drop the multipliers, not to abandon score.

### What the juice pass settled — the view is a move behind, and it does not bite evenly

The five items with no player behind them, built together. Two things came out
of it that the next effect will want, and neither was on the list.

**The one-move lag is a hazard for anything fired off an event at a board cell,
and it hits the three of them differently.** `syncToState` draws the strand
*arriving* at the cell it already occupies logically, and holds pickups back a
move to match — which is why `flashHead` exists at all. So:

- **The chop pop needs no compensation.** The batch is `slides: false` and
  retargeted straight from state, so the candy the player was looking at leaves
  on the same sync the pop lands on.
- **The eat squash needs none either, and the reason is worth keeping.** A cube
  is not spent when the *head* reaches it — it is spent when the tail vacates
  its cell, which is what lets it appear to become the tail rather than vanish.
  The strand being drawn a move behind puts the cube's cell exactly where the
  strand is being drawn now. The two errors cancel.
- **The shatter needs a full move of hold.** The break is found after the move,
  so played on the tick it was reported the shards and the knock land a whole
  cell before the head is seen to touch anything. Two fields and a swap at the
  end of `syncToState`, deliberately not a queue with a delay on it: the hold is
  exactly one move and a general "play this later" is how it becomes two.
  `state.tick` advances once per grid move and `MAX_CATCHUP_MS` is under the
  ramp's floor of 125 ms/cell, so `syncToState` runs at most once per move and
  the swap cannot double up or be skipped.

**`camera.shake` takes a fraction of the viewport, not a distance.** Phaser
offsets by `intensity × width` and `intensity × height`, so one intensity gives
a 390×844 phone a 0.8 px knock and a 1600×900 desktop a 3.2 px one. Design §2
makes comfort a constraint rather than a polish item, and a constraint that
cannot be stated in pixels is one that cannot be held — so the budget is spent
in pixels and converted against the longer edge. Two pixels for an eighth of a
second. This is the first thing in the game to spend the parallel-scene split
architecture §6 bought precisely for it.

**A rope piece may never be drawn shorter than its cell.** The pull thins the
strand and the swallow swells it, and both had to be shaped around that: a piece
inside its own cell opens a gap at the joint with its neighbour, which is the row
of beads the continuous strand exists to replace. So the pull only ever
lengthens; an elbow, which has no single direction to lengthen in, takes the
across factor on both axes and has its shortfall covered by the overhang of the
straight beside it; and the eat squash swells *across only* rather than the
classic fat-and-short. It is the truer reading anyway — a cube going in is extra
sugar — and it is the exact complement of the pull, which is the same material
going thin. All three are unit tests rather than screenshots.

**What is left silent is now written down as deliberate.** `strand-cut`,
`dye-kneaded`, `sugar-spawned` and `dye-spawned` play nothing on purpose: the
block already speaks for a cut one candy per move, a knead recolors the segment
in front of the player, and a pickup appearing is a thing appearing. Design §12
asks for five effects and these are not among them.

**Two things a screenshot could not have settled.** The strand's stretch is 6%
at its peak and every segment sits at *exactly* resting size at both ends of a
move — sampled across the cycle, because a stretch still part-way applied when
the move ticks over snaps back at 5 Hz, which design §2 names as painful rather
than merely ugly. And a resize mid-cheer releases every confetti piece back to
the pool: `killTweensOf` does not run `onComplete`, so a piece left claimed is
one the pool can never hand out again — silently, with no console error for the
smoke driver to catch.

**The streak row reports the count, not the multiplier it earned.** The first
cut printed `best streak ×1.8`, which was wrong twice over. `scoreServe` is paid
at the streak standing *before* each serve, so a run of N serves tops out at
`streakMultiplier(N - 1)` and the row was a step high; and `STREAK_CAP` is ×2,
so every run of eight serves or more printed the same `×2.0` — flattening the
distinction on the one screen whose whole job is to tell two runs apart. The
count has neither problem and is the thing the player was counting anyway.

**Still a chair question.** The stretch is a feel item and the knock is a
comfort item, and neither is settled by a screenshot. If the rope's soft edge is
seen to crawl, the peak comes down before anything else is touched: on a roomy
desktop the board's container scale is exactly 1, so the sprites are sampled 1:1
and that is where an uneven texel row would show first.

### What the tenth sitting settled — the ceiling came up, and the tail is the cheap end

One proposal, aimed straight at the open finding: a **partial chop**. Keep the
front *k* segments attached to the head, sever the rest, so that a maker who
builds a long strand is not made to hand all of it over at once. It arrived with
the prerequisite already read and quoted back — *raise the bot ceiling first* —
which is the first proposal in this record to do that, and it is why this sitting
produced two results instead of one.

**The proposal's mechanism is sound and its economics are backwards.** Everything
it claimed about the code holds: `shatterAt` already slices at an index, so a
suffix cut is exactly what `sever` does for a self-hit; `consumeSevered` drains
by array position and needs no change; and the tutorial is untouched, because
`stocksSugar` restocks only on an empty strand, so an opening level's strand is
length 1 and `min(k, len - 1)` is 0. The objection recorded at `game.ts`'s
`cutAtBlock` really does only cover mid-strand removal.

What it misses is which end of the strand it keeps. `growTail` appends, so
`body[0]` is the **oldest** segment; a jar tints every segment that crosses it,
so the oldest has been through the most jars. The front of the strand is
therefore always the most-mixed — which is to say the **highest tier**. Against
`BASE_POINTS`, an `[orange, yellow, raw]` ladder is 50 + 25 + 10; keeping the
front two sells **10 of the 85** and banks the rest. Built and swept at
`CHOP_KEEP = 2`, `ladders` — then reading the colors of the batch alone — read
**0**. Not fewer multi-color batches: none. Every rung of variety stayed on the
head and only the raw bottom reached a customer.

That zero is also the sitting's first sighting of its second finding, and it was
read as a catastrophe before it was read as an instrument fault. Both are true:
the production line really did stop reaching customers, *and* `ladders` was
measuring the wrong thing the moment a chop stopped taking the whole strand. It
is re-cut below to read the batch plus whatever stayed on the head — under which
the same arm would score its variety honestly, and still lose.

And `blend` is a bitwise OR, so a retained segment can never lose a primary,
while every jar crossed to build the *next* ladder pushes it up. Brown drift is
not a risk to watch, it is a ratchet with three clicks in it, and brown is
`tier: 'mistake'` — servable only through `rollWant`'s mercy path, which wants a
brown already racked, a settled ramp, and a roll. The rest of the time it holds
a rack slot until it stales something out.

**The cut that would pay is the one the geometry forbids.** Selling the dyed head
and keeping the raw base is removal of a *prefix*, which leaves the retained
segments a gap behind the head — the teleport `cutAtBlock` refuses. Suffix
removal is safe and sells the cheap end; prefix removal sells the dear end and
breaks follow-the-leader. There is no third cut. That is the sentence design §5
was missing and now carries.

**A second thing falls out of the block being three cells tall.** `cutAtBlock`
fires every move, so under `min(k, len - 1)` driving *along* the column shaves a
segment a move: measured, a six-segment strand entering at the top leaves the
block empty three cells later, in three separate severed pieces. That is the
bench-riding variant the proposal deliberately deferred, arriving unasked and
undocumented, and it would ship two visually identical chop verbs with different
outcomes. Any partial chop needs a decision there first; the arm below took the
guard (one visit is one chop, tested off `before.head`) so the measurement was of
the cut and not of the accident.

**Then the ceiling, which is the half that shipped.** `bestLadder` sized a batch
from the primaries of one waiting order plus the raw beneath them, so the bot
could not ask for a fourth segment — the fifth time this harness has been blind
in one direction, and the prerequisite this record has been carrying since the
sugar-supply pass. Two changes lift it. A rung can carry **more than one
segment**: the color system caps *distinct* rungs at four, so height has to come
from repeats, and a dye sequence alone could not say so. And the plan runs
**past the window** — speculative segments valued off the stage's own mix
(`demandFor`, which is `rollOrder` read backwards) against every mouth the batch
could still reach, the slots left to fill *and* the room on the rack, since a
candy nobody wants now is racked and the next child sweeps the rack first.
Stacking is bounded by the binomial tail rather than a chosen cap: a second red
only pays if a second child wants red.

Only jars the floor can supply are planned around. A waiting order has the pity
spawner's promise and is worth circling for; a guess has not, and level 1 stocks
no jars at all — without that test the maker circles forever waiting on a jar the
level will never lay. It cost a sweep to find, and it is the same shape as every
other finding here: the bot wanted something the board had no way to give.

Measured over the sixteen seeds, before → after:

| reading               | before | after |
| --------------------- | ------ | ----- |
| batch at the bench    | 2.32   | 2.96  |
| carried, mean         | 1.22   | 1.94  |
| carried, peak         | 4      | 9     |
| batcher ahead (of 16) | 0      | 0     |

The last row is the one to sit with. Five sittings said the harness could not
be asked; asked properly, it gives the same answer it always did. **The open
finding is not an artefact of a bot that would not build** — a maker who builds
ahead of the window, for demand off the stage's own mix, still loses to the
grinder on every seed of sixteen. That is worth more than the 1-of-16 the old
bot occasionally scored, because it is now evidence rather than a ceiling.

**Two instruments had to be re-cut to survive that, and one to survive what comes
next.** `meanBatch` is new and is the length reading no sweep ever had.
`ladders` measures *variety* — a rung carried twice is the same color twice — so
it falls (11 … 28 against 32 … 51) while the strand gets longer; read the two
together or neither means anything. And both now read the batch **plus whatever
stayed on the head**, which is identical today and is there so a rule keeping
part of the strand back cannot quietly turn *how long a line did this maker
build* into *how much of it sold this trip*. `broken` moves off zero for the
first time — 3 across sixteen seven-minute runs, no seed contributing more than
one — so it is held under a ceiling instead: that is the cost `broken` exists to
carry, and a break every fifth run cannot account for the score gap — which is
**2.24×** in aggregate over the four seeds that assertion runs, and 2.64× over
sixteen.

**And a third instrument turned out to have been lying for several sittings.**
The 4–6 minute death target is read off the *median*, and the median was being
asked of sixteen seeds. Measured on one build, the batching maker's median death
reads **3.95 across `SWEEP` and 4.21 across sixty-four** — a quarter of a minute
apart, straddling the floor of the window the whole target is stated in. Sixteen
was chosen, correctly, as the draw that could carry a *proportion* where four
could not; nobody then asked whether it could carry a median, and it cannot.
Half the medians quoted in the sittings above were compared sixteen seeds wide
and read as curves that moved. Some of them were the draw. The assertion now
runs on a 64-seed `WIDE`, at about a second of suite time, and every median
recorded before this line should be read as ±0.3 min.

That is the fifth time a reading in this harness has been found answering a
different question from the one its name implies, and the second time in this
sitting. The pattern is consistent enough to be worth stating as a rule: **a
number is only evidence about the draw it was measured on**, and this file
should say which draw beside every figure it pins.

One consequence lands immediately. `peakQueue` asserted that both bots reach
every slot the ramp opens, on every seed; the batcher now misses on 1 of 16,
because the last widening is a *row on the ramp* and a run that ends at 4.2 min
never reaches it. The claim belongs to the maker who lives long enough to be
shown all four — the grinder, still 16 of 16 — and the batcher is held one slot
lower, with a second seed dropping being the window closing rather than slack.

Sixty-four is not a round number picked for comfort, either. Bootstrapped
against a 512-seed pool of batcher deaths (true median ≈ 4.41 min), the chance a
draw's own median falls under the 4-minute floor runs **12.3% at sixteen seeds,
6.4% at thirty-two, 1.8% at sixty-four** — and below sixty-four the sub-draw
medians are not even monotonic in the draw size, which is the noise announcing
itself. The true median sits about 0.4 min above a hard floor, so the draw has
to resolve finer than that or the assertion is measuring the draw. It costs
~14 ms a seed, and the median is now the largest single test in the project.

**With the ceiling up, the arm worth measuring was the one that keeps length and
hands the color back.** The proposal's insight is right and rare — make a long
strand *cheaper* rather than taxing it — and the record's own diagnosis says
where the cost is. So: sever the suffix, then scrape the retained stub back to
plain sugar. No ladder inversion, no brown ratchet, the whole batch still sold
oldest-first. Swept on the widened 64-seed draw against the same baseline, since
sixteen cannot read a median:

| arm                   | median | chopped/min | staled | batcher score | ahead (of 64) |
| --------------------- | ------ | ----------- | ------ | ------------- | ------------- |
| baseline (whole chop) | 4.21   | 23.1        | 2582   | 327 458       | **1**         |
| keep 1, color reset   | 4.08   | 18.2        | 1475   | 229 942       | **0**         |
| keep 2, color reset   | 2.64   | 13.0        | 619    | 73 662        | **0**         |

**Nothing shipped, and the monotonicity is the finding.** Every retained segment
costs, and it costs in a way the record had backwards. The sugar-supply pass
wrote that growth is quadratic in length because *the Nth segment costs a trip to
the cube plus N moves of dragging*, and read the cube trip as the expensive term.
A retained stub deletes exactly that term — the cube trips — and keeps the whole
of the other one, because a pickup is spent only once the **whole** strand has
cleared it, so every jar and every cube for the rest of the run is paid *k* moves
late. Candy a minute halves at `keep = 2`. **The dragging is the cost, not the
fetching**, and any future lever that means to make a long strand cheaper has to
touch how long a pickup takes to clear, not how many of them are needed.

**One correction to the eighth sitting.** It records the immortal jar as fixed by
a chop leaving the snake head-only. Traced under a partial chop, the jar beside
the bench is spent one move later rather than never: the fix lives in the
cube-versus-jar payment rule in `releaseAbandonedPickups` — a cube is re-closed
and a jar is spent — and it holds whatever the chop keeps back. The old wording
described the trigger, not the fix.

**What this unblocks.** The ceiling was the named prerequisite for two
measurements, not one: a sugar-supply lever means something now that the bot
walks to the nearest cube and can want a fifth segment, and the rush can be
measured against a maker who builds *into* a peak that has not arrived. Both were
recorded as unaskable and are now askable. The combo meter is unaffected by all
of this and is still on the list, with two players behind it.

## Phase 8 — Persistence, high scores & release (S) ✅

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

### What Phase 8 settled — the blob is one file, and the screens had to learn to flow

The wire-up was as small as the bullet promised: two function bodies in
`ui/cheatSheet.ts`, and the `let remembered` above them deleted. Everything that
took thought was somewhere else.

**The pure half and the browser half live in one file, not two.** Vitest runs in
Node and `localStorage` does not exist there, so the parsing and the ranking had
to be testable without a DOM. The instinct is to split the module in two;
architecture §3 says otherwise, because the finished file tree names exactly
`persist/storage.ts` and a file on disk with no entry in it means one of the two
is wrong. `ui/safeArea.ts` had already answered this: touch the browser only
*inside* a function body, guard it on `typeof`, and the module imports cleanly
under Node with its arithmetic exposed. One file, and the handful of functions
that reach for storage left to the smoke driver. The date pair moved in with it
for the same reason: `today` writes the format and `asDay` reads it, this file
is the one that declares what `at` is, and a format with its two ends in two
scenes that do not import each other is a format nothing holds to.

**A tie must not take the place it matched.** `insertScore` appends the new run
and sorts; `Array.prototype.sort` has been stable since ES2019, so an incumbent
on the same score stays ahead of it. The rank then comes from `indexOf` on the
entry itself — identity, not value — which is the only lookup that stays exact
when two runs are worth the same. A `findIndex` on the score would have handed
the newcomer the place its equal already held.

**Reading a field at a time is what makes the blob survive its own future.**
`Settings` holds one setting because one setting has a feature behind it. The
other three design names — mute, the D-pad, high-contrast symbols — will be
added to a blob that is already on players' machines, and the parse takes the
default for anything it does not recognise rather than rejecting the whole save.
The same pass sorts the table on the way in: it is displayed in stored order, so
"in order" has to be true of whatever was on disk, not just of what we wrote.

**Both screens had to stop placing rows at fixed offsets, for opposite reasons.**
`TextStack` scales a line that is too wide for the frame and knows nothing at all
about height, which was fine while every screen was four fixed lines.

- **Game over** is now half conditional — no tier row for a run that served
  nobody, no streak row, no rank for a run that missed the table — so the rows
  are stacked by the air between them and the block is centred afterwards. Fixed
  offsets left a run that scored nothing sitting above a hole where its
  breakdown would have been.
- **The menu** grew a list, and a list has a length that depends on the frame:
  ten entries fit a phone held upright and five fit one held sideways. The
  arithmetic went to `ui/layout.ts` as `scoreboard`, next to `screenCentre` and
  for the same reason `wheelSeats` is there — a widget's geometry, exported
  apart from the per-frame `Frame`, and swept across the eight viewports the
  layout tests already keep.

**The title is what gives way, not the table.** The first cut of the menu wore
"Candy Snake" off the top of a 568×320 phone, because a stack that is centred
vertically has no idea it has overflowed. So the whole screen is now laid out
*downward from the title*, the title's offset is clamped to what the frame
allows, and it drops to 40 px on a short frame. Of the two, the word the player
is already looking at is the one that can afford to shrink.

**A resize must not rebuild a stack of text objects.** `Scale.RESIZE` fires on
every frame of a window drag. The menu keys its stack on the layout it was built
for — title size, table top, pitch, count — and re-centres rather than rebuilds
unless one of those four actually moved, which across a full drag is a handful of
times rather than a hundred.

**What the smoke driver cannot see, a harness had to.** The driver boots a fresh
profile, so it only ever sees an empty table and never reaches the score screen
at all. The Phase 8 checks were a scratchpad harness instead: it seeds a save
blob before the page loads, shoots the menu at three viewports, and stands
`GameOverScene` up on its own `Phaser.Game` — imported from the dev server, so it
is the same module graph the app runs — to look at all four of best / placed /
missed / nothing without playing three lives away. Both directions of the
setting are checked separately, which matters: seeding storage on every
navigation makes a reload look like it remembered when it has simply been told
again.

**Two Lighthouse findings were fixed and two were left.** `#app` is a `<main>`
now (accessibility 70 → 77; the canvas is the whole of the page's content and a
screen reader should be told so). The `user-scalable=no` flag stays — design §10
needs the play area not to pinch-zoom under a swipe, and architecture §9 already
names it. `robots.txt` and `llms.txt` are reported missing by a preview server
that answers every path with the app; on Pages the game is served from a subpath
where neither file would be the site's anyway.

**The streak row reports the count, not the multiplier it earned.** The first
cut printed `best streak ×1.8`, which was wrong twice over. `scoreServe` is paid
at the streak standing *before* each serve, so a run of N serves tops out at
`streakMultiplier(N - 1)` and the row was a step high; and `STREAK_CAP` is ×2,
so every run of eight serves or more printed the same `×2.0` — flattening the
distinction on the one screen whose whole job is to tell two runs apart. The
count has neither problem and is the thing the player was counting anyway.

**Still a chair question.** Nothing here was tuned against a phone in a hand.
The table's floor of five entries on the smallest landscape frame is a guess
about how much of a menu is worth reading, and it shares its trip with the swipe
threshold the risk table has been holding open since Phase 6.

### What the audio pass settled — the criterion was never true

Phase 8 shipped and the plan was called done while the game was silent, under a
"Done when" that reads *every core event has audiovisual feedback*. That is what
this pass went back for. It also closes the last of the four settings names
architecture §10 was holding a seat for that had a design behind it.

**Cues are generated, not loaded.** `audio/tones.ts` describes eleven voices in
the units they are heard in — milliseconds and Hz — and renders one to samples;
`audio/kitchen.ts` wraps each in an `AudioBuffer` at boot and hands it to
Phaser's cache. That is `render/textures.ts`'s bargain a second time, and it
buys the same things: no assets to license or download, and a sound that can be
re-tuned in a diff. It also buys one thing textures never needed. Web Audio
stays locked until the player's first gesture (design §12), and `createBuffer`
works on a suspended context where `decodeAudioData` would have had to wait —
so the cues are ready before the menu draws rather than after the first tap.

**Almost none of the gesture-gating was ours to write.** Phaser's
`WebAudioSoundManager` already installs its own `touchstart`/`mousedown`/
`keydown` listeners and resumes the context on the first one, suspends on blur,
and gates every sound behind one global `mute`. The whole of design §12's
"starts only after first user gesture" is therefore a line of documentation
rather than a line of code, and mute is one assignment rather than a check
threaded through every cue — which matters because a check is a thing a cue
added later can forget to make.

**The stagger was the one real risk, and the rack had already found it.** Phase
7 learned that `candy-staled` fires once per candy pushed off and that a chop
can overflow a full rack several times inside one tick, so the tosses are spread
by how many are already in the air, capped. Audio needs that more than the eye
did: eight copies of one waveform starting together is not eight sounds, it is
one sound eight times as loud. The ear gets the rack's own numbers — 70 ms
apiece, capped at three — so the two can never disagree about how many were
lost. The chop pop takes the same treatment with a whole tone added per copy,
which turns a batch from a thud into a count.

**Two cues carry information the screen cannot.** The serve chime climbs one
step per consecutive serve and stops climbing at eight, where design §9's ×2 cap
lands: the streak is the one number on the HUD a player cannot look at, because
the queue is read in glances taken from steering (design §11). And the three
dye jars get three pitches, so a pickup is confirmed without leaving the strand.

**`cueFor` is a third switch over `GameEvent`, closed like the other two.**
`GameScene.play` and `UIScene.play` both end in `event satisfies never`; the cue
table does too, so a new event member is a compile error in audio as well rather
than a silence nobody notices. The silences are deliberately the same ones the
board keeps, plus `debris-crumbled` — it fires once per block of a severed
strand and the crack has already said what happened.

**The tests are the interesting half, because they had to be.** The smoke driver
cannot hear, so what can be checked in Node was made worth checking: no cue
clips; none begins or ends part-way up a waveform, which clicks — a fault an ear
finds instantly and a picture of the waveform does not show at all; the noise is
seeded, so a cue that sounds wrong sounds wrong again tomorrow. `kitchen.ts`
imports Phaser for its types only, which puts the bookkeeping in reach too, and
that turned out to be where the real regression lives: cues that never drain
would silence the game after four pulls, and nothing but an ear would report it.

**And the mute tab had to be drawn twice.** The first pair was a speaker and the
same speaker with a bar struck through it, which is the universal idiom and
could not be made to read at this size. Everything on the tab is one flat tint
(design §4), so a bar laid over the cone is the same value as the cone, and a
bar cut out of it staircases into a scatter of specks at 8×8. The pair that
shipped asks the question where the glyph is empty instead — waves, or no waves
— and is struck as a shape through `shade` rather than drawn by hand, for the
reason that helper already gives about arcs. Worth knowing before the next HUD
icon tries to say something by overlay.

**The bed loops without a crossfade, and that is a property of how it is made.**
A filter begun from silence takes a moment to settle, so its first samples do
not match its last — and that mismatch is the click a loop makes every time it
comes round. The bed's low-pass is primed on the tail of the buffer before it
runs over the front, so the state at sample 0 is already the state sample 0
*would* have if the buffer were playing for the second time. Which it is. What
that buys is a test: the seam has to be a smaller step than the biggest step
occurring naturally inside the loop, and it is, by a factor of five — where
without the priming it is nearly three times larger, which is audible. That is
the whole question — *does it tick every four seconds* — asked once, in Node,
instead of by sitting and listening for a minute.

It is also the one thing here baked at less than the hardware's rate. There is
nothing above a couple of hundred Hz in it, so the bandwidth the device would
give it is bandwidth spent on silence; Web Audio resamples it on the way out.
And it is noise rather than tone on purpose: a kitchen is a room before it is an
instrument, and anything with a pitch in it would sit in the same ear the cues
are trying to reach.

**Phaser loops it with two sources, not one.** `WebAudioSound` pre-schedules the
next repetition at a sample-accurate time and swaps to it, which is why the bed
has to join to itself cleanly in the buffer — there is no crossfade anywhere to
hide behind. It is also why a bed left running is a real hazard: sounds are
global and outlive the scene that made them, so a fresh run would stack a second
copy on the first, a little louder each restart. The Kitchen takes its bed down
on the scene's `shutdown`, which covers every way out of a run rather than only
the game-over branch.

**Where it sits was a layout question, not a menu one.** Design §10 gives
desktop the M key and design §11 gives the menu a settings screen that does not
exist; a phone has neither, and muting is something decided mid-run when
somebody walks into the room. So it is a tab beside the cheat sheet's, at the
same 44 px floor, and its geometry went into `ui/layout.ts` with everything
else. Landscape stacks the two tabs in the corner rather than setting them side
by side: the band between the rack and the frame edge is the wheel's whole
width, and at the wheel's floor that is narrower than two tabs, so the column's
height gives way instead — which `wheelRun` was already willing to do. Upright
there is width to spare, so the pair straddles the wheel, one tab on each
shoulder. `hitsTab` grew to cover both and kept its name and signature: every
caller wants the same thing of it — *the player was pressing a control, so do
not steer* — and a version that named the tab is one every future tab has to be
threaded through.

### What the review pass settled — two bugs, and geometry left in the scenes

Phase 8 shipped without the `/simplify` pass every other phase ended on. Running
it late found the two things a screenshot could not.

**The table dropped an entry it had room for, and the test said otherwise.**
`scoreboard` rounded its pitch. Rounding *up* pushes the pitch past the share
each entry actually has, `Math.floor(available / pitch)` then comes back under
the count, and a row is cut while the pitch is still well clear of its 18 px
floor — the one thing the paragraph above the function promises never happens.
It bites on 40 of the 81 frame heights in the band, a 550 px-tall window among
them. The existing test missed it because `scoreboard(200, 10)` divides exactly,
so both roundings agree there; the new one sweeps the whole band instead.
Flooring restores the invariant, since `pitch <= available / count` is what
makes the room big enough for the entries it was measured against.

**A run worth nothing was being called a new best.** `recordScore` was
unconditional, so the first death of a first install — which happens during the
teaching levels, at a score of 0 — went into an empty table, came back ranked
first, and printed "a new best" under a screen already reading `0` and `0
candies served`. The rule went into `insertScore` rather than the scene: it is a
rule about what the table will hold, it belongs with the ranking it qualifies,
and there it is unit-testable, which in the browser half it would not have been.
The same edit stopped the write for a run that missed the ten — that table is
byte-for-byte the one already on disk, and a `setItem` for it is a blocking
write bought for nothing, on most game-overs once a player has ten runs banked.

**Both screens' geometry had stayed in the scenes.** `ui/layout.ts` opens by
calling itself "the only file that holds any", and Phase 8 honoured that for
`scoreboard` and then wrote the rest of the same two screens' arithmetic inside
`MenuScene` and `GameOverScene`, where no test can reach it. The title clamp is
the sharp end of that: it is the arithmetic that wore the title off a 568×320
phone during the phase, and it had no test. `menuPlan` and `centredColumn` moved
across, and the eight viewports `layout.test.ts` already sweeps now cover both —
the title-clamp test fails on exactly the 568×320 frame when the clamp is taken
out, and nowhere else. `MARGIN` went with them, from `ui/text.ts` to
`TEXT_MARGIN` in `layout.ts`: it was exported into a scene during Phase 8, and a
length in pixels was never text's to own.

**The one reuse finding taken only in part.** The review wanted the two screens
on a single flow helper, on the evidence that both stack rows and both had
independently arrived at 46 px of air above their exit line. The gap became
`EXIT_GAP`, which is one piece of design and belongs in one place. The helper
did not: the menu is laid out *downward from a clamped title* and the score
screen is *stacked by its gaps and then centred*, and the docs for each explain
why it has to be that one. Forcing the menu through a gap chain turns a legible
`top - 30` into `size * 0.2 + TITLE_TO_TABLE - 30`. Two strategies that differ
for stated reasons are not duplication, so only the genuinely shared primitive
moved.

**The run summary was spelled out three times** — the `game-over` event, the
scene's `RunSummary`, and a field-by-field copy between them. This phase grew it
from three fields to five and had to edit all three, which is the demonstration.
It is declared once in `core/types.ts` now, and `GameScene` forwards the event
whole: the event already *is* the summary, carrying only the tag that got the
switch into that branch.

**And a comment that described call sites that did not exist.** `TIERS` claimed
four places keyed off it; exactly one did. The other three key off the
`ColorTier` type through a `Record` and are exhaustive because of that, not
because of the array — which, annotated `readonly ColorTier[]`, was precisely
the declaration a fifth tier would slip past in silence. It is `TIER_ORDER` now
(the name no longer collides with a different `TIERS` in `orders.ts`),
`satisfies` catches a value that is not a tier, and a test walks `noServes` to
catch a tier that was never listed.

### What the candy-kitchen pass settled — the timbre was one level below the table

The audio pass shipped eleven correct, tested, well-behaved cues that sounded
like nothing in particular. Asked from the chair for breaking candy to sound
like breaking candy, and the interesting part is *why that was not a retune*.

**`samples` could not make the sound the table was being asked for.** Every
overtone was `Math.sin(phase * (harmonic + 1))` — a strict whole-number series,
which is the physics of a string or a tube, and so of every instrument that is
plucked, blown or bowed. Brittle things *struck* ring at ratios that are not
whole numbers, and that inharmonicity is the whole of what an ear uses to
separate "shattered" from "plucked". The noise term was flat white, so it could
not be bright or dull either. Two fields — `ratios` and `band` — is the smallest
thing that reaches the sound; no arrangement of `hz`, `bend`, `noise` and
`durationMs` gets there, which is worth knowing before the next cue is argued
about in the units of the table.

**Both fields default to the old arithmetic, and that was the point of the
order.** The renderer went in first and was proved to render all eleven voices
byte-for-byte identically at both common sample rates before a single number in
the table moved. So everything heard afterwards changed because somebody wrote
a number, not because the floor shifted. A test pins it.

**The first attempt at that proof failed, and the reason is worth writing
down.** Staging the noise in a `Float32Array` to filter it rounded every sample
to the buffer's precision *before* the mix, where the old code carried a double
all the way into the sum — inaudible, and enough to make eight of the eleven
cues differ. It is `Float64Array` now: the scratch a filter runs in should not
be the precision the output happens to be stored at.

**The impact cues needed their partials made smaller, which is the opposite of
the instinct.** `samples` divides by the total weight of everything mixed in, so
the way to make noise carry a sound is to write the *tone* down. At the
amplitudes a bell wants, the crack's noise sat under a third of the voice and
the cue pinged rather than shattered. Measured, that one change roughly doubled
the share of the crack's and the snip's energy sitting above 4 kHz, against
their own fundamentals.

**The band is stated in Hz, and the bed came along with it.** `poleFor(hz, rate)`
converts a corner into a filter pole, which is what lets a cue's band be written
in the units it is heard in like everything else in that file. The bed's own
filter predates it and was a bare `0.9` with a comment guessing "somewhere under
200 Hz" — and the guess was right to four figures, so the bed says 185 Hz now and
lets the arithmetic do what the sentence was standing in for. It shifts the baked
bed by seven parts in a hundred thousand, which is nothing, and it removes a test
that only ever compared two constants somebody had already reconciled by hand.

**The bake went from 6.8 ms to 11.6 ms, and the surprise is where.** Measured at
48 kHz over the whole table: the noise pipeline costs ~2.1 ms, the richer voices
~0.9 ms, and the non-integer ratios **~1.9 ms** — the one optional field is dearer
than the entire filter. Bigger arguments into `Math.sin` are most of it and it is
inherent to the sound rather than to how the field was built, so there is nothing
to fix; it is recorded because "two optional fields" reads cheaper than it is, and
because this is boot time before the menu draws — roughly 60 ms on a phone where
it used to be 35. What *was* worth taking back is the container: resolving the
ratios and amplitudes into `Float64Array`s rather than a plain `map` keeps the
inner loop's load monomorphic across the eleven bakes and returns about six
percent of the whole thing, which is the same order as the `forEach` that loop
was already written to avoid.

**A filter can be wrong in a way nothing else here catches.** Wired backwards it
still renders, still fits the buffer, still starts and ends in silence, and
still passes every test the audio pass wrote. A single bin of a naive transform
in the test file asks the only question that separates them — is the energy
where the corners said — and it is asked of two specs differing in nothing but
the band, so the table cannot satisfy it by coincidence.

**And the pass paid for an ear.** `tools/audition.ts` writes every cue and the
bed to `.wav` under `npx vite-node`, which Vitest already supplies. It is the
smoke driver's mirror image — that one exists because the tests cannot see, this
one because they cannot hear — and it is the difference between judging a cue
and provoking a self-hit in a live run to hear one. Anything about a cue that
*is* a property is still a property, and stays in `tones.test.ts`; this is for
the half that is a judgement.

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

### What the speed-ladder pass measured — the ramp's quietest lever

Not a sitting: one report from the chair, and a sharp one — *the snake gets
faster with no visual hint or expectation, so the player only vaguely feels it
sometimes*. The first answer given was that the ramp already varies speed and
has since Phase 5, which is true and is not what was asked. Whether the
mechanic exists and whether the player can perceive it are different questions,
and only the first had ever been measured.

**Measured, the speed column was below the threshold of noticing.** Sampling
`moveIntervalMs` off the curve, as a percentage change over windows a player
could actually attend to:

| ramp-min | interval | cells/s | Δ per 5 s | Δ per 15 s |
| -------- | -------- | ------- | --------- | ---------- |
| 0.0      | 200 ms   | 5.00    | 2.38%     | 7.12%      |
| 0.5      | 171 ms   | 5.83    | 2.77%     | 8.31%      |
| 1.0      | 143 ms   | 6.99    | **0.52%** | 1.57%      |
| 2.0      | 134 ms   | 7.46    | 0.56%     | 1.68%      |
| 3.0      | 125 ms   | 8.00    | **0.00%** | 0.00%      |

Speed discrimination sits around 5%. From the Settled row to the cap the strand
crossed a third of its whole range at a tenth of that rate — and then stopped
for good at three minutes, against a median death of 5.2. So the chair's report
was three separate faults, only one of which was the missing indicator:

1. **No channel at all.** `grep moveIntervalMs` reached `core/game.ts`'s step
   loop and the tables that fill it, and nothing else — not `scenes/`, not
   `ui/`, not `render/`, not `audio/`. Arrivals got `Game.rush`, `ui/rushDoor.ts`
   and nine seconds of telegraph; speed got nothing.
2. **A rate nobody can resolve**, per the table above.
3. **No terminal signal.** Past three minutes the strand never gets faster
   again, and the run had no way to say so — leaving the rest of every run
   braced for an acceleration that was not coming.

**The fix steps the column and announces each step** (`SPEED_RUNGS`): seven
geometric rungs of 6.9%, comfortably over the threshold, each firing
`speed-raised` → the Quicken cue and a pulse on the head. The top rung pulses
twice and resolves to an octave, which is fault 3 answered.

**Stepping a knob the whole table interpolates needed the sweeps re-run, and
they came back flat.** Two things say so:

- **The snap is centred, not one-sided.** Over seven minutes of ramp the mean
  interval moves **0.003%**, with the ramp spending 21.4% of itself just under
  the old curve against 21.4% just over it. Snapping *down* to the last rung
  passed would have been the obvious implementation and would have made the
  whole ramp quietly slower.
- **A 64-seed draw of the batching bot reads 5.30 min against the continuous
  curve's 5.17 on the same seeds**, same 5 runs past seven minutes either side.
  The 16-seed sweep alone read 5.16 → 5.52, which is why it was widened: at
  n=16 a 7% median move is noise, and this file has now said four times that a
  run either side of a change that moves an rng draw is a different run.

**What fell out of it that was not designed.** Rung 5 is 143 ms — the Settled
anchor exactly — because the handover-to-Settled span is 2.49 times the
Settled-to-Rush span in log terms and five rungs against two is 2.5. The ladder
was already implied by the table, which is the other reason this moved the
curve so little. And the rungs land at 6.9 s, 20, 32, 44, 55, 91 and 151 s on
the clock: five gear changes in the first minute that teach what the cue means,
then two spaced ones that mean something. Nobody chose that shape either.

**The ladder is on the stopwatch, not on the score — which the docs do not
claim and probably should not want.** `rampMs` is `max(endlessMs, score × 70)`,
so speed already keys on score in the sense §7 describes. Measured on the
batching bot, it barely does:

| rung | ramp-s when played | ramp-s on the clock alone | pulled forward |
| ---- | ------------------ | ------------------------- | -------------- |
| 1–6  | 6.9, 20.1, 32.4, 44.0, 54.8, 91.0 | 6.9, 20.1, 32.5, 44.0, 54.8, 91.0 | ~0 s |
| 7    | 131.7              | 151.0                     | **19.3 s**     |

Six of the seven gear changes land on the clock; score only overtakes at the
cap. That is `MS_PER_POINT` doing exactly what it was fitted to do and no more
— it was measured against ramp-minute 1.5 *onward*, and the whole speed ladder
finishes at ramp 151 s. So the legibility argument that moved the ramp onto
score ("the shop gets busier as your score climbs" is readable off the HUD) is
true of the arrival column and false of this one.

Left where it is, deliberately. Dropping the clock floor would make it *worse*:
`max` fires at or before either term alone, so score-only strictly **delays**
rungs 1–6, and it would leave a struggling maker — scoring slowly, and the one
who most needs the run to keep moving — at the handover speed indefinitely
(§1 has difficulty ramping until lives run out). Making score genuinely lead
needs a *larger* coefficient for this column alone, and 85 and 100 ms/point
were both tried and rejected for the ramp as a whole; doing it for speed only
decouples this column from the single ramp position every other knob reads,
which is the property that keeps `stageAt` one function over one table.
**Open, as a known gap between the doc's stated rule and this column's
behaviour, rather than as work.**

**Left open: the expectation half.** The chair asked for a *hint* and an
*expectation*, and this delivers the hint. A player is now told the strand
changed gear, but still cannot see how many gears are left before the cap —
the ladder is legible one rung at a time rather than as a whole. A rung gauge
in the HUD is the obvious answer and is deliberately not built here, since the
announcement may well be enough on its own. **Open until the chair says.**

### What the queue-coupling question settled — speed stays off the window

Asked in the same breath as the report above: *should speed be related to the
number of pending customers?* The instinct is right — a visible cause is
exactly what the speed column lacked — and the answer is still no.

- **The window already drives a lever, and it is the arrival one.**
  `arrivalGapMs` is `intervalMs × (customers + 1) / maxQueue`, so an emptier
  window fills proportionally faster (§7). Coupling speed to the same number
  doubles a feedback path rather than adding one.
- **It points the wrong way whichever way it points.** Faster when busy
  compounds falling behind into falling further behind; slower when busy pays
  the maker for being late. The ramp's other levers all tighten monotonically
  and none of them reads the player's current trouble.
- **It is the control parameter.** Speed is the tempo the player's hands are
  matched to, which is why the table eases it rather than stepping it at a
  stage boundary. Yanking it on every arrival and every serve makes the strand
  feel unreliable to steer, and a serve would *slow the maker down* — success
  reading as a brake.
- **It cannot coexist with the ladder.** A rung that goes up and down is cue
  spam, and the top rung — the one genuinely new thing the run can now say —
  stops existing.

The tide is the shape the window was already given to play against, and it is
the right home for "the shop got busier": it moves arrivals, is telegraphed in
the doorway, and leaves the maker's own tempo alone.

### What the menu-parade pass added — the front of the shop showed no shop

The menu was four lines of text and a table over an empty band, on a screen
where every sprite the game owns is already baked (`BootScene`). A short strand
now walks one way across that band while a child carrying a candy walks the
other, and they pass in front of the high-score table.

- **It is also the palette, before a key is pressed.** The strand carries six of
  the eight colours — every second- and third-tier one — each wearing its
  accessibility symbol (§4), melted at the seams by the same `meltedTints` the
  board uses. Brown is left out: it is the mistake colour, and the front of the
  shop is not the place to advertise one.
- **The band is a layout decision, so `menuPlan` owns it.** `ui/layout.ts` is
  the only file that knows a screen pixel (arch §9), and the band is the same
  kind of question the title clamp already is. It comes back as one more offset,
  and the menu's rebuild guard compares it like the rest.
- **The parade gives way before the table does.** Same order the title is
  already in: the band is reserved only when it costs the table no entry *and*
  what is left still ends inside the frame. A phone held sideways drops it and
  keeps its five scores. The second half of that rule is the one no device
  exercises — with no scores yet the table cannot lose an entry, which would
  otherwise buy the band a run off the bottom for free.
- **Most of the band was already there.** The gap under the title is 72 px of
  which only the bottom belongs to the table's heading and the top to the
  tagline, so the screen grows by the 44 px the band could not find — few enough
  that a 960×640 window still shows all ten scores. The first cut reserved the
  band as new air on top of the gap and put the rope through the "press any key"
  line; the fix was to spend the gap rather than to add to it.
- **The child carries the candy in front rather than over their head.** A bubble
  overhead is how the serving queue holds an *order* up; this one has already
  been paid for. It also costs the band no height, and height is what the score
  table pays for.
- **The maths is a separate pure module, as `melt.ts` and `deform.ts` are.**
  `render/parade.ts` answers where every member of a fixed cast stands given the
  clock and the width; `ui/parade.ts` does nothing but push those numbers into
  sprites. That is what let a test catch the one bug worth catching: the loop's
  turnover and the visibility cull were two independent numbers, and the lead
  sprite re-entered from the left while still counting as visible — a teleport in
  plain sight. Both now come off one `CLEARANCE`.
- **`HEAD_TINT` and `CHILD_TINT` moved down into `render/drawn.ts`.** The parade
  needs both and `render/` may not reach up into `ui/`, so they now sit beside
  `GLYPH_TINT` and `BORDER` — the module that already owns the chrome tints —
  rather than being copied a third time.

Nothing here is random and nothing here is audible: a fixed cast at fixed speeds
needs no draw at all, and the menu is before the first gesture, which is before
a browser will let a cue play.

### What the combo-meter pass measured — the bonus is legible and does not close the finding

Candidate one, built and measured. The mechanic works exactly as specified:
`Severed` carries a serve counter, `scoreServe` takes a flat addend after the
multiply, and a four-pip meter on the hearts' row lights as a batch feeds one
child after another. What it does not do is invert the open finding — the
batching maker still loses to the grinder — and the measurement is clear that
this is not a matter of picking a better constant.

**The sweep.** `COMBO_BONUS` against the two numbers that matter, on `SWEEP`
(16 seeds) for the proportion and `WIDE` (64) for the median:

| bonus | batcher ahead /16 | WIDE median | batcher mean | grinder mean |
| ----- | ----------------- | ----------- | ------------ | ------------ |
| 0     | 0                 | 4.21 min    | 4932         | 13032        |
| 10    | 0                 | 4.32 min    | 5596         | 12907        |
| **15**| **2**             | **4.28 min**| **6649**     | 12892        |
| 25    | 0                 | 4.30 min    | 4885         | 12797        |
| 40    | 1                 | 4.09 min    | 5942         | 12898        |
| 60    | 1                 | 4.09 min    | 6750         | 13076        |
| 100   | 2                 | **3.95 min**| 7222         | 13314        |

**The proportion column is noise, and the reason is the ramp.** Bonus points
feed `rampMs` like any others (`MS_PER_POINT`, 70 ms a point), so every constant
in that table is a *different run* — the maker dies at a different moment, and
every free cell drawn after that moment is re-rolled. 0 → 2 → 0 → 1 → 1 → 2 is
what a re-roll looks like, not a response curve. It is the fourth time a pass
has had to restate what `simulation.test.ts` already says three times over: a
run either side of a change that moves an rng draw is a different run, not the
same one played harder.

**Read as a controlled experiment, the answer is unambiguous.** Excluding combo
points from the ramp feed makes the runs byte-identical across every constant —
same median (4.21), same deaths, same `bestCombo` spread — leaving score as the
only thing that moves. The batcher's mean then climbs **16.93 points per point
of bonus** — the same slope to two decimals across all three intervals
measured (0→15, 15→40, 40→100), which is the clearest evidence the arm did
what it was for — off 4932 against a grinder sitting flat at ~13060. Closing
an 8126-point mean gap at that rate needs a bonus near **480**: thirty-two
times the tier-1 base, and nearly ten times what a tier-3 serve is worth. At 100
— already seven times the tier-1 base — the controlled arm has the batcher on
6625 against 13207, and 3 of 16. The shipped arm at the same constant reaches
7222 and pushes the median through the 4-minute floor to 3.95, which is the
other reason a big constant is not the way out.

So the ramp-feed exclusion the plan held in reserve was **measured and not
shipped**. Its trigger (a broken median) never fired, it costs legibility, and
on the shipped arm it read *worse* (1 of 16 at bonus 15, against 2). It bought a
clean experiment, which is what it was actually good for.

**Why no constant works: the gap is not a rate.** The batcher already makes more
candy per minute than the grinder and has since the sugar-supply pass — that
test still passes on every seed. What it does not do is *live*. Measured on
`SWEEP`: the grinder carries one segment, rarely steers into itself, and is
**still standing on 9 of 16 seeds** when the sweep runs out of ticks, for a mean
run of **9.49 min**. The batcher drags a production line, dies on **16 of 16**,
and averages **4.80 min** — barely half the time on the clock to earn in. A
per-serve term paid at most three times a batch cannot pay for that. **The
lever that closes this finding has to touch survival or run length, not the
price of a serve** — which is what the fifth sitting's held speed candidate and
the escalation to nested-set orders were always aimed at.

**The mechanic is worth keeping anyway, and `COMBO_BONUS` stays at 15.** It
sits between tier-1 (10) and tier-2 (25) base, it costs the median nothing
measurable (4.28 against a 4.21 baseline, inside the ±0.3 the median is quoted
at), and the thing the second sitting predicted would be load-bearing turned out
to be exactly that: the pips are the only place a flat term inside a number that
already carries tier, patience and streak becomes something a player can watch
themselves earn.

**`bestCombo` says the mechanic actually fires.** The ledger's failure mode was
"combos never occur, and no constant fixes that". Measured, the batcher's
high-water mark at the shipped constant is 3 on five seeds and 4 on the other
eleven; across every arm swept it never once came back 1. And 4 is the window's
own ceiling (§7's max queue), which is where the meter's four pips come from —
a count corroborated by the sweep rather than read off a table.

**Notes from building it.**

- **`Candy` carries no provenance, so the combo counts direct serves only.** A
  racked candy is `{color, bornAt}` and cannot trace back to the batch it was
  cut from; a child sweeping the rack later therefore starts no combo and pays
  no bonus. Adding provenance was outside the scope the ledger prescribed, and
  the rule reads cleanly anyway — a candy belongs to a batch only while it is
  still on the block.
- **The counter lives on the piece, not on the game.** `consumeSevered` is the
  one place that holds a `Severed`, so it owns the increment and
  `deliverCandy` reports a boolean up to it. A crumble never reaches that path,
  which is how "debris is not a batch" ends up structural rather than guarded.
- **Two names for two counts.** `Severed.batchServes` and `scoreServe`'s
  argument are the children fed off the batch *before* the serve being paid;
  the `combo` the HUD is handed includes it. They were both called `combo` at
  first, which made `scoreServe(customer, 1, 1)` and an event reading `combo: 2`
  describe the same serve.
- **Off the shelf is the absence of a batch, not a flag beside one.**
  `serveCustomer` takes an optional `batchServes` and reads `fromShelf` off
  whether it was given one. A boolean *and* a count could disagree; a racked
  candy has no batch behind it to count, which is one fact.
- **`bestCombo` is reported, not just recorded.** It rides `RunSummary` the way
  `bestStreak` does and prints as a clause on the streak's line — appended
  rather than given a row of its own, because the game-over stack centres its
  rows without fitting them to the frame's height, and a ninth row measures 323
  px against a small phone's 320. Hung off the streak safely: a combo above 1
  takes two serves, so the line it joins is always there.
- **The opening levels need no guard.** They run `maxQueue: 1`, so a batch
  direct-serves at most one child and the term is 0 by construction. Pinned with
  a test rather than a conditional.
- **No audio, deliberately.** Consecutive serves already climb the Serve chime
  through `STREAK_SCALE` and the chop Pop already counts the batch; a combo
  pitch code on the same cue would put two numbers in one channel (§12). The
  meter is the whole signal.
- **The meter needed a harness, not the smoke driver.** It is invisible at rest
  and shows for 2.6 s after one event, which is exactly what a boots-clean check
  cannot see. Driven instead through a throwaway page that Vite serves the real
  `comboMeter.ts` and `layout.ts` to: rest, a three-serve batch, mid-fade, and
  the `play(9)` clamp, on three viewports.
- **The breath is a tween, not a hand-driven clock.** It was written as a
  `render(delta)` counting a hold and a fade down, which is `boardView`'s head
  flash and `shelfStrip`'s toss spelled again — and the three fields it needed
  (`remainingMs`, the lit count, a rounded write-cache guarding the ~120
  redundant frames of the hold) were all there to pay for the driving. One
  stored tween with `delay: HOLD_MS` does the same thing, and stopping it is how
  the next serve restarts the run. `CustomerView` and `RushDoor` step by hand
  for a reason this widget does not have: several children sharing one phase.

### What the pair-cap sweep measured — the open finding names the wrong thing

Not a sitting: one question, asked because a proposal needed it. The proposal was
a fourth opening level teaching the combo — one cut, two candies — and the
objection to it was that the record says batching loses, so the tutorial would be
teaching the strategy the game punishes. That objection assumes the two-segment
batch is punished. Nothing here had ever asked.

**The instrument is a segment budget on the planner.** `planLadder` gains a
`cap`: the most segments a plan may ask for at all, spent in the order the plan
already values — children at the window first, speculation after. At
`Infinity` it is the maker this file has always run, and it reproduces the combo
pass's shipped row **exactly** (6 649 against the grinder's 12 892), which is the
control saying the plumbing moved nothing. **No game code was touched in this
pass at all**, so for once there is no re-roll caveat: every arm below is the
same build, played differently.

| arm       | score | died /16 | median | batch | ladders | chop/min | staled | served |
| --------- | ----- | -------- | ------ | ----- | ------- | -------- | ------ | ------ |
| grinder   | 12892 | 7/16     | 9.31   | 1.06  | 5       | 16.1     | 10     | 138    |
| cap 1     | 3625  | 16/16    | 3.56   | 1.07  | 2       | 14.0     | 1      | 44     |
| cap 2     | 9028  | 16/16    | 5.38   | 1.91  | 29      | 19.9     | 15     | 91     |
| cap 3     | 8939  | 16/16    | 5.30   | 2.57  | 32      | 22.8     | 33     | 88     |
| cap 4     | 6977  | 16/16    | 4.55   | 2.86  | 24      | 22.7     | 33     | 69     |
| cap 6     | 5257  | 16/16    | 4.22   | 3.01  | 21      | 23.1     | 42     | 55     |
| uncapped  | 6649  | 16/16    | 4.89   | 3.02  | 23      | 23.4     | 42     | 67     |

Read the medians with care: each is taken over the runs that *died*, so the
grinder's is over 7 seeds and the capped arms' over all 16. They say when a run
ended, not how often.

**There is an interior optimum, and the uncapped maker is past it.** Length pays
up to two or three segments and then costs: cap 2 outscores the uncapped plan on
**14 of 16** seeds. That alone is worth having — the bot the open finding has
been measured on for six sittings is over-building.

**But the cap sweep is not a clean instrument, and cap 1 is what says so.** At a
cap of one the planner carries the grinder's own 1.06 segments and scores
**3 625 against 12 892** — a third, at identical strand length. The ladder bot's
deficit was never all length. Most of it is *who the strand is built for*: the
grinder walks at the child standing in front of it, which is a mouth that is
certainly there, while the planner walks at whichever ladder covers the most
expected demand and can re-plan onto a different one mid-build. Every
batcher-against-grinder reading this harness has ever taken varies both at once
and attributes the difference to the length. That is the **fifth** time a number
here has answered a different question from the one its name implies, and the
first time the number in question is the open finding itself.

**So the arm that answers the proposal holds targeting still.** `pairGrinderGoal`
is the grinder exactly — front child, its jars, the bench — with one difference:
when a second child is waiting on the *same* color it lays two cubes before
crossing, so one cut feeds both. That is the whole of what the tutorial level
would teach, and the cheapest batch the game has.

| arm     | draw | score | died  | median | batch | chop/min | staled | served |
| ------- | ---- | ----- | ----- | ------ | ----- | -------- | ------ | ------ |
| grinder | WIDE | 13080 | 26/64 | 9.11   | 1.06  | 16.2     | 10     | 139    |
| pair    | WIDE | 15967 | 21/64 | 7.97   | 1.36  | 19.1     | 16     | 158    |

**Ahead of the grinder on 14 of 16 across `SWEEP` and 54 of 64 across `WIDE`**,
and ahead of the uncapped maker on 16 of 16. It serves more, chops more, stales
barely more, breaks the strand not once in 64 runs, and loses a life on five
fewer seeds than the grinder does.

**The open finding is not that batching is punished. It is that *building ahead
of the window* is punished.** One cut feeding two children is already the best
way to play this game the harness knows. The two claims have been quoted as one
sentence since Phase 5, and the levers proposed against the finding have mostly
been aimed at the half that was never broken.

Two assertions ship with this, both pinning what was measured: the pair maker
beats the grinder on at least 12 of 16, and the planner at the grinder's own
strand length scores less than the grinder on every seed. The second is there so
that length and targeting cannot quietly be read as one variable again. The open
finding's own assertion is **untouched and still passes** — the uncapped batcher
still loses on 14 of 16 — and should now be read as the narrower claim it always
measured.

**What this does to the order of attack.**

- **The combo tutorial level's objection is void.** It would teach the winning
  move, not a trap. It is no longer blocked on the balance work, and what is
  left against it is its own cost — the tutorial's one-order model, and
  `bestCombo` reading 2 on every run (design §11).
- **Correlated demand keeps its target but changes its argument.** It was
  proposed to raise sell-through on long ladders. What the pair arm says is that
  its real job is to make the pair *available more often*: the maker above only
  lays a second cube when two waiting children happen to want the same color,
  and demand spread uncorrelated over seven colors is what makes that rare.
  Measure it as pair frequency, not as ladder sell-through.
- **A lever nobody has proposed is now the obvious one:** the planner's
  targeting. If the maker who plans ahead simply committed to the ladder it
  started, it would be a different bot — and possibly not a losing one.

### What the twin pass measured — the pair was never rare, and the belief is half the gain

The demand-shape candidate, built and swept. `rollOrder` takes the window it is
drawing into, and `TWIN_CHANCE` of the time echoes a want already standing there
instead of rolling one; the pair-cap sweep above is what pointed it at *equal*
wants rather than at a nested set, since the maker that wins is the one that
takes a pair off the front of the queue. Zero draws no rng at all, so the
baseline arm is the shipped game rather than a re-roll of it.

**The premise was wrong, and the first reading says so.** A pair was supposed to
be a coincidence under demand spread over seven colors. Measured, a duplicate is
already standing at the window **43% of the live ticks** — three or four slots
against seven colors collide about as often as a birthday does in a room of
twenty-three. The echo does not create the shape, it raises how often it is
there.

`SWEEP` (16 seeds), the three makers per arm:

| twin | maker   | score | died  | median | pair on offer | ahead of grinder |
| ---- | ------- | ----- | ----- | ------ | ------------- | ---------------- |
| 0    | grinder | 12892 | 7/16  | 9.31   | 43.3%         | —                |
| 0    | pair    | 16101 | 5/16  | 8.57   | 42.3%         | 14/16            |
| 0    | batcher | 6649  | 16/16 | 4.89   | 26.9%         | 2/16             |
| 0.20 | pair    | 17977 | 2/16  | 9.53   | 53.0%         | 16/16            |
| 0.20 | batcher | 7995  | 16/16 | 5.43   | 43.4%         | 0/16             |
| 0.35 | pair    | 16777 | 6/16  | 8.78   | 58.7%         | 13/16            |
| 0.35 | batcher | 7915  | 16/16 | 5.76   | 46.9%         | 1/16             |
| 0.50 | batcher | 12350 | 15/16 | 6.37   | 58.2%         | 7/16             |
| 0.75 | pair    | 18996 | 0/16  | n/a    | 73.9%         | 16/16            |
| 0.75 | batcher | 15767 | 14/16 | 7.40   | 65.1%         | 12/16            |

**The open finding does invert — at a constant that breaks the death target.**
At 0.75 the batching maker is ahead on 12 of 16, the first time this record has
been able to write that. It is also an arm where the pair maker does not die at
all inside ten minutes, the grinder's deaths fall from 7 of 16 to 4, and the
batcher's median death goes 4.89 → 7.40. That is not the finding closed; it is
the game made easier until batching stops being punished, and design §7 has a
4–6 minute median it is aimed at.

**And two thirds of that inversion is the bot, not the rule.** The planner values
a speculative rung off `demandFor`, which had to learn the echo or it would plan
for a demand shape the game had stopped having. Separating the two:

| arm                      | score | ahead | died  | median |
| ------------------------ | ----- | ----- | ----- | ------ |
| game 0.0 / belief 0.0    | 6649  | 2/16  | 16/16 | 4.89   |
| game 0.5 / belief 0.0    | 8321  | 3/16  | 16/16 | 5.51   |
| game 0.5 / belief 0.5    | 12350 | 7/16  | 15/16 | 6.37   |
| game 0.0 / belief 0.5    | 6423  | 2/16  | 16/16 | 4.65   |
| game 0.75 / belief 0.0   | 8720  | 4/16  | 15/16 | 5.53   |
| game 0.75 / belief 0.75  | 15767 | 12/16 | 14/16 | 7.40   |

The rule alone at 0.75 is worth 8 720 and 4 of 16. The rest is the maker playing
*to* it. That is a fair gain — a player learns the same thing in a sitting or two
— but it has to be quoted as what it is, and the last row of the middle pair is
the control that says the belief is not simply a better bot: believing in twins
the game does not deal is worth **less** than not believing in them (6 423
against 6 649).

**Shipped at 0.25**, confirmed on `WIDE`:

| twin | maker   | score | died  | median | pair on offer | best combo | staled |
| ---- | ------- | ----- | ----- | ------ | ------------- | ---------- | ------ |
| 0    | grinder | 13080 | 26/64 | 9.11   | 43.1%         | 1.80       | 10     |
| 0.25 | grinder | 13244 | 20/64 | 8.87   | 58.1%         | 1.94       | 14     |
| 0.25 | pair    | 16838 | 21/64 | 8.63   | 55.4%         | 2.52       | 24     |
| 0.25 | batcher | 7968  | 64/64 | 5.29   | 44.2%         | 3.66       | 52     |

The batching maker's median death stays inside the window (5.29 against a 4.34
baseline), the grinder's score does not move (13 080 → 13 244), and a pair
stands at the window 58% of the time instead of 43%. **Every seeded assertion in
the suite held across the change** — which is worth stating, since this moves an
rng draw and every previous such change had to re-measure the whole table.

**One claim in this section was written ahead of its measurement and has since
been corrected.** It said the tier shares the table asks for were "unchanged by
construction". That is true of the roller — an echo copies a want drawn from the
weights, and `orders.test.ts` pins it — and it is **not** true of a running
game, because the window an echo copies from is not a fair sample of what was
ordered. An easy color leaves it faster: a raw or a primary is the more likely
to be waiting on the rack when its child walks up, and design §5 sweeps it there
and then. What is left standing to be echoed skews toward the slow colors.

Measured over `WIDE` against the mix in force at each arrival, on the grinder:

| arm       | T1 obs / exp  | T2 obs / exp    | T3 obs / exp    |
| --------- | ------------- | --------------- | --------------- |
| twin 0    | 5.4% / 5.7%   | 37.7% / 37.1%   | 56.9% / 57.2%   |
| twin 0.25 | 4.5% / 5.7%   | 35.7% / 37.2%   | **59.8% / 57.1%** |

Secondaries run 2.7 points over the table, raw and the primaries about a point
light each. It is smaller than one step of the anchor table's own T3 column and
the death target held across the whole sweep, so it is recorded rather than
corrected — but it is the first thing to re-measure if the constant is raised.
The lesson is the one this file keeps relearning: the claim was reasoned from
the shape of the draw, and the draw is not the game.

**What it is and is not.** It is not the fix for the open finding: at a
difficulty-neutral constant the maker who builds a production line is still
behind on 15 of 16, and the arm that inverts that is an arm that makes the game
easier for everybody. What it is, is the combo (design §9) becoming a thing the
window *offers* rather than a coincidence it occasionally allows — `bestCombo`
climbs on all three makers, and the mechanic three sittings asked for now has
demand shaped to feed it.

**What is left.** Closing the finding properly now has a shape it did not have
before: the high twin arm plus an anchor-table retune to take the difficulty
back. That is one pass — the tide was built the same way, and the same caveat
applies, that a spawn-timing change re-rolls every free cell drawn after it. It
is the first candidate in this record that has been measured to invert the
assertion at all, so it is worth the sweep.

The nested-set variant — echoing a *superset* of a waiting want, so the window
asks for a ladder rather than a pair — stays untested and drops down the list.
The pair-cap sweep is the reason: the ladder is the shape that loses.

### What the combo-level pass built — the tutorial teaches the thing that wins

The fourth opening level, and the last of the three stages this run of work was
planned as. The two sweeps above are its justification: the pair-cap sweep says
one cut feeding two children beats the grinder on 54 seeds of 64, and the twin
pass says the window now offers that shape 58% of the time. Nothing taught it.
Design §9 has scored the combo since Phase 5 and §11 draws a meter for it, and a
player met both without ever being shown what produces them.

**The level is the mix again, for two children.** `rollTutorial` closes with the
same secondary level 3 taught, wanted twice over — so the only new thing in it is
the *count*, and the two jars that unlocked the recipe wheel are still its stock,
which is what stops the wheel blinking out for the last of the four. The board
lays a second cube once the first is on the strand and never a third.

**What it cost, structurally.** A level was one order everywhere, and four
things had said so by construction rather than by a rule:

- `TutorialLevel` gains `children`, and `GameState` a `tutorialServes` beside
  `tutorialIndex` — how far through a level the maker is had nowhere to live.
- `admitCustomer`'s tutorial window was the literal `maxQueue: 1`; it is now the
  children the level has left to send, so the last of them opens two places.
- A serve *was* the end of a level. It is now counted against the level.
- `stocksSugar` rationed by "the strand is empty"; it rations by what the level's
  remaining orders still need, which reduces to the old rule at one child.

**And one thing the simulation refused.** The first cut of this held the jars
back until the strand was as long as the level wanted — the pair as the only
move the level offers, which is exactly the authoring §7 is built on. It
soft-locks. A maker who does not build to length carries one cube, finds no jar
on the floor, takes it to the block, and the raw candy nobody ordered goes on the
rack while the level starts over; the reference grinder does precisely that,
forever, and the sweep came back with the grinder staling 116 candies and never
reaching the endless game at all. Design §7 promises nothing can stall. So level
4 **offers** its lesson instead of forcing it: the jars come out on the first
cube as they always have, and what the level does is show the pair — two children
holding up the same bubble, a second cube on the floor the moment there is room.
A maker who chops one candy at a time still finishes it, just without the combo.

That is the one caveat this pass could not design away, and it was in the
evaluation before it was in the code.

**Two smaller consequences, both of them things that had been true by accident.**

- `bestCombo` now reads 2 on every run, so the game-over screen's "best batch fed
  N" would have been reporting that the game was played — the exact failure the
  rule was written against when the floor was 1. The floor moves to what the
  levels *teach*, off one exported constant so the level and the line that
  reports on it cannot drift.
- The simulation's own invariant "no cube on the floor once the level has stopped
  asking" was only ever true because every level asked for one, and the cube was
  always claimed before the rule could flip. Level 4 can leave one lying there
  when the maker chops the first segment. What the rule protects is the floor
  against a pile of cubes, so that is what it says now.

**Measured, nothing else moved.** All 771 tests pass, the four-level tutorial
included: the batching maker's median death is unchanged inside 4–6 minutes, the
window still fills, and the smoke driver boots clean. The tutorial is longer by
one level on every run, which is the cost, and it is the level that finally
explains the meter on the hearts' row.

### What the pause pass settled — the last line of §10, and the band that was full

Not a sitting and not a sweep: a gap between the documents and the game. Design
§10 has listed **P / Esc** and a pause button since it was written, §11 counts
pause among the HUD's parts, and architecture §6 says how to build it —
`scene.pause` on GameScene only, UIScene stays interactive. Grepping `src/` for
it returned nothing. Every other item on §10's list was in; this was the one
that was not, and a phone game with no pause loses the run to a phone call.

**The mechanism was already written down, and the second half of it turned out
to be load-bearing.** "UIScene stays interactive" reads like a convenience and is
a requirement: a paused Phaser scene has its input *and* keyboard plugins
switched off, so a P bound by GameScene would stop the game and then never hear
the key that restarts it. UIScene holds the switch. Core is untouched — it is
advanced by the scene, so a scene that is not stepped is a game that is not
running, and there is no `paused` field anywhere in `core/`.

**Nor is there one in the HUD, which the review had to say twice.** The first
cut gave the tab a `paused` boolean, copying the shape of `muteTab.ts`. That
mirror exists for a specific reason — Phaser's mute getter reads a value its
setter only *schedules*, so it lies on a suspended context — and none of it
applies to `isPaused`, which is an enum compare. Worse, it made the widget name
a scene, the only `ui/ → scenes/` import in the repo, in a codebase whose own
`render/drawn.ts` says that layer "must not reach up". So the tab is handed
`paused` the way the cheat sheet is handed `unlocked`, and the scene manager
stays the only copy of the answer.

**Three things do not stop by themselves, and each is owned where it lives.**

- **The room tone.** `scene.sound` is the *game-global* manager, so the bed
  outlives the paused scene's update and loops over a stopped shop. `Kitchen`
  holds it over the bed's own transport — deliberately not `scene.sound.mute`,
  which `muteTab.ts` owns and reads from a local mirror, because two writers on
  that boolean means a pause comes back unmuting a player who asked for silence.
  It subscribes to its own scene's `pause`/`resume`, beside the `shutdown` hook
  it already had: an emitter still fires while its scene is paused, so the object
  that owns the bed can own its own listeners and GameScene needs no line at all.
- **The HUD's own animation**, for the structural reason that the scene holding
  the switch is the scene that is still running. `UIScene.update` returns early
  while the game is paused. The first cut instead handed the queue `delta = 0`,
  which was the same bug the pass had just diagnosed, one layer up: it fixed the
  thing that was named and missed `rushDoor.ts`, which bobs off `scene.time.now`
  and is not a tween, so the doorway crowd would have kept shuffling in front of
  a stopped kitchen. The freeze test did not catch it either — the rush starts at
  the one-minute mark and the test pauses within seconds. One guard says it once
  and covers the widget nobody has written yet.
- **A cue already in the air** is left to finish. A few hundred milliseconds, and
  cutting a cue mid-shape is more audible than letting it end.

**And one leak, which is a Phaser fact worth writing down.** `Systems.shutdown`
clears only its own four transition events; `removeAllListeners` is in `destroy`,
which a scene reused across runs never reaches. So a plain `on` against a scene's
emitter accumulates a handler per run — invisible here, because holding an
already-held bed does nothing, and unbounded regardless. Phaser's own
`KeyboardPlugin` unsubscribes itself in `shutdown` for exactly this reason. The
kitchen now does too, and `kitchen.test.ts` counts the subscriptions across a
shutdown rather than trusting the reading.

**Where it goes was the only real decision, and the smallest phone made it.** A
third rung on the landscape stack was the obvious answer and does not survive
measurement. Each rung costs the wheel 52 px of column, and on 568×320:

| tabs in the stack | wheel panel's floor | children's feet | verdict |
| ----------------- | ------------------- | --------------- | ------- |
| 2 (shipped)       | 200                 | 182             | clears  |
| 3                 | **148**             | 182             | the wheel climbs across the queue |

That is `layout.test.ts`'s existing "keeps the cheat sheet clear of the rack and
the queue" going red — the wheel paying for a control, on the frame least able to
afford it. **So pause goes sideways instead of up.** The stack never grows,
`sheetFloor` is the same arithmetic it was, and the proof that the wheel paid
nothing is that every existing sheet and wheel assertion passes *unmodified*. The
band it moves into has the room the column did not: 171 px on that same phone,
against the 96 two tabs need.

**Upright there was no room at all, and that only showed up in a test.** The plan
said a second rung under the sheet's tab. On 320×568 the band above the board is
78 px and the wheel at its floor is 73 of them, so the rung landed on the
kitchen — caught immediately by asserting the new tab against the board on all
eight viewports, which is the whole reason that assertion is written per frame
rather than once. Every band up there is full: score, tab, wheel, tab, hearts.
Pause takes the far end of the rack's own row instead, `clamp`ed the way design
§10 already clamps the landscape queue — it asks for the frame's gutter, gives
that up to clear the rack, and will not give up being on screen. Every portrait
frame gets its 8 px except 320×568, which goes flush at 0..44 and touches the
rack exactly. Recorded rather than fixed: `overlaps` is strict, a thumb still has
its 44 px, and the alternative was moving the rack.

**What it looks like, and the one place §11 was consulted rather than amended.**
The board frosts over at half alpha — lighter rather than darker, because the
room is pastel and a black wash reads as an error dialog — with the stopped mark
over it at four cells, sized off `board.scale` so it is the same share of the
kitchen on every screen. The first cut was 0.72 and hid the board; a player
pauses mid-run and has to *re-read* the kitchen to start again, so the frost says
stopped without saying gone. The HUD is deliberately outside it: the rack and the
queue are what the pause was useful for. And there is no prose anywhere in it —
the tab carries bars or a wedge, the state rather than the verb, the same bargain
the mute tab makes with its speaker. §11's "the only text on the play screen is
the score" needed no amendment.

**Measured.** All 824 tests pass, 52 of them new — most of that from folding the
three per-tab families into one table over controls × viewports, so the D-pad
lands as a row rather than as nine more copied blocks. The five viewports boot
clean under the smoke driver, and because that driver cannot see motion the
freeze was read off the screen instead: two screenshots 1.2 s apart are
byte-identical while paused and differ either side of it, on every one of the
five — a stronger claim than a frozen board, since it is also the children and
the meter that stopped. Both keys, a tap on the tab and a tap on the frosted
board all toggle it, in both orientations, and it survives three runs with a
death and a restart between them.

**One thing the screen could not be asked.** A frost test only proves the things
that *were* moving have stopped, which is why the doorway crowd got past it. The
rush is a minute into a run and every check here pauses inside the first few
seconds; the guard that covers it is structural rather than measured, and that is
the honest status of it.

**What is left of §10.** The optional virtual D-pad and its left-handed mirror,
which is the whole of the section still unbuilt, and the README now says so.

### What the tide pass measured — the rush was on, and showed nothing

Not a sitting: one report from the chair with a screenshot attached — *1063
points, never more than one child at the window, and no rush*. The first thing
the harness had to settle was whether that was a bug, and it was not. At 1063
the ramp stands at 74 410 ms, which is phase 0.24 of the tide's first period:
`RUSH_SHAPE` holds intensity at 0 for the first half of every cycle, so the run
had crossed `RUSH_FROM_MS` 14 seconds earlier and was sitting in the lull. The
first swell was still 350 points away, and would arrive at 65% strength because
`rushSwing` spends a whole period easing in. **Working as specified, and the
specification was the problem** — which is the third staleness report in this
file, after 400 points at the ninth sitting and the flat-speed one before it.

**Two other things were asked in the same breath and both are recorded as
closed rather than built.** *Can the ramp key on score instead of time?* It
already does — `rampMs` is `max(clock, score × 70)` and has been since the
score-ramp pass — and dropping the clock term cannot help, because `max(a, b)`
is never below `b`: removing it can only move the ramp position down. It also
reopens the stall the floor exists to catch, since a maker who serves just
enough to hold their lives would stop ramping entirely, against design §1.
*Does the speed ladder follow score too?* Also already true: `stageAt` derives
`moveIntervalMs` from `rampMs`, verified with the clock pinned at zero, where
the interval still walks 200 → 187 → 174.9 → 143 on score alone.

**The dead stretch was in two places and they compounded.** Half of every period
is lull by design, and the ease-in scales the whole tide down across the first
one. Together they gave a run 860 → 1414 points of a rush that was on and
invisible. So the run now joins the cycle at the swell's foot (`RUSH_OPENS_AT`)
instead of the top of the lull. The table, the period, the shape and the peak
rate are untouched, and **from the second cycle on the mean arrival rate is
untouched too — 1.5275 either side, exactly.**

The first cycle is the exception, and the first draft of this entry claimed it
was not. Measured at 10 ms across cycle one the mean rate falls **1.4081 →
1.2513**, about 11%: entering at the swell skips that cycle's lull, but it also
spends the second half in an ebb the old entry spent at a peak, and the shortened
ease-in only claws part of it back (the offset alone reads 1.1194). So the tide's
opening minute is slightly *lighter*, not neutral — which matters because the
sweep had been pointed at the wrong invariant. What it should be asked, and what
holds, is the pair of this and the floor together: **batcher median death 5.31
min on both sides, to two decimals.**

**Opening on a swell retired the ease-in's reason, which is why it also had to
be cut.** `rushSwing` was a whole period because a run entering at the lull met
`CALM_RATE` first — an interval slightly *easier* than the table's, at the exact
moment the rush was added to make the game harder — and easing in hid that step.
Entering at the swell there is no step to hide, since the shape itself starts at
0 and climbs. Left at a full period the two compound the other way: the first
swell would peak nine seconds in against a swing 15% wound on, delivering 0.15
of a tide to a player who had just been shown a doorway full of children. Halved.

**Then the half a rate cannot buy: the window now has a floor.** This was the
report's other half, and it is the more interesting one. `arrivalGapMs` is
`interval × (waiting + 1) / maxQueue`, so with one child waiting the early ramp
asks 6.4–8.0 s for the next, against a bench round trip of two or three. **A
maker who keeps up empties the window faster than any interval can refill it**,
so the tide's whole effect was legible only to players already in trouble. The
plan had recorded one half of this — surplus rate at a peak "is clipped by the
window the moment it fills" — and this is the other: below `maxQueue` the
surplus is clipped by the *maker*, and the better they are the more they clip.
So while the doorway reads as a crowd the window is held at two children
(`rushFloorAt`), which is the one form of a rush that cannot be served away.

**It is also the lever that makes the batch cashable, which is nearly the point.**
Design §9 pays for one cut feeding two, and the rush exists so "a maker who sees
one coming has a reason to build a ladder into it" — but a ladder cannot be
cashed into a window that only ever holds one child. The rush was offering a
lever it never opened.

**The first cut of the floor was a ceiling, and only the sweep said so.** It
spent the arrival clock on floor-driven admits, so every serve during a rush
restarted the ordinary fill and the window sat pinned *at* two instead of
building past it. Measured, that cost the window a fifth of its pairs — a
duplicate order is far likelier among three or four children than among two — so
a mechanism justified as "makes one cut feed two" was making it feed one. A
child the tide insists on is now **extra**: only an arrival the clock actually
paid for spends it. Done right the window sits *above* the floor 86-91% of a
tide and still reaches the table's cap of four, which is what
`holds the window at a pair while the tide runs, without capping it there` now
pins — `game.test.ts` cannot, because `Game.rush` is 0 for a pinned stage and an
unattended game loses its lives to walkouts around 50 s, before the ramp reaches
the tide at 60.

**And one consequence of the floor that is a mechanism rather than a number.**
`admitCustomer` ends in `serveFromShelf`, so a child the tide insists on can be
served off the rack in the same tick they arrive — which drops the window below
the floor again and admits another next tick. During a rush a stocked shelf
therefore empties as fast as the maker can cut rather than as fast as the window
fills: the window is production-limited, not rate-limited, for those two places.
That is the rush being the moment a maker cashes their stock, which is the
behaviour the lull was always meant to set up, and it is the reason the floor is
two rather than the whole queue. Recorded rather than changed — the median above
was measured with it in.

**Measured, both arms, 64 seeds.** The whole pass is balance-neutral on the
statistic the ramp is aimed at and moves the ones it was meant to:

| | baseline | shipped |
| --- | --- | --- |
| batcher median death | 5.31 min | **5.31 min** |
| batcher closed out | 64/64 | 64/64 |
| grinder closed out | 18/64 | 21/64 |
| window duplicate rate (`WIDE` mean) | 0.574 | 0.572 |
| solo planner ≥ grinder | 1/64 | **0/64** |

The floor *alone*, before the phase offset went in, read 12/64 on the grinder —
it had made the game easier, which is the same trap the tide itself fell into
the first time it was tuned (§7's 0.8/1.5 pair). The offset put that back: more
children at the window is more throughput for a maker fast enough to clear them,
and a swell that arrives while they are still clearing is what stops it being a
gift. Worth knowing before either number is retuned alone.

**One assertion changed shape, and it is a correction rather than a
relaxation.** `offers the pair a single cut can feed` was a *per-seed* floor at
0.45 over `SWEEP`. A per-seed floor is the draw's minimum, which is the noisiest
statistic a sweep has, and measured across `WIDE` **the baseline already put two
seeds of sixty-four under it** — it passed only because neither was in `SWEEP`.
Any change that re-rolls a pickup spawn reshuffles which seeds land where, so it
was going to fail on the next such change whatever that change was, and it would
have read as the window losing its pairs. It now asserts the mean the comment
was always claiming, with a floor set under the measured minimum. That is the
third statistic this file has learned the width of a draw about, after a
proportion needing sixteen and a median needing sixty-four.

**And two tests were passing for the wrong reason afterwards, which is worse
than failing.** `fills the window faster at the peak and slower in the lull`
sampled phases 2.0 and 2.75; the offset makes both of those lulls, and it went
on passing only because the *baseline* interval shrinks as the ramp climbs, so
the ramp alone was carrying the assertion. Re-sampled so the peak is read
earlier on the ramp than the lull — the harder way round, and the only way the
tide has to overturn the baseline for it to pass at all.

**What the report would see now.** At the same 1063 points the tide reads 0.48
with the floor engaged, against 0.00 and a single child before. The first rush a
run meets lands at score ~1000 rather than 1414.

## Risks & mitigations

- **Chop-mode feel** — *retired in Phase 3*, by dropping chop mode outright:
  the block cuts the strand loose and the maker never stops moving. The
  fallback held in reserve (instant chop, staggered animation) is close to
  what shipped, minus the freeze.
- **Swipe latency vs. grid ticks** — mid-drag threshold detection (arch §8);
  validate on real devices early in Phase 6, not at the end. **This one fired.**
  It was validated at the end rather than early, and the first device report
  (Phase 6) says the 20 px threshold commits the turn a block late. The
  mitigation was the right one and was simply not exercised in time. The fix has
  since shipped — the threshold is 13 px — but the risk is not closed, because
  the thing that caught it is the thing that has to confirm it: **open until the
  phone says so.**
- **Color confusion for colorblind players** — symbols are in from Phase 2,
  not bolted on later.
- **Balance is opinion** — seeded simulations make tuning comparable
  run-to-run; keep all knobs in `difficulty.ts` + one tuning table.
- **Scope creep** — future ideas live in design doc §13; nothing from that
  list enters before Phase 8 ships.
