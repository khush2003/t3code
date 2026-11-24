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

A bot's memory stays on the machine it was started on, and bots on different machines do not know
each other. Keep your bots on one machine that is always on. With more than one machine connected,
the dialog asks where the bot runs and suggests the machine your bots are already on.

- A bot keeps a board: each piece of work is a work item with its threads, and their status is read
  from the threads themselves, including threads on linked machines. The bot sees the board on
  every turn, so it keeps track even after its conversation is compacted. You see the same board
  under **Board** at the top of the bot's page, as one list: work that waits on you first, then work
  that is running, then open work with nothing running. Finished work is behind **Show done**. Open
  a work item for its tasks and files. **Files** lists everything the bot's tasks handed over.
- To keep one piece of work apart from the rest of the chat, use **Reply in thread** on any message
  in the bot's chat. The thread opens beside the chat and has its own conversation with the same
  bot, which keeps its charter, notes and board there. A message has one thread; the message shows
  how many replies it has, and **Threads** in the sidebar lists the threads of all your bots. A
  thread you open and close without writing in it is not kept. Nothing from a thread is posted in the main chat, and the bot can still recall it there.
- When a thread a bot started stops to ask a question, the bot is told. It answers when the answer
  follows from what you said, and asks you otherwise.
- A bot's charter holds what it is for and what you told it should hold from now on. Tell it, and it
  updates its charter.
- A bot uses T3 Code's own tools only. MCP servers you set up for Claude are not loaded into it.
- Every bot knows the others and what they are for, and one bot can tell another something or hand
  it work. The other gets a turn with the message, and what it says at the end of that turn goes
  back to the first bot, which then tells you. A bot may tell another twelve things an hour, so two
  of them cannot keep talking to each other.
- Tick **Oversees the other bots** when you start a bot to make it your one point of contact. Every
  turn it sees what each bot has open, it can read any bot's whole board, and it passes work to the
  bot whose purpose fits. Only a new bot can be given this.
- A bot keeps its whole conversation with you and every message of the threads it finished, in its
  own store. It searches them when you ask about earlier work, and can answer while a thread's
  machine is offline. A machine that stays unreachable for 14 days after a thread ends keeps that
  thread's messages to itself; the bot still has the thread's result.
- Every thread a bot starts belongs to a work item the bot made for it, so the board has one entry
  per piece of work.
- A background pass reads what is new in a bot's conversation and threads and keeps what is worth
  knowing later as notes: decisions with their reasons, your standing preferences, how work ended.
  It runs after a work item is closed, after a lot of new messages, or once a day, on the
  **Text generation** model from Settings, at most eight times a day per bot. Each note
  names the message and the passage it rests on, and one whose passage is not in that message is
  thrown away. A note that stops being true is marked so and kept, never deleted. If a pass fails,
  the bot still has everything it copied.
- A thread a bot started can hand it something to show you: a document, a screenshot, a recording,
  or a preview link. It appears under the work item on the board, and clicking it opens it. A file
  up to 200 MB is copied and kept on the bot's machine; a larger one stays where it was and the
  board says where. Kept copies share 10 GB across all bots, and past that the oldest are dropped
  while their entries stay. A thread on another machine cannot hand a file over yet.
- Every bot has a character whose face shows what it is doing: working, waiting on you, just
  answered, or asleep when nothing has happened for hours. Click it at the top of the card beside
  the bot's chat to choose another character, a plain icon, a colour, or a picture of your own. The sidebar shows it next to the bot's name, with how many of its work items
  wait on you.
- **Memory**, at the top of the bot's page, shows what the bot keeps between sessions, grouped by
  topic. Open a note for the passage it rests on and a way to the conversation it came from. You
  can reword a note, move it to another topic, forget it, and bring a forgotten one back. A note you add yourself is sent to
  the bot at the start of every session, and only you can remove it; of its own notes it is sent
  the newest and searches for the rest. Notes get their title and topic from the **Text
  generation** model a little after they are written. **How you want work done** holds the bot's
  purpose and your standing rules, which you can edit or restore from an earlier version.
- A bot's model session is replaced when it grows large or has been idle for six hours. The new
  session gets the charter, the notes, the board and the last few turns; everything earlier is in
  the bot's memory, which it searches. Nothing is summarized, so replacing a session costs no extra
  turn.
- A bot runs on Claude, on a lighter model by default, and has no shell or file tools, so it
  cannot do the work itself. Its threads use each project's default model.
- A thread can run no broader than the bot's permission mode. Set the mode in the bot's composer.
- After 20 threads started since you last spoke, a bot stops and asks before starting more.
- Bots need a data directory outside a Git checkout, as threads without a project do.
- A bot's threads show which bot started them, and they are cleaned up on their own schedule. See
  [Storage cleanup](project-settings.md#work-a-bot-or-another-machine-started).

## See and talk to your bots

The orbit button beside **Bots** in the sidebar opens every bot as a light in the dark. The bot
that oversees the others is in the middle, and it is the one you talk to. A bot with tasks
running has a spark circling it for each, and one that needs you sends out a ring. Select a bot
to bring its open work up beside it.

Press the microphone, then speak or type. What you say goes to the middle bot's chat as a message
that starts with `(voice)`, and its reply is read aloud while it is still being written. Start
talking to cut it off. Tasks it starts keep running while you carry on.

- Hearing you uses the speech model chosen in **Settings → Voice**, and needs one that
  transcribes as you speak. Without one you can still type.
- The voice is made on your device. The first use downloads it, about 260 MB, from Hugging Face.
- Use headphones if the bot keeps hearing itself.

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
