# Animas

An anima is a persistent identity an agent wakes into: its voice, aims, policy,
inbox and a history of breaths. T3 Code reads animas from the environment's
anima home and gives threads that run with one the identity at their first turn.

## Open animas

Click the sparkle button at the bottom of the sidebar, or run **Open animas** from
the command palette. The page has three views:

- **Dashboard** opens first. It shows totals, the most recently active animas,
  when each one was last active, the tensions they are holding, and the full list
  with health and unread messages.
- **World** shows every anima as a creature in Lantern Yard. Crews live in their
  lead's town and others in their home project's town. A creature at its desk has
  a live session. One that wanders is resting, and one with its head down has been
  idle for two weeks or is paused. Click a creature to meet it, and double-click to
  open it.
- **Library** holds the shared notes animas shelve for each other.

Opening an anima shows its aim, its colour across every breath, and tabs for
identity, breaths, inbox, opens, policy, threads and sync. **Play life** turns its
breaths into chords. Click its creature to choose a different form. The choice is
saved to the anima, so other apps show the same creature.

The world moves only while it is on screen. Use the pause button to keep it
still. It also stays still when your system asks for reduced motion.

## Which anima CLI is used

The server runs the CLI named by `ANIMA_CLI` if it is set, then an `anima`
command on `PATH`, then the skill script at `~/.claude/skills/anima/anima.ts`.
Anima state lives in `ANIMA_HOME`, which defaults to `~/.claude/anima`. With
anima 0.2 or newer, breathing uses the CLI's own breathe guide and identity
refreshes use `anima brief`, so updating the CLI updates what agents receive.
