import { useState } from "react";
import type { AnimaCreateInput, EnvironmentId } from "@t3tools/contracts";

import { useProjects } from "../../state/entities";
import { animaEnvironment, useAnimaList } from "../../state/anima";
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
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Field, useAnimaMutation } from "./AnimaBits";
import { animaNameProblem, describeNameProblem } from "./animaVisuals.logic";

const NONE = "__none__";
const ROLES = ["agent", "lead", "architect"] as const;

export function NewAnimaDialog({
  environmentId,
  onClose,
  onCreated,
}: {
  readonly environmentId: EnvironmentId;
  readonly onClose: () => void;
  readonly onCreated: (name: string) => void;
}) {
  const [name, setName] = useState("");
  const [parent, setParent] = useState(NONE);
  const [projectPath, setProjectPath] = useState(NONE);
  const [role, setRole] = useState<(typeof ROLES)[number]>("agent");
  const [saving, setSaving] = useState(false);
  const { animas } = useAnimaList(environmentId);
  const projects = useProjects().filter((project) => project.environmentId === environmentId);
  const [serverError, setServerError] = useState<string | null>(null);
  const trimmed = name.trim();
  const create = useAnimaMutation(animaEnvironment.create, {
    failureTitle: "Could not create anima",
    successTitle: `Created ${trimmed}`,
    onFailure: setServerError,
  });
  const problem = animaNameProblem(
    name,
    animas.map((anima) => anima.name),
  );
  const nameError = describeNameProblem(problem);
  const valid = problem === null;

  const submit = async () => {
    if (!valid || saving) return;
    setSaving(true);
    setServerError(null);
    const input = {
      name: trimmed,
      role,
      ...(parent !== NONE ? { parent } : {}),
      ...(projectPath !== NONE ? { fromProjectPath: projectPath } : {}),
    } as AnimaCreateInput;
    const result = await create({ environmentId, input });
    setSaving(false);
    if (result) {
      onCreated(trimmed);
      onClose();
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>New anima</DialogTitle>
          <DialogDescription>
            A persistent identity stored on this environment. A child inherits its parent's
            identity.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="space-y-4">
            <Field label="Name" htmlFor="anima-name">
              <Input
                id="anima-name"
                autoFocus
                value={name}
                placeholder="ada"
                aria-invalid={nameError !== null}
                onChange={(event) => {
                  setName(event.target.value);
                  setServerError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void submit();
                }}
              />
              {nameError ? <p className="text-2xs text-destructive">{nameError}</p> : null}
            </Field>
            <Field label="Role">
              <Select value={role} onValueChange={(value) => setRole(value as typeof role)}>
                <SelectTrigger size="sm">
                  <SelectValue>{role}</SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {ROLES.map((entry) => (
                    <SelectItem key={entry} value={entry} label={entry}>
                      {entry}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </Field>
            <Field label="Parent" hint="Optional">
              <Select value={parent} onValueChange={(value) => setParent(String(value))}>
                <SelectTrigger size="sm">
                  <SelectValue>{parent === NONE ? "None" : parent}</SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  <SelectItem value={NONE} label="None">
                    None
                  </SelectItem>
                  {animas.map((anima) => (
                    <SelectItem key={anima.name} value={anima.name} label={anima.name}>
                      {anima.name}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </Field>
            <Field label="Learn from project" hint="Optional">
              <Select value={projectPath} onValueChange={(value) => setProjectPath(String(value))}>
                <SelectTrigger size="sm">
                  <SelectValue>
                    {projectPath === NONE
                      ? "None"
                      : (projects.find((project) => project.workspaceRoot === projectPath)?.title ??
                        projectPath)}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  <SelectItem value={NONE} label="None">
                    None
                  </SelectItem>
                  {projects.map((project) => (
                    <SelectItem
                      key={project.id}
                      value={project.workspaceRoot}
                      label={project.title}
                    >
                      {project.title}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </Field>
          </div>
          {serverError ? (
            <p role="alert" className="mt-4 whitespace-pre-wrap text-xs text-destructive">
              {serverError}
            </p>
          ) : null}
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button disabled={!valid || saving} onClick={() => void submit()}>
            {saving ? "Creating..." : "Create"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
