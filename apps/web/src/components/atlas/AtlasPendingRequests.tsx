import {
  AuthOrchestrationOperateScope,
  type ProviderApprovalDecision,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import type {
  PendingThreadRequests,
  ThreadPendingUserInput,
} from "@t3tools/client-runtime/state/thread-requests";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useState } from "react";
import {
  buildPendingUserInputAnswers,
  setPendingUserInputCustomAnswer,
  togglePendingUserInputOptionSelection,
  type PendingUserInputDraftAnswer,
} from "../../pendingUserInput";
import { useEnvironmentScope } from "../../state/session";
import { threadEnvironment } from "../../state/threads";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { Button } from "../ui/button";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import { ComposerPendingApprovalPanel } from "../chat/ComposerPendingApprovalPanel";
import { ComposerPendingApprovalActions } from "../chat/ComposerPendingApprovalActions";

function failureMessage(result: Parameters<typeof squashAtomCommandFailure>[0]): string {
  const error = squashAtomCommandFailure(result);
  return error instanceof Error ? error.message : "Could not send the response. Try again.";
}

function QuestionForm({
  threadRef,
  request,
  canOperate,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly request: ThreadPendingUserInput;
  readonly canOperate: boolean;
}) {
  const respond = useOrchestrationCommand(threadEnvironment.respondToUserInput, {
    reportFailure: false,
  });
  const [drafts, setDrafts] = useState<Record<string, PendingUserInputDraftAnswer>>(() =>
    Object.fromEntries(
      request.questions
        .filter((q) => q.initialAnswer !== undefined && q.allowCustomAnswer !== false)
        .map((q) => [q.id, { customAnswer: q.initialAnswer ?? "" }]),
    ),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const answers = buildPendingUserInputAnswers(request.questions, drafts);
  const disabled = !canOperate || busy || request.responseCapability === "not_resumable";
  const submit = async () => {
    if (disabled || answers === null) return;
    setBusy(true);
    setError(null);
    const result = await respond({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, requestId: request.requestId, answers },
    });
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result))
      setError(failureMessage(result));
    setBusy(false);
  };
  return (
    <div className="space-y-4">
      {request.questions.map((question) => (
        <fieldset key={question.id} disabled={disabled} className="min-w-0 space-y-2">
          <legend className="mb-1 text-xs font-medium text-muted-foreground">
            {question.header}
          </legend>
          <p className="whitespace-pre-wrap text-sm wrap-anywhere">{question.question}</p>
          {question.multiSelect ? (
            <p className="text-xs text-muted-foreground">Choose one or more options.</p>
          ) : null}
          <div className="flex flex-col gap-1.5">
            {question.options.map((option) => {
              const value = option.value ?? option.label;
              const selected = drafts[question.id]?.selectedOptionValues?.includes(value) ?? false;
              return (
                <div key={value} className="space-y-1">
                  <Button
                    size="sm"
                    variant={selected ? "secondary" : "outline"}
                    aria-pressed={selected}
                    disabled={disabled}
                    onClick={() =>
                      setDrafts((previous) => ({
                        ...previous,
                        [question.id]: togglePendingUserInputOptionSelection(
                          question,
                          previous[question.id],
                          value,
                        ),
                      }))
                    }
                  >
                    {option.label}
                  </Button>
                  {option.description && option.description !== option.label ? (
                    <p className="text-xs text-muted-foreground">{option.description}</p>
                  ) : null}
                </div>
              );
            })}
          </div>
          {question.allowCustomAnswer !== false ? (
            <div className="space-y-1.5">
              <Label htmlFor={`${request.requestId}-${question.id}`}>
                {question.options.length > 0 ? "Or write your answer" : "Your answer"}
              </Label>
              <Textarea
                id={`${request.requestId}-${question.id}`}
                value={drafts[question.id]?.customAnswer ?? ""}
                disabled={disabled}
                onChange={(event) =>
                  setDrafts((previous) => ({
                    ...previous,
                    [question.id]: setPendingUserInputCustomAnswer(
                      previous[question.id],
                      event.target.value,
                      question,
                    ),
                  }))
                }
              />
            </div>
          ) : null}
        </fieldset>
      ))}
      {request.responseCapability === "not_resumable" ? (
        <p className="text-xs text-warning">
          The provider is no longer connected. Open the thread to restart it.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      <Button size="sm" disabled={disabled || answers === null} onClick={() => void submit()}>
        {busy ? "Sending…" : "Send answer"}
      </Button>
    </div>
  );
}

export function AtlasPendingRequests({
  threadRef,
  pending,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly pending: PendingThreadRequests;
}) {
  const canOperate = useEnvironmentScope(threadRef.environmentId, AuthOrchestrationOperateScope);
  const respond = useOrchestrationCommand(threadEnvironment.respondToApproval, {
    reportFailure: false,
  });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const submitApproval = async (
    requestId: Parameters<typeof respond>[0]["input"]["requestId"],
    decision: ProviderApprovalDecision,
  ) => {
    if (!canOperate || busyId !== null) return;
    setBusyId(requestId);
    setError(null);
    const result = await respond({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, requestId, decision },
    });
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result))
      setError(failureMessage(result));
    setBusyId(null);
  };
  return (
    <div className="space-y-4 rounded-lg border bg-card p-3">
      {!canOperate ? (
        <p className="text-xs text-muted-foreground">
          This connection can view requests. Respond from a connection with permission to operate
          agents.
        </p>
      ) : null}
      {pending.approvals.map((approval) => (
        <div key={approval.requestId} className="space-y-2">
          <ComposerPendingApprovalPanel approval={approval} pendingCount={1} />
          <div className="flex flex-wrap gap-2">
            <ComposerPendingApprovalActions
              requestId={approval.requestId}
              isResponding={busyId === approval.requestId}
              canRespond={approval.responseCapability === "live"}
              disabled={!canOperate || busyId !== null || approval.responseCapability !== "live"}
              options={approval.options}
              onRespondToApproval={submitApproval}
            />
          </div>
        </div>
      ))}
      {pending.userInputs.map((request) => (
        <QuestionForm
          key={request.requestId}
          threadRef={threadRef}
          request={request}
          canOperate={canOperate}
        />
      ))}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
