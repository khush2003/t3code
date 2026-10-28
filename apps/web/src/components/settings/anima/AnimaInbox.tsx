import { useAtomValue } from "@effect/atom-react";
import { CornerDownRightIcon, InboxIcon, ReplyIcon, SendIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import type { AnimaDetail, AnimaInboxMessage, AnimaName, EnvironmentId } from "@t3tools/contracts";

import { cn } from "../../../lib/utils";
import { requestConfirmDialog } from "../../../confirmDialog";
import { animaEnvironment, useAnimaList } from "../../../state/anima";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../../ui/empty";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../../ui/select";
import { Textarea } from "../../ui/textarea";
import {
  ANIMA_MESSAGE_TYPES,
  type AnimaInboxThread,
  type AnimaMessageType,
  isInboxMessageSettled,
  isReplyableMessageId,
  threadInbox,
} from "../animaSettings.logic";
import { RelativeTime, useAnimaMutation } from "./AnimaBits";

const TYPE_VARIANTS: Readonly<
  Record<string, "error" | "warning" | "info" | "success" | "secondary" | "outline">
> = {
  blocker: "error",
  directive: "warning",
  query: "info",
  consult: "info",
  feedback: "success",
  info: "secondary",
};

const SELF = "__user__";
const LONG_BODY = 480;

function MessageBubble({
  message,
  owner,
  reply,
  canReply,
  onReply,
}: {
  readonly message: AnimaInboxMessage;
  readonly owner: string;
  readonly reply: boolean;
  readonly canReply: boolean;
  readonly onReply: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const settled = isInboxMessageSettled(message);
  const long = message.body.length > LONG_BODY;
  return (
    <div
      className={cn(
        "space-y-1 rounded-lg border px-3 py-2",
        settled ? "border-border/40 bg-transparent" : "border-border/70 bg-card",
        reply && "ms-5",
      )}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-muted-foreground">
        {reply ? <CornerDownRightIcon className="size-3" /> : null}
        <Badge size="sm" variant={TYPE_VARIANTS[message.type] ?? "outline"}>
          {message.type}
        </Badge>
        <span className="font-medium text-foreground/80">{message.from || "unknown"}</span>
        {message.to && message.to !== owner ? <span>to {message.to}</span> : null}
        <RelativeTime value={message.ts || null} />
        {message.status ? (
          <Badge size="sm" variant="outline">
            {message.status}
          </Badge>
        ) : (
          <span className="inline-flex items-center gap-1 text-primary">
            <span aria-hidden className="size-1.5 rounded-full bg-primary" />
            new
          </span>
        )}
        {canReply ? (
          <Button
            size="micro"
            variant="ghost-muted"
            className="ms-auto"
            aria-label={`Reply to ${message.from}`}
            onClick={onReply}
          >
            <ReplyIcon />
            Reply
          </Button>
        ) : null}
      </div>
      <p
        className={cn(
          "whitespace-pre-wrap break-words text-sm",
          settled && "text-foreground/70",
          long && !expanded && "line-clamp-6",
        )}
      >
        {message.body}
      </p>
      {long ? (
        <button
          type="button"
          className="text-xs text-primary hover:underline"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      ) : null}
    </div>
  );
}

function InboxThread({
  thread,
  environmentId,
  owner,
  canOperate,
}: {
  readonly thread: AnimaInboxThread;
  readonly environmentId: EnvironmentId;
  readonly owner: AnimaName;
  readonly canOperate: boolean;
}) {
  const [replyingTo, setReplyingTo] = useState<AnimaInboxMessage | null>(null);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const run = useAnimaMutation(animaEnvironment.inboxAction, {
    failureTitle: "Could not send reply",
    successTitle: replyingTo ? `Reply sent to ${replyingTo.from}` : "Reply sent",
  });
  const send = async () => {
    const text = body.trim();
    if (!replyingTo || text === "" || sending) return;
    setSending(true);
    const result = await run({
      environmentId,
      input: { name: owner, action: { type: "reply", messageId: replyingTo.id, body: text } },
    });
    setSending(false);
    if (result) {
      setBody("");
      setReplyingTo(null);
    }
  };
  return (
    <li className="space-y-1.5">
      {thread.answers ? (
        <p className="text-2xs text-muted-foreground">
          In reply to <span className="font-mono">{thread.answers}</span>
        </p>
      ) : null}
      {thread.messages.map((message, index) => (
        <MessageBubble
          key={message.id || `${message.ts}:${index}`}
          message={message}
          owner={owner}
          reply={index > 0}
          canReply={
            canOperate &&
            message.from !== "" &&
            message.from !== owner &&
            isReplyableMessageId(message.id)
          }
          onReply={() => setReplyingTo(message)}
        />
      ))}
      {replyingTo ? (
        <div className="ms-5 space-y-1.5">
          <Textarea
            size="sm"
            autoFocus
            value={body}
            aria-label={`Reply to ${replyingTo.from}`}
            placeholder={`Reply to ${replyingTo.from} as ${owner}`}
            onChange={(event) => setBody(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void send();
              if (event.key === "Escape") setReplyingTo(null);
            }}
          />
          <div className="flex items-center justify-end gap-2">
            <span className="me-auto text-2xs text-muted-foreground">
              Lands in {replyingTo.from}'s inbox
            </span>
            <Button size="xs" variant="ghost" onClick={() => setReplyingTo(null)}>
              Cancel
            </Button>
            <Button size="xs" disabled={body.trim() === "" || sending} onClick={() => void send()}>
              <SendIcon />
              Reply
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

function Composer({
  environmentId,
  owner,
  canOperate,
}: {
  readonly environmentId: EnvironmentId;
  readonly owner: AnimaName;
  readonly canOperate: boolean;
}) {
  const { animas } = useAnimaList(environmentId);
  const [type, setType] = useState<AnimaMessageType>("directive");
  const [from, setFrom] = useState(SELF);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const run = useAnimaMutation(animaEnvironment.inboxAction, {
    failureTitle: "Could not send message",
    successTitle: `Message sent to ${owner}`,
  });
  const senders = animas.filter((anima) => anima.name !== owner);
  const send = async () => {
    const text = body.trim();
    if (text === "" || sending) return;
    setSending(true);
    const result = await run({
      environmentId,
      input: {
        name: owner,
        action: {
          type: "send",
          messageType: type,
          body: text,
          ...(from === SELF ? {} : { from: from as AnimaName }),
        },
      },
    });
    setSending(false);
    if (result) setBody("");
  };
  return (
    <div className="space-y-2 border-b border-border/50 px-3 py-3 sm:px-4">
      <Textarea
        size="sm"
        value={body}
        disabled={!canOperate}
        aria-label={`Message to ${owner}`}
        placeholder={`Write to ${owner}…`}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void send();
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-40">
          <Select value={type} onValueChange={(value) => setType(value as AnimaMessageType)}>
            <SelectTrigger size="sm" aria-label="Message type">
              <SelectValue>{type}</SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {ANIMA_MESSAGE_TYPES.map((entry) => (
                <SelectItem key={entry} value={entry} label={entry}>
                  {entry}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>
        <div className="w-40">
          <Select value={from} onValueChange={(value) => setFrom(String(value))}>
            <SelectTrigger size="sm" aria-label="Send as">
              <SelectValue>{from === SELF ? "From you" : `From ${from}`}</SelectValue>
            </SelectTrigger>
            <SelectPopup>
              <SelectItem value={SELF} label="You">
                You
              </SelectItem>
              {senders.map((anima) => (
                <SelectItem key={anima.name} value={anima.name} label={anima.name}>
                  {anima.name}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>
        <span className="hidden text-2xs text-muted-foreground sm:inline">Ctrl/⌘ + Enter</span>
        <Button
          size="xs"
          className="ms-auto"
          disabled={!canOperate || body.trim() === "" || sending}
          onClick={() => void send()}
        >
          <SendIcon />
          Send
        </Button>
      </div>
    </div>
  );
}

export function InboxTab({
  environmentId,
  detail,
}: {
  readonly environmentId: EnvironmentId;
  readonly detail: AnimaDetail;
}) {
  const owner = detail.summary.name;
  const canOperate = useAtomValue(animaEnvironment.inboxAction.permissionAtom(environmentId));
  const clear = useAnimaMutation(animaEnvironment.inboxAction, {
    failureTitle: "Could not clear inbox",
    successTitle: "Inbox cleared",
  });
  const threads = threadInbox(detail.inbox);
  const unsettled = threads.reduce((sum, thread) => sum + thread.unsettled, 0);
  const confirmClear = async () => {
    const confirmed =
      (await requestConfirmDialog(
        `Clear ${owner}'s inbox?\nMessages that arrived before its last breath or session start are removed. Later ones stay.`,
        { variant: "destructive" },
      )) ?? window.confirm(`Clear ${owner}'s inbox?`);
    if (!confirmed) return;
    await clear({ environmentId, input: { name: owner, action: { type: "clear" } } });
  };
  return (
    <div>
      <div className="flex items-center gap-2 border-b border-border/50 px-3 py-2.5 sm:px-4">
        <span className="text-xs text-muted-foreground">
          {detail.inbox.length} {detail.inbox.length === 1 ? "message" : "messages"}
          {unsettled > 0 ? ` · ${unsettled} new` : ""}
        </span>
        <Button
          size="xs"
          variant="ghost-destructive"
          className="ms-auto"
          disabled={!canOperate || detail.inbox.length === 0}
          onClick={() => void confirmClear()}
        >
          <Trash2Icon />
          Clear
        </Button>
      </div>
      <Composer environmentId={environmentId} owner={owner} canOperate={canOperate} />
      {threads.length === 0 ? (
        <Empty size="compact">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <InboxIcon />
            </EmptyMedia>
            <EmptyTitle>Inbox is empty</EmptyTitle>
            <EmptyDescription>
              Messages from you and other animas land here and reach {owner} at its next wake.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="space-y-3 px-3 py-3 sm:px-4">
          {threads.map((thread) => (
            <InboxThread
              key={thread.key}
              thread={thread}
              environmentId={environmentId}
              owner={owner}
              canOperate={canOperate}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
