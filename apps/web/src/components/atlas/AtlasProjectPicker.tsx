import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { ProjectId } from "@t3tools/contracts";
import { CheckIcon, ChevronsUpDownIcon, LayoutDashboardIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "../../lib/utils";
import { ProjectFavicon } from "../ProjectFavicon";
import { Button } from "../ui/button";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxSearchInput,
  ComboboxTrigger,
} from "../ui/combobox";
import { describeProjectSummary, type AtlasProjectSummary } from "./atlasDashboardLogic";

interface PickerOption {
  readonly value: string;
  readonly project: EnvironmentProject | null;
}

const OVERVIEW_OPTION: PickerOption = { value: "", project: null };

export function AtlasProjectPicker({
  projects,
  summaries,
  activeProjectId,
  onSelect,
}: {
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly summaries: ReadonlyMap<ProjectId, AtlasProjectSummary>;
  readonly activeProjectId: ProjectId | null;
  readonly onSelect: (projectId: ProjectId | null) => void;
}) {
  const [query, setQuery] = useState("");
  const options: ReadonlyArray<PickerOption> = [
    OVERVIEW_OPTION,
    ...projects.map((project) => ({ value: project.id, project })),
  ];
  const needle = query.trim().toLowerCase();
  const filteredOptions =
    needle.length === 0
      ? options
      : options.filter(
          (option) =>
            option.project !== null &&
            `${option.project.title} ${option.project.workspaceRoot}`
              .toLowerCase()
              .includes(needle),
        );
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? null;

  return (
    <Combobox
      items={options}
      filteredItems={filteredOptions}
      filter={null}
      autoHighlight
      itemToStringLabel={(option) => option.project?.title ?? "Overview"}
      isItemEqualToValue={(left, right) => left.value === right.value}
      value={options.find((option) => option.value === (activeProjectId ?? "")) ?? null}
      onOpenChange={(open) => {
        if (!open) setQuery("");
      }}
      onValueChange={(option) => {
        if (option) onSelect(option.project?.id ?? null);
      }}
    >
      <ComboboxTrigger
        aria-label={`Project: ${activeProject?.title ?? "All projects"}`}
        render={<Button size="sm" variant="ghost" className="w-full min-w-0 max-w-64" />}
      >
        {activeProject ? (
          <ProjectFavicon project={activeProject} className="size-4" />
        ) : (
          <LayoutDashboardIcon />
        )}
        <span className="min-w-0 truncate">{activeProject?.title ?? "All projects"}</span>
        <ChevronsUpDownIcon className="text-muted-foreground" />
      </ComboboxTrigger>
      <ComboboxPopup align="start" className="w-[22rem]">
        <ComboboxSearchInput
          aria-label="Search projects"
          placeholder="Search projects…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <ComboboxEmpty>No projects match.</ComboboxEmpty>
        <ComboboxList>
          {(option: PickerOption) => {
            const selected = option.value === (activeProjectId ?? "");
            if (option.project === null) {
              return (
                <ComboboxItem key="overview" value={option}>
                  <LayoutDashboardIcon className="size-5 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">All projects</span>
                    <span className="block truncate text-muted-foreground text-xs">
                      Overview of every initiative
                    </span>
                  </span>
                  {selected ? <CheckIcon aria-hidden className="size-3.5" /> : null}
                </ComboboxItem>
              );
            }
            const summary = summaries.get(option.project.id);
            return (
              <ComboboxItem key={option.value} value={option}>
                <ProjectFavicon project={option.project} className="size-5 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{option.project.title}</span>
                  <span
                    className={cn(
                      "block truncate text-xs",
                      summary && summary.running > 0
                        ? "text-info-foreground"
                        : "text-muted-foreground",
                    )}
                  >
                    {summary ? describeProjectSummary(summary) : "No initiatives yet"}
                  </span>
                </span>
                {selected ? <CheckIcon aria-hidden className="size-3.5" /> : null}
              </ComboboxItem>
            );
          }}
        </ComboboxList>
      </ComboboxPopup>
    </Combobox>
  );
}
