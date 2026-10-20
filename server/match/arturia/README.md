# Elite AI seats (vendored)

`server/match/arturia` and `server/match/lavinia` are vendored, unmodified copies of the
frozen bot engines shipped by the third-party add-on pack
[`HankDUMPLINGZhong/Stronghold-Protocol-AI`](https://github.com/HankDUMPLINGZhong/Stronghold-Protocol-AI)
(v0.1.3 "AI·阿尔图罗" / v0.1.2 "AI·拉维妮娅"), which in turn is a frozen copy of this
project's own `server/match/**` at upstream `b3deebdae4a92642c007d217a1a4573e5d3612c5`
(0.3.1). Their LICENSE files are kept next to the engine.

Do **not** edit `policy/**`: the files are installed at exactly the depth the add-on's
relative imports expect (`server/match/<persona>/policy/server/match/...`), and the
importers in `bot.js` / `match/phases.js` treat them as an opaque engine.

`index.js` is the add-on's `runtime.js` (a persona → engine adapter: which band the seat
takes and which option overrides the frozen policy runs with). The hooks themselves live in
`server/match/bot.js` (`botPickBand`, `botPickCard`, `botPrepBeginSteps`, `botPrepEndSteps`)
and `server/match/match/phases.js` (draft order, band reservation, default band).

Notes for this fork:

- The seats are only offered outside 标准模拟 (`FUNNY`), matching the add-on: that mode
  statically disables the Laterano/Siracusa named-elite rules, and the add-on refuses to
  silently switch them on.
- Rooms whose content set has gameplay plugins (`content.vanilla === false`) do not offer
  the seats either; the server re-checks both conditions when the room starts.
