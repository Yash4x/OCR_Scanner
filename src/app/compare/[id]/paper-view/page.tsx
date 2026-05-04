import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ComparisonTabs } from "@/components/comparison-tabs";
import { PaperComparisonView } from "@/components/paper-comparison-view";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { enrichSpanDiagnostic } from "@/lib/span-diagnostics";
import type {
  ChangeSummaryRecord,
  ComparisonLineRecord,
  ComparisonSpanRecord,
  DocumentLineRecord,
  DocumentPageRecord,
  DocumentRecord,
  DocumentWordRecord,
} from "@/lib/types";

type Side = "old" | "new";

async function createSignedImageUrl(supabase: Awaited<ReturnType<typeof createClient>>, path: string | null) {
  if (!path) {
    return null;
  }

  const { data, error } = await supabase.storage.from("extracted-text").createSignedUrl(path, 60 * 30);

  if (error || !data) {
    console.error(`[paper-view] failed signing image ${path}`, error);
    return null;
  }

  return data.signedUrl;
}

export default async function ComparisonPaperViewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: comparison, error: comparisonError } = await supabase
    .from("comparisons")
    .select("id, title, status")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (comparisonError || !comparison) {
    notFound();
  }

  const { data: documents } = await supabase
    .from("documents")
    .select("id, user_id, comparison_id, document_role, file_name, file_type, file_size, storage_path, status, created_at, updated_at")
    .eq("comparison_id", comparison.id)
    .eq("user_id", user.id);

  const documentsByRole = (documents ?? []).reduce<Record<Side, DocumentRecord | null>>(
    (result, document) => {
      const role = document.document_role as Side;
      result[role] = document as DocumentRecord;
      return result;
    },
    { old: null, new: null },
  );

  const documentIds = [documentsByRole.old?.id, documentsByRole.new?.id].filter(
    (documentId): documentId is string => Boolean(documentId),
  );

  const [{ data: documentPages }, { data: documentLines }, { data: comparisonLines }, { data: changeSummaries }, { data: comparisonSpans }, { data: documentWords }] =
    await Promise.all([
      documentIds.length > 0
        ? supabase
            .from("document_pages")
            .select("id, document_id, user_id, page_number, image_storage_path, width, height, status, created_at, updated_at")
            .in("document_id", documentIds)
            .order("page_number", { ascending: true })
        : Promise.resolve({ data: [] as DocumentPageRecord[] }),
      documentIds.length > 0
        ? supabase
            .from("document_lines")
            .select("id, document_id, user_id, page_number, line_number, text, normalized_text, section_title, block_type, bbox_top, bbox_left, bbox_width, bbox_height, confidence, created_at")
            .in("document_id", documentIds)
        : Promise.resolve({ data: [] as DocumentLineRecord[] }),
      supabase
        .from("comparison_lines")
        .select(
          "id, comparison_id, user_id, old_line_id, new_line_id, old_page_number, new_page_number, old_line_number, new_line_number, old_text, new_text, normalized_old_text, normalized_new_text, section_title, change_type, similarity_score, created_at",
        )
        .eq("comparison_id", comparison.id)
        .eq("user_id", user.id),
      supabase
        .from("change_summaries")
        .select(
          "id, comparison_id, comparison_line_id, user_id, section_title, change_type, short_summary, old_meaning, new_meaning, practical_impact, risk_level, confidence, created_at",
        )
        .eq("comparison_id", comparison.id)
        .eq("user_id", user.id),
      supabase
        .from("comparison_spans")
        .select(
          "id, comparison_id, comparison_line_id, user_id, side, page_number, line_id, word_ids, change_type, span_text, bbox_left, bbox_top, bbox_width, bbox_height, source_type, linked_span_group, confidence, created_at",
        )
        .eq("comparison_id", comparison.id)
        .eq("user_id", user.id),
        documentIds.length > 0
          ? supabase
              .from("document_words")
              .select("id, document_id, document_line_id, user_id, page_number, line_number, word_index, text, normalized_text, bbox_top, bbox_left, bbox_width, bbox_height, confidence, created_at")
              .in("document_id", documentIds)
          : Promise.resolve({ data: [] as DocumentWordRecord[] }),
    ]);

  const pageRows = (documentPages ?? []) as DocumentPageRecord[];
  const lineRows = (documentLines ?? []) as DocumentLineRecord[];
  const comparisonLineRows = (comparisonLines ?? []) as ComparisonLineRecord[];
  const summaryRows = (changeSummaries ?? []) as ChangeSummaryRecord[];
  const spanRows = (comparisonSpans ?? []) as ComparisonSpanRecord[];
  const wordRows = (documentWords ?? []) as DocumentWordRecord[];

  // Create span diagnostics map for debug panel
  const linesByIdLookup = Object.fromEntries(lineRows.map((line) => [line.id, line])) as Record<string, DocumentLineRecord>;
  const spanDiagnostics = new Map(
    spanRows.map((span) => {
      const sourceLine = span.line_id ? linesByIdLookup[span.line_id] : null;
      const sourceWords = span.word_ids
        ? span.word_ids.map((wordId) => wordRows.find((w) => w.id === wordId)).filter((w): w is DocumentWordRecord => Boolean(w))
        : null;
      const diagnostic = enrichSpanDiagnostic(span, sourceLine, sourceWords);
      return [span.id, diagnostic];
    }),
  );

  const spanDiagnosticsById = Object.fromEntries(spanDiagnostics) as Record<string, import("@/lib/span-diagnostics").SpanDiagnosticInfo>;

  const pageSignedUrls = await Promise.all(
    pageRows.map(async (page) => ({
      pageId: page.id,
      signedUrl: await createSignedImageUrl(supabase, page.image_storage_path),
    })),
  );

  const signedUrlByPageId = Object.fromEntries(pageSignedUrls.map((item) => [item.pageId, item.signedUrl]));

  const oldPages = pageRows
    .filter((page) => page.document_id === documentsByRole.old?.id)
    .map((page) => ({
      page_number: page.page_number,
      signed_url: signedUrlByPageId[page.id] ?? null,
      width: page.width,
      height: page.height,
    }));

  const newPages = pageRows
    .filter((page) => page.document_id === documentsByRole.new?.id)
    .map((page) => ({
      page_number: page.page_number,
      signed_url: signedUrlByPageId[page.id] ?? null,
      width: page.width,
      height: page.height,
    }));

  const linesById = Object.fromEntries(lineRows.map((line) => [line.id, line])) as Record<string, DocumentLineRecord>;
  const comparisonLineById = Object.fromEntries(comparisonLineRows.map((line) => [line.id, line])) as Record<string, ComparisonLineRecord>;
  const summaryByComparisonLineId = Object.fromEntries(summaryRows.map((summary) => [summary.comparison_line_id, summary])) as Record<
    string,
    ChangeSummaryRecord
  >;
  const highlights = spanRows
    .map((span) => {
      const comparisonLine = span.comparison_line_id ? comparisonLineById[span.comparison_line_id] : null;
      const line = span.line_id ? linesById[span.line_id] : null;
      const summary = span.comparison_line_id ? summaryByComparisonLineId[span.comparison_line_id] : null;

      if (!comparisonLine) {
        return null;
      }

      return {
        id: span.id,
        comparison_span_id: span.id,
        comparison_line_id: comparisonLine.id,
        linked_span_group: span.linked_span_group,
        side: span.side,
        page_number: span.page_number,
        line_id: span.line_id,
        line_number: line?.line_number ?? (span.side === "old" ? comparisonLine.old_line_number : comparisonLine.new_line_number),
        section_title: comparisonLine.section_title ?? summary?.section_title ?? null,
        change_type: comparisonLine.change_type,
        span_text: span.span_text,
        text: span.span_text,
        old_text: comparisonLine.old_text,
        new_text: comparisonLine.new_text,
        source_type: span.source_type,
        bbox: {
          left: span.bbox_left,
          top: span.bbox_top,
          width: span.bbox_width,
          height: span.bbox_height,
        },
        short_summary: summary?.short_summary ?? null,
        old_meaning: summary?.old_meaning ?? null,
        new_meaning: summary?.new_meaning ?? null,
        practical_impact: summary?.practical_impact ?? null,
        risk_level: summary?.risk_level ?? null,
        confidence: span.confidence ?? summary?.confidence ?? null,
        word_ids: span.word_ids,
        is_word_box: span.source_type === "word_diff",
      };
    })
    .filter((value): value is NonNullable<typeof value> => Boolean(value));

  const spanCountsByLineId = spanRows.reduce<Record<string, number>>((counts, span) => {
    if (!span.comparison_line_id) {
      return counts;
    }

    counts[span.comparison_line_id] ||= 0;
    counts[span.comparison_line_id] += 1;
    return counts;
  }, {});

  const missingLocationItems: Array<{
    comparison_line_id: string;
    page_number: number | null;
    line_number: number | null;
    change_type: string;
    reason: string;
  }> = [];

  for (const comparisonLine of comparisonLineRows) {
    if (comparisonLine.change_type === "unchanged") {
      continue;
    }

    if ((spanCountsByLineId[comparisonLine.id] ?? 0) > 0) {
      continue;
    }

    const pageNumber = comparisonLine.old_page_number ?? comparisonLine.new_page_number ?? null;
    const lineNumber = comparisonLine.old_line_number ?? comparisonLine.new_line_number ?? null;
    let reason = "No comparison_spans were generated for this change.";
    if (!comparisonLine.old_line_id && !comparisonLine.new_line_id) {
      reason = "missing_old_line_id|missing_new_line_id";
    } else if (comparisonLine.change_type !== "added" && !comparisonLine.old_line_id) {
      reason = "missing_old_line_id";
    } else if (comparisonLine.change_type !== "removed" && !comparisonLine.new_line_id) {
      reason = "missing_new_line_id";
    } else if (!pageNumber) {
      reason = "missing_page_number";
    }

    missingLocationItems.push({
      comparison_line_id: comparisonLine.id,
      page_number: pageNumber,
      line_number: lineNumber,
      change_type: comparisonLine.change_type,
      reason,
    });
  }

  const spansAttempted = comparisonLineRows.reduce((count, line) => {
    if (line.change_type === "unchanged") return count;
    const includeOld = line.change_type !== "added";
    const includeNew = line.change_type !== "removed";
    return count + (includeOld ? 1 : 0) + (includeNew ? 1 : 0);
  }, 0);

  const skippedReasons = missingLocationItems.reduce<Record<string, number>>((acc, item) => {
    acc[item.reason] ||= 0;
    acc[item.reason] += 1;
    return acc;
  }, {});

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-[1600px] space-y-5">
        <Button asChild variant="ghost" size="sm">
          <Link href="/dashboard">Back to dashboard</Link>
        </Button>

        <div className="space-y-2">
          <h1 className="text-2xl font-semibold text-slate-900">{comparison.title}</h1>
          <p className="text-sm text-slate-600">Scanned Paper Comparison View</p>
        </div>

        <ComparisonTabs comparisonId={comparison.id} activeTab="paper-view" />

        <PaperComparisonView
          comparisonId={comparison.id}
          oldPages={oldPages}
          newPages={newPages}
          highlights={highlights}
          spanDiagnostics={spanDiagnosticsById}
          missingLocationItems={missingLocationItems}
          diagnosticsMeta={{
            spansAttempted,
            spansInserted: highlights.length,
            insertError: null,
            skippedReasons,
          }}
        />
      </div>
    </main>
  );
}
