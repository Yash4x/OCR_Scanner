"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { HighlightOverlay, type PaperHighlight } from "@/components/highlight-overlay";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export interface PaperPageImage {
  page_number: number;
  signed_url: string | null;
  width: number | null;
  height: number | null;
}

function pageAspectRatio(page: PaperPageImage | null) {
  if (!page?.width || !page.height || page.width <= 0 || page.height <= 0) {
    return 1.4;
  }

  return page.height / page.width;
}

function resolvedPageAspectRatio(page: PaperPageImage | null, measuredSize: { width: number; height: number } | null) {
  if (page?.width && page.height && page.width > 0 && page.height > 0) {
    return page.height / page.width;
  }

  if (measuredSize?.width && measuredSize.height && measuredSize.width > 0 && measuredSize.height > 0) {
    return measuredSize.height / measuredSize.width;
  }

  return pageAspectRatio(page);
}

export function DocumentPagePanel({
  title,
  page,
  side,
  highlights,
  zoom,
  fitToWidth,
  selectedHighlightId,
  selectedLinkedSpanGroup,
  pulseHighlightId,
  pulseLinkedSpanGroup,
  onHighlightClick,
}: {
  title: string;
  page: PaperPageImage | null;
  side: "old" | "new";
  highlights: PaperHighlight[];
  zoom: number;
  fitToWidth: boolean;
  selectedHighlightId: string | null;
  selectedLinkedSpanGroup?: string | null;
  pulseHighlightId: string | null;
  pulseLinkedSpanGroup?: string | null;
  debugMode?: boolean;
  onHighlightClick: (highlight: PaperHighlight) => void;
}) {
  const [measuredSize, setMeasuredSize] = useState<{ width: number; height: number } | null>(null);
  const ratio = useMemo(() => resolvedPageAspectRatio(page, measuredSize), [measuredSize, page]);
  const canvasWidthPercent = fitToWidth ? 100 : zoom * 100;
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setMeasuredSize(null);
  }, [page?.signed_url]);

  useEffect(() => {
    if (!selectedHighlightId || !scrollRef.current) {
      return;
    }

    const target = scrollRef.current.querySelector<HTMLButtonElement>(
      `[data-highlight-id="${selectedHighlightId}"]`,
    );

    if (!target) {
      return;
    }

    target.scrollIntoView({
      behavior: "smooth",
      block: "center",
      inline: "center",
    });
  }, [selectedHighlightId, page?.page_number]);

  return (
    <Card className="h-full border-slate-200 bg-white/95">
      <CardHeader className="border-b border-slate-200 py-3">
        <CardTitle className="flex items-center justify-between text-base font-semibold text-slate-900">
          <span>{title}</span>
          <Badge variant="secondary">{side === "old" ? "Left" : "Right"}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="h-[72vh] p-4">
        <div ref={scrollRef} className="h-full overflow-auto rounded-lg border border-slate-200 bg-slate-100/70 p-4">
          <div className="mx-auto" style={{ width: `${canvasWidthPercent}%`, minWidth: fitToWidth ? "100%" : "700px" }}>
            <div className="relative overflow-hidden rounded-md bg-white shadow-md" style={{ aspectRatio: `1 / ${ratio}` }}>
              {page?.signed_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={page.signed_url}
                  alt={`${title} page ${page.page_number}`}
                  className="block h-full w-full object-contain"
                  draggable={false}
                  onLoad={(event) => {
                    const image = event.currentTarget;
                    if (image.naturalWidth > 0 && image.naturalHeight > 0) {
                      setMeasuredSize({ width: image.naturalWidth, height: image.naturalHeight });
                    }
                  }}
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-sm text-slate-500">
                  Page image is not available.
                </div>
              )}
              <HighlightOverlay
                highlights={highlights}
                selectedHighlightId={selectedHighlightId}
                selectedLinkedSpanGroup={selectedLinkedSpanGroup}
                pulseHighlightId={pulseHighlightId}
                pulseLinkedSpanGroup={pulseLinkedSpanGroup}
                onHighlightClick={onHighlightClick}
              />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
