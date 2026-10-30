"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CommandIcon, SearchIcon } from "lucide-react";

import { docsSearchItems } from "@/components/docs/docs-search-data";

export function DocsSearch() {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const results = useDocsSearchResults(query);

  useDocsSearchShortcut(() => setOpen(true));

  return (
    <div className="relative min-w-0 w-full max-w-[450px]">
      <DocsSearchInput
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onChange={(value) => {
          setQuery(value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        query={query}
      />
      {open ? <DocsSearchResults query={query} results={results} /> : null}
    </div>
  );
}

function useDocsSearchShortcut(openSearch: () => void) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openSearch();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [openSearch]);
}

function DocsSearchInput({
  onBlur,
  onChange,
  onFocus,
  query,
}: {
  onBlur: () => void;
  onChange: (value: string) => void;
  onFocus: () => void;
  query: string;
}) {
  return (
    <label className="flex h-10 items-center rounded-full border border-border bg-background px-4 text-muted-foreground shadow-sm focus-within:ring-3 focus-within:ring-ring/30">
      <SearchIcon className="size-4" />
      <input
        className="ml-3 min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
        onBlur={onBlur}
        onChange={(event) => onChange(event.target.value)}
        onFocus={onFocus}
        placeholder="Find something..."
        type="search"
        value={query}
      />
      <span className="ml-3 hidden items-center gap-1 text-xs sm:flex">
        <CommandIcon className="size-3" /> K
      </span>
    </label>
  );
}

function useDocsSearchResults(query: string) {
  return useMemo(() => {
    const normalized = query.trim().toLowerCase();

    if (!normalized) {
      return docsSearchItems.slice(0, 7);
    }

    return docsSearchItems
      .filter((item) =>
        `${item.title} ${item.description} ${item.category} ${"keywords" in item ? item.keywords : ""}`
          .toLowerCase()
          .includes(normalized),
      )
      .slice(0, 8);
  }, [query]);
}

function DocsSearchResults({
  query,
  results,
}: {
  query: string;
  results: typeof docsSearchItems;
}) {
  return (
    <div className="absolute left-0 right-0 top-12 z-50 overflow-hidden rounded-2xl border border-border bg-popover p-2 shadow-2xl">
      {results.length ? (
        results.map((item) => (
          <DocsSearchResultItem item={item} key={item.href} />
        ))
      ) : (
        <p className="px-3 py-6 text-center text-sm text-muted-foreground">
          No docs found for “{query}”.
        </p>
      )}
    </div>
  );
}

function DocsSearchResultItem({
  item,
}: {
  item: (typeof docsSearchItems)[number];
}) {
  return (
    <Link
      className="block rounded-xl px-3 py-3 transition hover:bg-secondary"
      href={item.href}
    >
      <span className="text-xs font-black uppercase tracking-wide text-muted-foreground">
        {item.category}
      </span>
      <p className="mt-1 font-black text-popover-foreground">{item.title}</p>
      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
        {item.description}
      </p>
    </Link>
  );
}
