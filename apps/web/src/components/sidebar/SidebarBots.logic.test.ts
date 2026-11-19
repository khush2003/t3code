import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { resolveBotHome } from "./SidebarBots.logic";

const laptop = EnvironmentId.make("laptop");
const server = EnvironmentId.make("server");
const machines = [
  { environmentId: laptop, label: "Laptop" },
  { environmentId: server, label: "Server" },
];
const on = (...ids: EnvironmentId[]) => ids.map((environmentId) => ({ environmentId }));

describe("resolveBotHome", () => {
  it.each([
    ["this machine while there are no bots", on(), machines, laptop, laptop],
    ["the machine that already has the bots", on(server), machines, laptop, server],
    ["the machine with the most bots", on(laptop, server, server), machines, laptop, server],
    ["this machine on a tie", on(laptop, server), machines, laptop, laptop],
    ["a connected machine when the bots' one is not", on(server), [machines[0]!], laptop, laptop],
    ["nowhere with no machine connected", on(server), [], laptop, null],
  ])("picks %s", (_name, bots, connected, primary, home) => {
    expect(resolveBotHome(bots, connected, primary)).toBe(home);
  });
});
