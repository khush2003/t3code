# Animas

An anima is a persistent identity an agent wakes into: its voice, aims, policy,
inbox and a history of breaths. T3 Code reads animas from the environment's
anima home and gives threads that run with one the identity at their first turn.

## Set up a new anima with an agent

In a thread's **Anima** menu, choose **New anima…**. T3 Code puts a setup request in
the composer; send it, and the agent reads the thread and, when it matters, the project,
then asks you about the anima's name, purpose, voice, values and limits. Once you answer,
it creates the anima, writes its identity and first rules, and records its first breath.
Anything already in the composer stays as notes for the agent. The setup thread itself
runs without an anima, so choose the new one when you start its first real thread.

## Chat with a bot

A bot is a long-lived agent you talk to about work across all your projects. It keeps one
conversation and hands each piece of work to a thread in the right project, so you can see, open
and steer that thread like any other. When a thread finishes, the bot wakes and tells you.

In the sidebar, press **+** next to **Bots**, give the bot a name and say what it is for. Starting a
name you used before reopens that bot. Archive its thread to put a bot away.

- A bot keeps a board: each piece of work is a work item with its threads, and their status is read
  from the threads themselves, including threads on linked machines. The bot sees the board on
  every turn, so it keeps track even after its conversation is compacted.
- A bot's charter holds what it is for and what you told it should hold from now on. Tell it, and it
  updates its charter.
- Every bot knows the others and what they are for.
- When a thread finishes, its result is kept with the bot, so it stays answerable after the thread's
  machine goes offline.
- A bot runs on Claude, on a lighter model by default, and has no shell or file tools, so it
  cannot do the work itself. Its threads use each project's default model.
- A thread can run no broader than the bot's permission mode. Set the mode in the bot's composer.
- After 20 threads started since you last spoke, a bot stops and asks before starting more.
- Bots need a data directory outside a Git checkout, as threads without a project do.
- A bot's threads show which bot started them, and they are cleaned up on their own schedule. See
  [Storage cleanup](project-settings.md#work-a-bot-or-another-machine-started).

## Open animas

Click the sparkle button at the bottom of the sidebar, or run **Open animas** from
the command palette. The page has three views:

- **Dashboard** opens first. It shows totals, alerts with the reasons an anima needs
  tending, when each one was last active, the tensions they are holding (which you can
  resolve from there), and the full list with health and unread messages.
- **World** shows every anima as a creature in Lantern Yard. Crews live in their
  lead's town and others in their home project's town. A creature at its desk has
  a live session. One that wanders is resting, and one with its head down has been
  idle for two weeks or is paused. Click a creature to meet it, and double-click to
  open it.
- **Library** holds the shared notes animas shelve for each other.

Opening an anima shows its portrait: what it is holding now, its voice, who it has
become, the animas it is tied to, and its shape. Tabs hold its breaths, inbox, opens,
policy, threads and sync. **Play life** turns its breaths into chords, and the memory
chapter can download them as a WAV. **Breathe by hand** records a breath through the
anima CLI; editing the aim or opening and resolving a tension records one too. **Speak**
reads a short self-report aloud using your browser's voice.

On the anima page, `/` searches every anima's aims, tensions, decisions, open questions,
breath notes, identity and the library, and a result opens the breath or entry it came from.
`j` and `k` step through animas, and `Esc` returns to the dashboard. Click its creature to choose a different form. The choice is
saved to the anima, so other apps show the same creature.

The world moves only while it is on screen. Use the pause button to keep it
still. It also stays still when your system asks for reduced motion.

## Sync an anima between machines

With a second environment connected, an anima's **Sync** tab compares the two copies:
the breaths each machine has, the state that differs, and line diffs of its files.
**Merge both** keeps every breath from both machines, ordered by time. Anything only one
machine changed since they last synced takes that change, rule fires from both machines
are kept, and traits keep the more certain estimate. Files a sync does not carry, such as
session logs, stay on each machine.

When both machines changed the same hand-written part (identity, vow, style, role), the
tab lists it, and **Resolve with an agent** starts a thread that asks you how to settle
each one, showing both machines' versions and its proposal. When both changed their
policies, the thread also tidies them: it folds similar rules, clears rules that have not
fired in 30 days, keeps at most 40 active, and asks you once before using that. Once you
apply its result, both machines get it.

**Stay synced** keeps the two copies merged while the app is open and both machines are
connected. After a disconnect it catches up on reconnect. If both machines change the same
hand-written part, it pauses and tells you, and resumes once that conflict is resolved.
Each install keeps the five newest backups of an anima.

## Which anima CLI is used

The server runs the CLI named by `ANIMA_CLI` if it is set, then an `anima`
command on `PATH`, then the skill script at `~/.claude/skills/anima/anima.ts`.
Anima state lives in `ANIMA_HOME`, which defaults to `~/.claude/anima`. With
anima 0.2 or newer, breathing uses the CLI's own breathe guide and identity
refreshes use `anima brief`, so updating the CLI updates what agents receive.
