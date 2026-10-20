import { useAtomValue } from "@effect/atom-react";
import type { AtlasInitiative, EnvironmentId, ProjectId } from "@t3tools/contracts";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { atlasEnvironment } from "../../state/atlas";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { stackedThreadToast, toastManager } from "../ui/toast";

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "The request failed.";
}

interface DraftDeliverable {
  readonly key: number;
  readonly value: string;
}

let nextDeliverableKey = 0;

function makeDeliverable(value = ""): DraftDeliverable {
  nextDeliverableKey += 1;
  return { key: nextDeliverableKey, value };
}

export function AtlasInitiativeDialog({
  environmentId,
  defaultProjectId,
  projects,
  open,
  initiative,
  onOpenChange,
  onSaved,
}: {
  readonly environmentId: EnvironmentId;
  readonly defaultProjectId: ProjectId | null;
  /** Projects a new initiative can be filed under; editing keeps its project. */
  readonly projects: ReadonlyArray<{ readonly id: ProjectId; readonly title: string }>;
  readonly open: boolean;
  readonly initiative: AtlasInitiative | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSaved: (initiative: AtlasInitiative) => void;
}) {
  const createInitiative = useAtomCommand(atlasEnvironment.createInitiative, {
    reportFailure: false,
  });
  const updateInitiative = useAtomCommand(atlasEnvironment.updateInitiative, {
    reportFailure: false,
  });
  const canCreate = useAtomValue(atlasEnvironment.createInitiative.permissionAtom(environmentId));
  const [title, setTitle] = useState(initiative?.title ?? "");
  const [brief, setBrief] = useState(initiative?.brief ?? "");
  const [deliverables, setDeliverables] = useState<ReadonlyArray<DraftDeliverable>>(() =>
    initiative && initiative.deliverables.length > 0
      ? initiative.deliverables.map((value) => makeDeliverable(value))
      : [makeDeliverable()],
  );
  const [projectId, setProjectId] = useState<ProjectId | null>(
    defaultProjectId ?? projects[0]?.id ?? null,
  );
  const [submitting, setSubmitting] = useState(false);

  const editing = initiative !== null;

  const submit = async () => {
    if (submitting) return;
    const cleanDeliverables = deliverables.map((entry) => entry.value.trim()).filter(Boolean);
    if (!title.trim() || !brief.trim()) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Initiative is incomplete",
          description: "Add a title and a brief describing the outcome.",
        }),
      );
      return;
    }
    const save = () => {
      if (editing) {
        return updateInitiative({
          environmentId,
          input: { initiativeId: initiative.id, title, brief, deliverables: cleanDeliverables },
        });
      }
      if (projectId === null) return null;
      return createInitiative({
        environmentId,
        input: { projectId, title, brief, deliverables: cleanDeliverables },
      });
    };
    const pending = save();
    if (pending === null) return;
    setSubmitting(true);
    const result = await pending;
    setSubmitting(false);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: editing ? "Could not update initiative" : "Could not create initiative",
            description: errorMessage(squashAtomCommandFailure(result)),
          }),
        );
      }
      return;
    }
    onSaved(result.value);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>{editing ? "Edit initiative" : "New initiative"}</DialogTitle>
          <DialogDescription>
            Describe the outcome and deliverables. A planning agent turns this into concrete tasks.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          {!editing && projects.length > 1 ? (
            <div className="space-y-1.5">
              <Label htmlFor="atlas-initiative-project">Project</Label>
              <Select
                value={projectId}
                onValueChange={(next) => {
                  if (next !== null) setProjectId(next as ProjectId);
                }}
              >
                <SelectTrigger id="atlas-initiative-project">
                  <SelectValue>
                    {projects.find((project) => project.id === projectId)?.title ??
                      "Choose a project"}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.title}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="atlas-initiative-title">Title</Label>
            <Input
              id="atlas-initiative-title"
              value={title}
              placeholder="Ship the checkout redesign"
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="atlas-initiative-brief">Brief</Label>
            <Textarea
              id="atlas-initiative-brief"
              value={brief}
              placeholder="What is the outcome, what exists today, and what must be true when it is done?"
              onChange={(event) => setBrief(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Deliverables</Label>
            <div className="space-y-2">
              {deliverables.map((entry) => (
                <div key={entry.key} className="flex items-center gap-2">
                  <Input
                    value={entry.value}
                    placeholder="A shippable result"
                    onChange={(event) =>
                      setDeliverables((current) =>
                        current.map((candidate) =>
                          candidate.key === entry.key
                            ? { ...candidate, value: event.target.value }
                            : candidate,
                        ),
                      )
                    }
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Remove deliverable"
                    disabled={deliverables.length === 1}
                    onClick={() =>
                      setDeliverables((current) =>
                        current.filter((candidate) => candidate.key !== entry.key),
                      )
                    }
                  >
                    <Trash2Icon />
                  </Button>
                </div>
              ))}
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setDeliverables((current) => [...current, makeDeliverable()])}
            >
              <PlusIcon />
              Add deliverable
            </Button>
          </div>
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
          <Button
            disabled={submitting || (!editing && (!canCreate || projectId === null))}
            onClick={() => void submit()}
          >
            {submitting ? "Saving…" : editing ? "Save changes" : "Create initiative"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
