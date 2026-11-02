export interface AnimaOnboardingContext {
  /** Directory holding every anima, `<root>/<name>/`. */
  readonly root: string;
  /** Shell prefix that runs the anima CLI against `root`. */
  readonly cli: string;
  readonly existing: ReadonlyArray<{ readonly name: string; readonly role: string }>;
  /** The CLI's breathe guide; empty when the CLI has none. */
  readonly breatheGuide: string;
}

/**
 * Sent as a user message, so it must read as one request. The steps run in order because the
 * interview decides the name, role and identity that creation and the first breath need.
 */
export function renderAnimaOnboardingPrompt(context: AnimaOnboardingContext): string {
  const existing =
    context.existing.length === 0
      ? "There are no animas on this machine yet, so this one becomes the architect."
      : `Existing animas (names are taken): ${context.existing
          .map((anima) => `${anima.name} (${anima.role})`)
          .join(", ")}.`;
  return [
    "Set up a new anima with me: a persistent agent identity that wakes in future threads, keeps its own memory, and grows by breathing after real work.",
    "",
    "Work through these steps in order. Do not create anything until I have answered your questions.",
    "",
    "1. Gather context first, silently.",
    "   - Everything already said in this thread, and any T3 Code thread I reference.",
    "   - If this thread runs in a project and it is relevant to who the anima will be, skim the project: README, AGENTS.md or CLAUDE.md, the manifest files, and recent git history. Skip this when I say the anima is not tied to this project.",
    `   - ${existing} Read one with t3_anima_read only if I name it as a parent or model.`,
    "",
    "2. Interview me in ONE message, then wait for my answers. Offer a suggested answer for each question from what you gathered, so I can just confirm.",
    "   Identity:",
    "   - Name (lowercase letters, digits, dashes; must be new) and role: agent, lead (runs a team) or architect (creates animas).",
    "   - What it is for: the domain, projects or kind of work it owns.",
    "   - Voice: how it should talk to me (terse or explanatory, formal or casual, how it reports status).",
    "   - Values and vow: what it should care about most, and one sentence it holds itself to.",
    "   - Edges: what it must never do, or must always ask before doing.",
    "   - Whether it should inherit from an existing anima as a child, or start from this project's scan.",
    "   General:",
    "   - How much autonomy it gets: when to just act, and when to stop and ask.",
    "   - How I like to work with it: plans first or straight to code, how much verification, how it should handle mistakes.",
    "   - Anything it should know about me or my setup.",
    "   Follow up once if an answer is unclear. Do not invent answers I did not give.",
    "",
    "3. Create it with t3_anima_create (name, role, and parent or fromProjectPath when I chose one). If the tool is unavailable, run the CLI instead:",
    `   ${context.cli} init --name <name> --role <role>`,
    "",
    "4. Write its identity from my answers.",
    `   - Rewrite ${context.root}/<name>/identity.md in the anima's own first-person voice. Keep the template's section headings and replace each prompt under them with real content from the interview. Leave a section short rather than padding it.`,
    `   - In ${context.root}/<name>/agent.anima, fill the empty \`# vow:\` header line with the vow, and add a \`# style:\` header line after it with one or two sentences describing its voice. Do not touch the numeric trait lines (self, user, skills) or the breath rows: the CLI owns them.`,
    "   - Add 2 to 5 policy rules from my edges and autonomy answers with t3_anima_policy (action add, direct true), each as WHEN <condition> THEN <action>, ALWAYS <action> or NEVER <action>.",
    "   - If the anima belongs to this project, attach it with t3_anima_attach. Pick a look that suits it with t3_anima_clinic.",
    "",
    "5. Breathe it once, as its first real breath: the aim is what I set it up for, and the decisions are the identity choices we just made.",
    context.breatheGuide.trim() === ""
      ? `   Run \`${context.cli} breathe --agent <name>\` and follow what it prints.`
      : [
          "   Follow the breathe guide below from Step 1, with these overrides:",
          "   - This is a genesis breath: reflect only on this setup conversation, and say so plainly instead of inventing work.",
          "   - Skip the Step 0 gate and the bare template run. Write the full breathe command once from your answers.",
          `   - Run the CLI as \`${context.cli}\`.`,
          "   - If the CLI prints validation problems, fix exactly the fields it names and rerun once.",
          "<breathe-guide>",
          context.breatheGuide.trim(),
          "</breathe-guide>",
        ].join("\n"),
    "",
    "6. Finish with a short plain-language summary: the anima's name, role, what it is for, its vow and rules, and that I can pick it from the Anima menu when I start a new thread.",
  ].join("\n");
}
