# Bomb Maze Battle

Drop bombs, blast crates, grab power-ups and trap your rivals in the cross-shaped blasts. The last one standing wins the round; the first to win enough rounds takes the match. After 1:30 the walls start closing in.

**How to play:** move with W A S D or the arrow keys (or the on-screen stick), drop a bomb with Space (the Bomb button), kick a bomb with E once you have the kick boot. Up to 8 players; bots fill the table to 4. The host picks how many round wins end the match (2, 3 or 5) and the arena (Classic, Crossroads or Rings).

Play it at https://onceworlds.com/play/bomb-maze-battle

Plain JavaScript modules and Canvas 2D, no build. `npm test` runs the tests: the rules and arenas, movement with corner assist, blasts, chains and sudden death, the bots, whole matches of bots only (20 seeds), the host's room against a fake one, the real page against a fake browser (as a host and as a guest), and the store art. MIT licensed.
