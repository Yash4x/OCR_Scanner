"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { ComparisonLineRecord, ComparisonLineChangeType } from "@/lib/types";

type ComparisonFilter = "all" | "changed" | "added" | "removed" | "modified" | "formatting_only";

const filterOptions: Array<{ value: ComparisonFilter; label: string }> = [
  { value: "all", label: "Show all" },
  { value: "changed", label: "Changed only" },
  { value: "added", label: "Added" },
  { value: "removed", label: "Removed" },
  { value: "modified", label: "Modified" },
  { value: "formatting_only", label: "Formatting only" },
];

const changeTypeLabels: Record<ComparisonLineChangeType, string> = {
  unchanged: "Unchanged",
  modified: "Modified",
  added: "Added",
  removed: "Removed",
  moved: "Moved",
  formatting_only: "Formatting only",
};

const changeTypeStyles: Record<ComparisonLineChangeType, string> = {
  unchanged: "border-slate-200 bg-white",
  modified: "border-amber-200 bg-amber-50",
  added: "border-emerald-200 bg-emerald-50",
  removed: "border-rose-200 bg-rose-50",
  moved: "border-violet-200 bg-violet-50",
  formatting_only: "border-sky-200 bg-sky-50",
};

function changeTypeVariant(changeType: ComparisonLineChangeType) {
  switch (changeType) {
    case "added":
      return "success";
    case "removed":
      return "destructive";
    case "modified":
      return "warning";
    case "formatting_only":
      return "info";
    case "moved":
      return "moved";
    case "unchanged":
    default:
      return "secondary";
  }
}

function formatLocation(pageNumber: number | null, lineNumber: number | null) {
  if (pageNumber === null && lineNumber === null) {
    return "-";
  }

  return `Page ${pageNumber ?? "-"} • Line ${lineNumber ?? "-"}`;
}

