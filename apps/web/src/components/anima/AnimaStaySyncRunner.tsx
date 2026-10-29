import { RegistryContext } from "@effect/atom-react";
import { syncAnimaPair } from "@t3tools/client-runtime/anima-sync";
import type { AnimaName, EnvironmentId } from "@t3tools/contracts";
import { useContext, useEffect, useRef } from "react";

import { useStableCallback } from "../../hooks/useStableCallback";
import { createAnimaSyncPorts, describeAnimaError, useAnimaList } from "../../state/anima";
import { useEnvironments } from "../../state/environments";
import { isConnectedWithConfig } from "../settings/scopedSettings";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { type StaySyncLink, useAnimaStaySyncStore } from "./animaStaySync";

/** Keeps every stay-synced anima pair merged while this client sees both machines connected. */
export function AnimaStaySyncRunner() {
  const links = useAnimaStaySyncStore((state) => state.links);
  return Object.entries(links).map(([key, link]) => (
    <StaySyncWorker key={key} linkKey={key} link={link} />
  ));
}

export function useRunStaySync() {
  const registry = useContext(RegistryContext);
  const { environments } = useEnvironments();
  const setStatus = useAnimaStaySyncStore((state) => state.setStatus);
  const setPaused = useAnimaStaySyncStore((state) => state.setPaused);
  return useStableCallback(
    async (
      key: string,
      link: StaySyncLink,
      present: { readonly first: boolean; readonly second: boolean },
    ) => {
      const labelOf = (environmentId: EnvironmentId) =>
        environments.find((entry) => entry.environmentId === environmentId)?.label ?? environmentId;
      setStatus(key, { state: "syncing" });
      try {
        const result = await syncAnimaPair(
          {
            name: link.name as AnimaName,
            first: link.first as EnvironmentId,
            second: link.second as EnvironmentId,
            present,
          },
          createAnimaSyncPorts(registry, labelOf),
        );
        if (result.status === "conflicts" || result.status === "unrelated") {
          const conflicts =
            result.status === "unrelated"
              ? ["a different anima with the same name"]
              : result.conflicts.map((conflict) => conflict.key ?? conflict.path);
          const fresh = link.paused?.conflicts.join() !== conflicts.join();
          setPaused(key, conflicts);
          setStatus(key, { state: "waiting" });
          if (fresh) {
            toastManager.add(
              stackedThreadToast({
                type: "warning",
                title: `${link.name} paused syncing`,
                description: `Both machines changed ${conflicts.join(", ")}. Resolve it in the anima's Sync tab.`,
              }),
            );
          }
          return;
        }
        if (link.paused) setPaused(key, null);
        setStatus(key, { state: "synced", at: Date.now() });
      } catch (error) {
        setStatus(key, { state: "error", message: describeAnimaError(error) });
      }
    },
  );
}

function StaySyncWorker({
  linkKey,
  link,
}: {
  readonly linkKey: string;
  readonly link: StaySyncLink;
}) {
  const { environments } = useEnvironments();
  const setStatus = useAnimaStaySyncStore((state) => state.setStatus);
  const runSync = useRunStaySync();
  const connected = [link.first, link.second].every((id) => {
    const environment = environments.find((entry) => entry.environmentId === id);
    return environment !== undefined && isConnectedWithConfig(environment);
  });
  const firstList = useAnimaList(connected ? (link.first as EnvironmentId) : null);
  const secondList = useAnimaList(connected ? (link.second as EnvironmentId) : null);
  const first = firstList.animas.find((anima) => anima.name === link.name);
  const second = secondList.animas.find((anima) => anima.name === link.name);
  const loaded = firstList.data !== null && secondList.data !== null;
  // Digests change whenever either copy does, and come back after a reconnect.
  const signature = connected && loaded ? `${first?.digest ?? "-"}:${second?.digest ?? "-"}` : null;
  const running = useRef(false);
  const run = useStableCallback(async () => {
    if (running.current) return;
    if (first?.digest === second?.digest) {
      if (link.paused) useAnimaStaySyncStore.getState().setPaused(linkKey, null);
      setStatus(linkKey, { state: "synced", at: Date.now() });
      return;
    }
    running.current = true;
    try {
      await runSync(linkKey, link, { first: first !== undefined, second: second !== undefined });
    } finally {
      running.current = false;
      firstList.refresh();
      secondList.refresh();
    }
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- copies the anima between two remote machines whenever either copy or a connection changes
  useEffect(() => {
    if (signature === null) setStatus(linkKey, { state: "waiting" });
    else void run();
  }, [signature, run, linkKey, setStatus]);
  return null;
}
