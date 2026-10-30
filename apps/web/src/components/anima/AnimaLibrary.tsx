import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { ArrowLeftIcon, BookOpenIcon, BookPlusIcon, FileTextIcon } from "lucide-react";
import { useContext, useState } from "react";
import type { AnimaName, EnvironmentId } from "@t3tools/contracts";

import { formatBytes } from "../../lib/formatBytes";
import { animaEnvironment, useAnimaList } from "../../state/anima";
import { useEnvironmentQuery } from "../../state/query";
import ChatMarkdown from "../ChatMarkdown";
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
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Skeleton } from "../ui/skeleton";
import { Textarea } from "../ui/textarea";
import { SettingsGroup } from "../settings/SettingsGroup";
import { filterLibrary, isLibrarySlugValid } from "./anima.logic";
import { Field, RelativeTime, useAnimaMutation } from "./AnimaBits";

const SHARED = "__shared__";

function ShelveDialog({
  environmentId,
  initialSlug,
  onClose,
  onShelved,
}: {
  readonly environmentId: EnvironmentId;
  readonly initialSlug: string;
  readonly onClose: () => void;
  readonly onShelved: (slug: string) => void;
}) {
  const { animas } = useAnimaList(environmentId);
  const [slug, setSlug] = useState(initialSlug);
  const [author, setAuthor] = useState(animas[0]?.name ?? "");
  const [forAnima, setForAnima] = useState(SHARED);
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const trimmedSlug = slug.trim();
  const shelve = useAnimaMutation(animaEnvironment.libraryShelve, {
    failureTitle: "Could not shelve",
    successTitle: `Shelved ${trimmedSlug}`,
    onFailure: setServerError,
  });
  const slugError =
    trimmedSlug !== "" && !isLibrarySlugValid(trimmedSlug)
      ? "Letters, numbers, dots, dashes and underscores; no leading symbol."
      : null;
  const valid = trimmedSlug !== "" && slugError === null && author !== "" && content.trim() !== "";
  const submit = async () => {
    if (!valid || saving) return;
    setSaving(true);
    setServerError(null);
    const result = await shelve({
      environmentId,
      input: {
        slug: trimmedSlug,
        author: author as AnimaName,
        content: content.trim(),
        ...(forAnima === SHARED ? {} : { forAnima: forAnima as AnimaName }),
      },
    });
    setSaving(false);
    if (result) {
      onShelved(trimmedSlug);
      onClose();
    }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>
            {initialSlug ? `Add to ${initialSlug}` : "Shelve to the library"}
          </DialogTitle>
          <DialogDescription>
            Knowledge every anima can read. Shelving to an existing slug appends a dated section.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="space-y-4">
            <Field label="Slug" htmlFor="library-slug">
              <Input
                id="library-slug"
                autoFocus={initialSlug === ""}
                value={slug}
                placeholder="websocket-backpressure"
                aria-invalid={slugError !== null}
                onChange={(event) => setSlug(event.target.value)}
              />
              {slugError ? <p className="text-2xs text-destructive">{slugError}</p> : null}
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Author">
                <Select value={author} onValueChange={(value) => setAuthor(String(value))}>
                  <SelectTrigger size="sm" aria-label="Author">
                    <SelectValue>{author === "" ? "Choose an anima" : author}</SelectValue>
                  </SelectTrigger>
                  <SelectPopup>
                    {animas.map((anima) => (
                      <SelectItem key={anima.name} value={anima.name} label={anima.name}>
                        {anima.name}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </Field>
              <Field label="Shelf" hint="Optional">
                <Select value={forAnima} onValueChange={(value) => setForAnima(String(value))}>
                  <SelectTrigger size="sm" aria-label="Shelf">
                    <SelectValue>
                      {forAnima === SHARED ? "Shared library" : `${forAnima}'s own shelf`}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup>
                    <SelectItem value={SHARED} label="Shared library">
                      Shared library
                    </SelectItem>
                    {animas.map((anima) => (
                      <SelectItem key={anima.name} value={anima.name} label={anima.name}>
                        {anima.name}'s own shelf
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </Field>
            </div>
            <Field label="Content" hint="Markdown" htmlFor="library-content">
              <Textarea
                id="library-content"
                autoFocus={initialSlug !== ""}
                value={content}
                placeholder="# What we learned"
                onChange={(event) => setContent(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void submit();
                }}
              />
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
            {saving ? "Shelving…" : "Shelve"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function LibraryReader({
  environmentId,
  slug,
  onBack,
  onAppend,
  canShelve,
}: {
  readonly environmentId: EnvironmentId;
  readonly slug: string;
  readonly onBack: () => void;
  readonly onAppend: () => void;
  readonly canShelve: boolean;
}) {
  const query = useEnvironmentQuery(
    animaEnvironment.libraryRead({ environmentId, input: { slug } }),
  );
  return (
    <SettingsGroup>
      <div className="flex items-center gap-2 px-3 py-2 sm:px-4">
        <Button size="xs" variant="ghost-muted" onClick={onBack}>
          <ArrowLeftIcon />
          Library
        </Button>
        <span className="min-w-0 truncate font-mono text-2xs text-muted-foreground">{slug}</span>
        <Button
          size="xs"
          variant="outline"
          className="ms-auto"
          disabled={!canShelve}
          onClick={onAppend}
        >
          <BookPlusIcon />
          Append
        </Button>
      </div>
      <div className="px-3 py-4 sm:px-4">
        {query.data ? (
          <ChatMarkdown text={query.data.content} cwd={undefined} environmentId={environmentId} />
        ) : query.error ? (
          <p className="text-xs text-destructive">{query.error}</p>
        ) : (
          <div className="space-y-2">
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-5/6" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        )}
      </div>
    </SettingsGroup>
  );
}

export function AnimaLibrary({
  environmentId,
  entry,
  onEntry,
}: {
  readonly environmentId: EnvironmentId;
  readonly entry: string | undefined;
  readonly onEntry: (slug: string | undefined) => void;
}) {
  const registry = useContext(RegistryContext);
  const list = useEnvironmentQuery(animaEnvironment.libraryList({ environmentId, input: {} }));
  const canShelve = useAtomValue(animaEnvironment.libraryShelve.permissionAtom(environmentId));
  const [query, setQuery] = useState("");
  const [shelving, setShelving] = useState<{ readonly slug: string } | null>(null);
  const entries = filterLibrary(list.data?.entries ?? [], query);
  const dialog = shelving ? (
    <ShelveDialog
      environmentId={environmentId}
      initialSlug={shelving.slug}
      onClose={() => setShelving(null)}
      onShelved={(slug) => {
        list.refresh();
        registry.refresh(animaEnvironment.libraryRead({ environmentId, input: { slug } }));
        onEntry(slug);
      }}
    />
  ) : null;

  if (entry) {
    return (
      <>
        <LibraryReader
          environmentId={environmentId}
          slug={entry}
          canShelve={canShelve}
          onBack={() => onEntry(undefined)}
          onAppend={() => setShelving({ slug: entry })}
        />
        {dialog}
      </>
    );
  }
  const total = list.data?.entries.length ?? 0;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 px-3 sm:px-4">
        <div className="min-w-0 flex-1">
          <Input
            type="search"
            size="sm"
            value={query}
            placeholder="Search titles and slugs"
            aria-label="Search the library"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <Button size="xs" disabled={!canShelve} onClick={() => setShelving({ slug: "" })}>
          <BookPlusIcon />
          Shelve
        </Button>
      </div>
      <SettingsGroup>
        {list.data === null ? (
          list.error ? (
            <p className="px-3 py-4 text-xs text-destructive sm:px-4">{list.error}</p>
          ) : (
            [0, 1, 2].map((key) => (
              <div key={key} className="flex items-center gap-3 px-3 py-3 sm:px-4">
                <Skeleton className="size-4" />
                <Skeleton className="h-3.5 w-48" />
              </div>
            ))
          )
        ) : total === 0 ? (
          <Empty size="compact">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <BookOpenIcon />
              </EmptyMedia>
              <EmptyTitle>The library is empty</EmptyTitle>
              <EmptyDescription>
                Shelve notes, decisions and how-tos so every anima can read them at wake.
              </EmptyDescription>
              <Button size="sm" disabled={!canShelve} onClick={() => setShelving({ slug: "" })}>
                <BookPlusIcon />
                Shelve the first entry
              </Button>
            </EmptyHeader>
          </Empty>
        ) : entries.length === 0 ? (
          <p className="px-3 py-4 text-xs text-muted-foreground sm:px-4">
            Nothing matches "{query.trim()}".
          </p>
        ) : (
          entries.map((item) => (
            <button
              key={item.slug}
              type="button"
              className="flex w-full items-center gap-3 px-3 py-2.5 text-left outline-none transition-colors hover:bg-accent/30 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-4"
              onClick={() => onEntry(item.slug)}
            >
              <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {item.title ?? item.slug}
                </span>
                {item.author || item.target || item.title ? (
                  <span className="block truncate text-2xs text-muted-foreground">
                    {[
                      item.author ? `by ${item.author}` : null,
                      item.target ? `for ${item.target}` : null,
                      item.title ? item.slug : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                ) : null}
                {item.preview ? (
                  <span className="block truncate text-xs text-foreground/70">{item.preview}</span>
                ) : null}
              </span>
              <span className="shrink-0 text-right text-2xs tabular-nums text-muted-foreground">
                <span className="block">{formatBytes(item.bytes)}</span>
                <RelativeTime value={item.modifiedAt} />
              </span>
            </button>
          ))
        )}
      </SettingsGroup>
      {dialog}
    </div>
  );
}
