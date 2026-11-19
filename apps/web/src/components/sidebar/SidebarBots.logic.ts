import type { EnvironmentId } from "@t3tools/contracts";

export interface BotMachine {
  readonly environmentId: EnvironmentId;
  readonly label: string;
}

/**
 * A bot's memory stays on the machine it was started on, so new bots join the ones there are:
 * the machine with the most of them, and this one while there are none.
 */
export function resolveBotHome(
  bots: ReadonlyArray<{ readonly environmentId: EnvironmentId }>,
  machines: readonly BotMachine[],
  primary: EnvironmentId | null,
): EnvironmentId | null {
  const counts = new Map<EnvironmentId, number>();
  for (const bot of bots) counts.set(bot.environmentId, (counts.get(bot.environmentId) ?? 0) + 1);
  const fallback = machines.some((machine) => machine.environmentId === primary)
    ? primary
    : (machines[0]?.environmentId ?? null);
  return machines.reduce<EnvironmentId | null>(
    (home, machine) =>
      (counts.get(machine.environmentId) ?? 0) > (home === null ? 0 : (counts.get(home) ?? 0))
        ? machine.environmentId
        : home,
    fallback,
  );
}