function matchesSearch(line: ComparisonLineRecord, searchValue: string) {
  if (!searchValue) {
    return true;
  }

  const haystack = [
    line.old_text,
    line.new_text,
    line.section_title,
    line.old_page_number?.toString(),
    line.new_page_number?.toString(),
    line.old_line_number?.toString(),
    line.new_line_number?.toString(),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(searchValue.toLowerCase().trim());
}

export function ComparisonViewer({ lines }: { lines: ComparisonLineRecord[] }) {
  const [filter, setFilter] = useState<ComparisonFilter>("all");
  const [search, setSearch] = useState("");
  const [selectedLineId, setSelectedLineId] = useState<string | null>(lines[0]?.id ?? null);

  const stats = useMemo(() => {
    const total = lines.length;
    const added = lines.filter((line) => line.change_type === "added").length;
    const removed = lines.filter((line) => line.change_type === "removed").length;
    const modified = lines.filter((line) => line.change_type === "modified").length;
    const unchanged = lines.filter((line) => line.change_type === "unchanged").length;

    return { total, added, removed, modified, unchanged };
  }, [lines]);

  const visibleLines = useMemo(() => {
    return lines.filter((line) => {
      const matchesFilter =
        filter === "all"
          ? true
          : filter === "changed"
            ? line.change_type !== "unchanged"
            : line.change_type === filter;

      return matchesFilter && matchesSearch(line, search);
    });
  }, [filter, lines, search]);

  useEffect(() => {
    if (visibleLines.length === 0) {
      setSelectedLineId(null);
      return;
    }

    if (!visibleLines.some((line) => line.id === selectedLineId)) {
      setSelectedLineId(visibleLines[0].id);
    }
  }, [selectedLineId, visibleLines]);

  const selectedLine = visibleLines.find((line) => line.id === selectedLineId) ?? null;

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-20 space-y-4 rounded-xl border border-slate-200 bg-slate-50/95 p-4 backdrop-blur">
        <div className="grid gap-3 md:grid-cols-5">
          <Card className="border-slate-200 bg-white/90">
            <CardContent className="p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Total lines</p>
              <p className="mt-1 text-2xl font-semibold text-slate-900">{stats.total}</p>
            </CardContent>
          </Card>
          <Card className="border-slate-200 bg-white/90">
            <CardContent className="p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Added lines</p>
              <p className="mt-1 text-2xl font-semibold text-emerald-700">{stats.added}</p>
            </CardContent>
          </Card>
          <Card className="border-slate-200 bg-white/90">
            <CardContent className="p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Removed lines</p>
              <p className="mt-1 text-2xl font-semibold text-rose-700">{stats.removed}</p>
            </CardContent>
          </Card>
          <Card className="border-slate-200 bg-white/90">
            <CardContent className="p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Modified lines</p>
              <p className="mt-1 text-2xl font-semibold text-amber-700">{stats.modified}</p>
            </CardContent>
          </Card>
          <Card className="border-slate-200 bg-white/90">
            <CardContent className="p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Unchanged lines</p>
              <p className="mt-1 text-2xl font-semibold text-slate-900">{stats.unchanged}</p>
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex-1">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search old or new text..."
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {filterOptions.map((option) => (
              <Button
                key={option.value}
                type="button"
                variant={filter === option.value ? "default" : "outline"}
                size="sm"
                onClick={() => setFilter(option.value)}
              >
                {option.label}
              </Button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="border-slate-200 bg-white/90">
          <CardHeader className="border-b border-slate-200 bg-slate-50/80 py-4">
            <div className="grid grid-cols-[1fr_auto_1fr] gap-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <div>Old document</div>
              <div>Change</div>
              <div className="text-right">New document</div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="max-h-[72vh] overflow-auto">
              {visibleLines.length === 0 ? (
                <div className="p-6 text-sm text-slate-500">No comparison rows match the current filters.</div>
              ) : (
                <div className="divide-y divide-slate-200">
                  {visibleLines.map((line) => {
                    const isSelected = line.id === selectedLineId;

                    return (
                      <button
                        key={line.id}
                        type="button"
                        onClick={() => setSelectedLineId(line.id)}
                        className={cn(
                          "w-full px-4 py-4 text-left transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-400",
                          changeTypeStyles[line.change_type],
                          isSelected && "ring-2 ring-slate-900 ring-inset",
                        )}
                      >
                        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:items-stretch">
                          <div className="space-y-2 rounded-lg border border-transparent bg-white/70 p-3">
                            <p className="text-xs font-medium text-slate-500">
                              {formatLocation(line.old_page_number, line.old_line_number)}
                            </p>
                            <p className="whitespace-pre-wrap text-sm leading-6 text-slate-800">
                              {line.old_text ?? "Removed"}
                            </p>
                          </div>

                          <div className="flex items-center justify-center md:px-2">
                            <Badge variant={changeTypeVariant(line.change_type)}>
                              {changeTypeLabels[line.change_type]}
                            </Badge>
                          </div>

                          <div className="space-y-2 rounded-lg border border-transparent bg-white/70 p-3 text-right">
                            <p className="text-xs font-medium text-slate-500">
                              {formatLocation(line.new_page_number, line.new_line_number)}
                            </p>
                            <p className="whitespace-pre-wrap text-sm leading-6 text-slate-800">
                              {line.new_text ?? "Added"}
                            </p>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="sticky top-28 h-fit border-slate-200 bg-white/90">
          <CardHeader className="border-b border-slate-200">
            <CardTitle className="text-lg">Details</CardTitle>
            <CardDescription>Selected comparison row and Phase 4 placeholder.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            {selectedLine ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={changeTypeVariant(selectedLine.change_type)}>
                    {changeTypeLabels[selectedLine.change_type]}
                  </Badge>
                  <span className="text-sm text-slate-500">
                    Similarity: {selectedLine.similarity_score?.toFixed(2) ?? "-"}
                  </span>
                </div>

                <div className="space-y-3 text-sm text-slate-700">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-500">Old location</p>
                    <p>{formatLocation(selectedLine.old_page_number, selectedLine.old_line_number)}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-500">New location</p>
                    <p>{formatLocation(selectedLine.new_page_number, selectedLine.new_line_number)}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-500">Old text</p>
                    <p className="whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-3">
                      {selectedLine.old_text ?? "-"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-500">New text</p>
                    <p className="whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-3">
                      {selectedLine.new_text ?? "-"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-500">Section title</p>
                    <p>{selectedLine.section_title ?? "-"}</p>
                  </div>
                </div>

                <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-500">AI explanation</p>
                  <p className="mt-2 text-sm text-slate-600">
                    Placeholder for Phase 4. This panel will later show an AI-generated explanation of
                    the change.
                  </p>
                </div>
              </>
            ) : (
              <p className="text-sm text-slate-500">Select a row to view details.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}