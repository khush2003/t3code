import type { AnimaSearchHit, AnimaSummary, EnvironmentId } from "@t3tools/contracts";
import {
  BookOpenIcon,
  CheckCircle2Icon,
  CircleDotIcon,
  CompassIcon,
  FileTextIcon,
  FlameIcon,
  FolderIcon,
  IdCardIcon,
  QuoteIcon,
  SparklesIcon,
  StickyNoteIcon,
  WindIcon,
  ZapIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { cn } from "../../lib/utils";
import { useAnimaSearch } from "../../state/anima";
import { Badge } from "../ui/badge";
import { Dialog, DialogPopup, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { searchAnimas } from "./animaDashboard.logic";
import { SoulOrb } from "./AnimaSoul";

/** Where a search result leads: an anima (optionally one of its breaths or tabs), or a library entry. */
export type AnimaSearchTarget =
  | {
      readonly anima: string;
      readonly tab?: "breaths" | "identity";
      readonly breath?: number;
    }
  | { readonly library: string };

type ResultType = AnimaSearchHit["type"] | "project";

interface Result {
  readonly key: string;
  readonly type: ResultType;
  readonly anima: string | null;
  readonly title: string;
  readonly snippet: string;
  readonly breath: number | null;
  readonly status: "done" | "open" | null;
  readonly slug?: string | undefined;
}

const GROUPS: ReadonlyArray<{
  readonly type: ResultType;
  readonly label: string;
  readonly icon: ReactNode;
}> = [
  { type: "anima", label: "Animas", icon: <SparklesIcon /> },
  { type: "aim", label: "Aims", icon: <CompassIcon /> },
  { type: "tension", label: "Tensions", icon: <ZapIcon /> },
  { type: "decision", label: "Decisions and open questions", icon: <CheckCircle2Icon /> },
  { type: "breath", label: "Breaths", icon: <WindIcon /> },
  { type: "vow", label: "Vows", icon: <QuoteIcon /> },
  { type: "memo", label: "Memos", icon: <StickyNoteIcon /> },
  { type: "skill", label: "Skills", icon: <FlameIcon /> },
  { type: "identity", label: "Identity", icon: <IdCardIcon /> },
  { type: "library", label: "Library", icon: <BookOpenIcon /> },
  { type: "project", label: "Projects", icon: <FolderIcon /> },
];

function targetOf(result: Result): AnimaSearchTarget | null {
  if (result.type === "library") return result.slug ? { library: result.slug } : null;
  if (result.anima === null) return null;
  if (result.breath !== null) return { anima: result.anima, tab: "breaths", breath: result.breath };
  if (result.type === "identity") return { anima: result.anima, tab: "identity" };
  return { anima: result.anima };
}

/** Section and book titles add context; for the rest the title repeats the matched text. */
function showsTitle(result: Result) {
  return (
    (result.type === "identity" || result.type === "library" || result.type === "breath") &&
    result.title !== result.snippet &&
    result.title !== result.anima
  );
}

function Highlight({ text, query }: { readonly text: string; readonly query: string }) {
  const needle = query.trim().toLowerCase();
  const at = needle === "" ? -1 : text.toLowerCase().indexOf(needle);
  if (at < 0) return <>{text}</>;
  const end = at + needle.length;
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded-sm bg-warning/30 text-foreground">{text.slice(at, end)}</mark>
      {text.slice(end)}
    </>
  );
}

const SEARCH_DEBOUNCE_MS = 200;

/**
 * Search over every anima. Roster matches show at once; the environment's deep search (breath
 * files, identity, the library) replaces them when it answers, and older servers keep the roster's.
 */
export function AnimaSearchPanel({
  environmentId,
  animas,
  onPick,
  inputId,
  autoFocus = false,
  floating = false,
}: {
  readonly environmentId: EnvironmentId | null;
  readonly animas: ReadonlyArray<AnimaSummary>;
  readonly onPick: (target: AnimaSearchTarget) => void;
  readonly inputId?: string;
  readonly autoFocus?: boolean;
  /** Results drop below the input instead of filling the panel. */
  readonly floating?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [active, setActive] = useState(0);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- debounces typing on a timer so each keystroke does not query the environment
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);
  const ready = query.trim().length >= 2;
  const deep = useAnimaSearch(environmentId, ready ? debounced : "");
  const byName = new Map(animas.map((anima) => [anima.name, anima]));
  const settled = ready && debounced === query && deep.data !== null;
  const results: ReadonlyArray<Result> = settled
    ? deep.results.map((hit, index) => ({ ...hit, key: `${index}:${hit.type}:${hit.title}` }))
    : searchAnimas(animas, query).map((hit) => ({
        key: `${hit.anima}:${hit.kind}:${hit.text}`,
        type: hit.kind,
        anima: hit.anima,
        title: hit.anima,
        snippet: hit.kind === "anima" ? "" : hit.text,
        breath: null,
        status: null,
      }));
  const groups = GROUPS.flatMap((group) => {
    const items = results.filter((result) => result.type === group.type);
    return items.length > 0 ? [{ ...group, items }] : [];
  });
  const ordered = groups.flatMap((group) => group.items);
  const choose = (result: Result | undefined) => {
    const target = result ? targetOf(result) : null;
    if (!target) return;
    setQuery("");
    onPick(target);
  };
  const searching = ready && !settled && (deep.isPending || debounced !== query);
  const list = ready ? (
    <div
      className={cn(
        "overflow-hidden",
        floating &&
          "absolute inset-x-0 top-full z-20 mt-2 rounded-2xl border border-border/70 bg-popover shadow-lg",
      )}
    >
      {ordered.length === 0 ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">
          {searching ? "Searching..." : "No results"}
        </p>
      ) : (
        <div
          role="listbox"
          aria-label="Search results"
          className="max-h-[60vh] overflow-y-auto py-1"
        >
          {groups.map((group) => (
            <div key={group.type} role="group" aria-label={group.label}>
              <p className="flex items-center gap-1.5 px-4 pt-2.5 pb-1 text-2xs font-medium tracking-wide text-muted-foreground uppercase [&_svg]:size-3">
                {group.icon}
                {group.label}
              </p>
              {group.items.map((result) => {
                const index = ordered.indexOf(result);
                const anima = result.anima ? byName.get(result.anima) : undefined;
                return (
                  <button
                    key={result.key}
                    type="button"
                    role="option"
                    aria-selected={index === active}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => choose(result)}
                    className={cn(
                      "flex w-full items-start gap-3 px-4 py-2 text-left outline-none",
                      index === active && "bg-accent",
                    )}
                  >
                    {anima ? (
                      <SoulOrb anima={anima} size={20} />
                    ) : (
                      <FileTextIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 text-xs">
                        <span className="shrink-0 font-semibold">
                          {result.anima ?? <Highlight text={result.title} query={query} />}
                        </span>
                        {result.anima && showsTitle(result) ? (
                          <span className="truncate text-muted-foreground">
                            <Highlight text={result.title} query={query} />
                          </span>
                        ) : null}
                        {result.breath !== null ? (
                          <span className="shrink-0 text-muted-foreground tabular-nums">
                            #{result.breath}
                          </span>
                        ) : null}
                        {result.status ? (
                          <Badge size="sm" variant={result.status === "done" ? "success" : "info"}>
                            {result.status === "done" ? <CheckCircle2Icon /> : <CircleDotIcon />}
                            {result.status}
                          </Badge>
                        ) : null}
                      </span>
                      {result.snippet ? (
                        <span className="line-clamp-2 text-sm text-foreground/85">
                          <Highlight text={result.snippet} query={query} />
                        </span>
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
      {searching && ordered.length > 0 ? (
        <p className="border-t border-border/50 px-4 py-1.5 text-2xs text-muted-foreground">
          Searching breaths, identity and the library...
        </p>
      ) : null}
    </div>
  ) : null;
  return (
    <div className={cn(floating && "relative")}>
      <Input
        id={inputId}
        value={query}
        autoFocus={autoFocus}
        placeholder="Search animas, breaths, decisions, identity, library...   ( / )"
        aria-label="Search animas"
        autoComplete="off"
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive((index) => Math.min(ordered.length - 1, index + 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((index) => Math.max(0, index - 1));
          } else if (event.key === "Enter") {
            choose(ordered[active]);
          } else if (event.key === "Escape" && query !== "") {
            event.stopPropagation();
            setQuery("");
          } else if (event.key === "Escape") {
            event.currentTarget.blur();
          }
        }}
      />
      {floating ? list : <div className="mt-2">{list}</div>}
    </div>
  );
}

/** The search as a palette, for pages without the dashboard's search box. */
export function AnimaSearchDialog({
  open,
  onOpenChange,
  environmentId,
  animas,
  onPick,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly environmentId: EnvironmentId | null;
  readonly animas: ReadonlyArray<AnimaSummary>;
  readonly onPick: (target: AnimaSearchTarget) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-2xl" showCloseButton={false}>
        <DialogTitle className="sr-only">Search animas</DialogTitle>
        <div className="p-3">
          <AnimaSearchPanel
            environmentId={environmentId}
            animas={animas}
            autoFocus
            onPick={(target) => {
              onOpenChange(false);
              onPick(target);
            }}
          />
        </div>
      </DialogPopup>
    </Dialog>
  );
}
