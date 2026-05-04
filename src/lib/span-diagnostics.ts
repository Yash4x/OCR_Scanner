import type { ComparisonSpanRecord, DocumentLineRecord, DocumentWordRecord } from "@/lib/types";

/**
 * Enriched span diagnostic information including source OCR data
 */
export interface SpanDiagnosticInfo {
  span_id: string;
  comparison_line_id: string;
  side: "old" | "new";
  page_number: number;
  source_type: string;
  span_text: string;
  confidence: number;
  
  // Source OCR line info
  line_id: string | null;
  source_line_text: string | null;
  source_line_number: number | null;
  source_line_page_number: number | null;
  source_line_bbox: {
    left: number | null;
    top: number | null;
    width: number | null;
    height: number | null;
  } | null;
  
  // Source OCR words info
  word_ids: string[] | null;
  word_count: number;
  source_words: Array<{
    id: string;
    text: string;
    word_index: number;
    bbox: { left: number; top: number; width: number; height: number };
  }> | null;
  
  // Span rendering info
  span_bbox: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
  
  // Quality indicators
  text_matched: boolean;
  is_estimated: boolean;
  warnings: string[];
}

/**
 * Enriches a comparison span with source OCR data
 */
export function enrichSpanDiagnostic(
  span: ComparisonSpanRecord,
  sourceLine: DocumentLineRecord | null,
  sourceWords: DocumentWordRecord[] | null,
): SpanDiagnosticInfo {
  const warnings: string[] = [];
  
  if (span.source_type === "estimated_line_fallback") {
    warnings.push("Using estimated position - may be inaccurate");
  }
  
  if (span.source_type === "line_fallback" && !sourceLine?.bbox_left) {
    warnings.push("Line has missing bbox data");
  }
  
  if (span.source_type === "word_diff" && (!sourceWords || sourceWords.length === 0)) {
    warnings.push("Word list is empty despite word_diff source type");
  }
  
  if (!sourceLine) {
    warnings.push("Source OCR line not found");
  }

  return {
    span_id: span.id,
    comparison_line_id: span.comparison_line_id ?? "",
    side: span.side,
    page_number: span.page_number,
    source_type: span.source_type,
    span_text: span.span_text,
    confidence: span.confidence ?? 0,
    
    line_id: span.line_id,
    source_line_text: sourceLine?.text ?? null,
    source_line_number: sourceLine?.line_number ?? null,
    source_line_page_number: sourceLine?.page_number ?? null,
    source_line_bbox: sourceLine ? {
      left: sourceLine.bbox_left ?? null,
      top: sourceLine.bbox_top ?? null,
      width: sourceLine.bbox_width ?? null,
      height: sourceLine.bbox_height ?? null,
    } : null,
    
    word_ids: span.word_ids,
    word_count: sourceWords?.length ?? 0,
    source_words: sourceWords?.map((word) => ({
      id: word.id,
      text: word.text,
      word_index: word.word_index ?? 0,
      bbox: {
        left: word.bbox_left ?? 0,
        top: word.bbox_top ?? 0,
        width: word.bbox_width ?? 0,
        height: word.bbox_height ?? 0,
      },
    })) ?? null,
    
    span_bbox: {
      left: span.bbox_left,
      top: span.bbox_top,
      width: span.bbox_width,
      height: span.bbox_height,
    },
    
    text_matched: !!sourceLine,
    is_estimated: span.source_type === "estimated_line_fallback",
    warnings,
  };
}

/**
 * Create a human-readable diagnostic report for a span
 */
export function createSpanDiagnosticReport(diag: SpanDiagnosticInfo): string {
  const lines: string[] = [];
  
  lines.push(`Span ID: ${diag.span_id}`);
  lines.push(`Type: ${diag.source_type}`);
  lines.push(`Side: ${diag.side}`);
  lines.push(`Page: ${diag.page_number}`);
  lines.push(`Confidence: ${(diag.confidence * 100).toFixed(0)}%`);
  lines.push(`Text: "${diag.span_text}"`);
  
  if (diag.source_line_text) {
    lines.push(`\nSource Line:`);
    lines.push(`  Text: "${diag.source_line_text}"`);
    lines.push(`  Page: ${diag.source_line_page_number}, Line: ${diag.source_line_number}`);
    if (diag.source_line_bbox) {
      const fmt = (v: number | null | undefined) => (typeof v === "number" ? `${(v * 100).toFixed(1)}%` : "n/a");
      lines.push(`  Bbox: left=${fmt(diag.source_line_bbox.left)}, top=${fmt(diag.source_line_bbox.top)}, width=${fmt(diag.source_line_bbox.width)}, height=${fmt(diag.source_line_bbox.height)}`);
    }
  }
  
  if (diag.source_words && diag.word_count > 0) {
    lines.push(`\nSource Words: ${diag.word_count}`);
    diag.source_words?.slice(0, 5).forEach((word) => {
      lines.push(`  - "${word.text}" (index ${word.word_index})`);
    });
    if (diag.source_words && diag.source_words.length > 5) {
      lines.push(`  ... and ${diag.source_words.length - 5} more`);
    }
  }
  
  const fmt = (v: number | null | undefined) => (typeof v === "number" ? `${(v * 100).toFixed(1)}%` : "n/a");
  lines.push(`\nSpan Bbox: left=${fmt(diag.span_bbox.left)}, top=${fmt(diag.span_bbox.top)}`);
  lines.push(`           width=${fmt(diag.span_bbox.width)}, height=${fmt(diag.span_bbox.height)}`);
  
  if (diag.warnings.length > 0) {
    lines.push(`\nWarnings:`);
    diag.warnings.forEach((warn) => {
      lines.push(`  ⚠ ${warn}`);
    });
  }
  
  return lines.join("\n");
}
