"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { SpanDiagnosticInfo } from "@/lib/span-diagnostics";
import { AlertCircle, CheckCircle2, Info } from "lucide-react";

export function SpanDiagnosticsPanel({ diagnostic }: { diagnostic: SpanDiagnosticInfo | null }) {
  if (!diagnostic) {
    return null;
  }

  const sourceTypeLabel: Record<
    "word_diff" | "line_fallback" | "ai_aligned_span" | "estimated_line_fallback",
    string
  > = {
    word_diff: "Exact Word Match",
    line_fallback: "Exact Line Match",
    ai_aligned_span: "AI Aligned",
    estimated_line_fallback: "Estimated (Guessed)",
  };

  const sourceTypeVariant: Record<
    "word_diff" | "line_fallback" | "ai_aligned_span" | "estimated_line_fallback",
    "success" | "secondary" | "default" | "destructive"
  > = {
    word_diff: "success",
    line_fallback: "secondary",
    ai_aligned_span: "default",
    estimated_line_fallback: "destructive",
  };

  return (
    <Card className="border-slate-200 bg-white/90">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <CardTitle className="text-lg">Highlight Diagnostics</CardTitle>
            <CardDescription>Source OCR data and span positioning</CardDescription>
          </div>
          <Badge variant={sourceTypeVariant[diagnostic.source_type as keyof typeof sourceTypeVariant]}>
            {sourceTypeLabel[diagnostic.source_type as keyof typeof sourceTypeLabel]}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Warnings */}
        {diagnostic.warnings.length > 0 && (
          <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3">
            <div className="flex items-center gap-2 text-sm font-medium text-amber-900">
              <AlertCircle className="h-4 w-4" />
              Issues Detected
            </div>
            <ul className="space-y-1">
              {diagnostic.warnings.map((warning, idx) => (
                <li key={idx} className="text-sm text-amber-800">
                  • {warning}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Basic Info */}
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <span className="font-medium text-slate-700">Side:</span>
            <p className="text-slate-600">{diagnostic.side}</p>
          </div>
          <div>
            <span className="font-medium text-slate-700">Page:</span>
            <p className="text-slate-600">{diagnostic.page_number}</p>
          </div>
          <div>
            <span className="font-medium text-slate-700">Confidence:</span>
            <p className="text-slate-600">{(diagnostic.confidence * 100).toFixed(0)}%</p>
          </div>
          <div>
            <span className="font-medium text-slate-700">Span ID:</span>
            <p className="font-mono text-xs text-slate-500 truncate">{diagnostic.span_id.slice(0, 8)}...</p>
          </div>
        </div>

        {/* Span Text */}
        <div>
          <span className="text-sm font-medium text-slate-700">Span Text:</span>
          <p className="mt-1 rounded-md bg-slate-50 p-2 text-sm text-slate-700">“{diagnostic.span_text}”</p>
        </div>

        {/* Source OCR Line */}
        {diagnostic.source_line_text && (
          <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <span className="text-sm font-medium text-slate-900">Source OCR Line</span>
            </div>
            <div className="ml-6 space-y-1 text-sm">
              <p className="text-slate-700">
                <span className="font-medium">Text:</span> “{diagnostic.source_line_text}”
              </p>
              <p className="text-slate-600">
                <span className="font-medium">Location:</span> Page {diagnostic.source_line_page_number}, Line{" "}
                {diagnostic.source_line_number}
              </p>
              {diagnostic.source_line_bbox && (() => {
                const b = diagnostic.source_line_bbox!;
                const fmt = (v: number | null | undefined) => (typeof v === "number" ? `${(v * 100).toFixed(1)}%` : "n/a");
                return (
                  <p className="font-mono text-xs text-slate-500">
                    Bbox: left={fmt(b.left)}, top={fmt(b.top)}, width={fmt(b.width)}, height={fmt(b.height)}
                  </p>
                );
              })()}
            </div>
          </div>
        )}

        {/* Source OCR Words */}
        {diagnostic.source_words && diagnostic.word_count > 0 && (
          <div className="space-y-2 rounded-md border border-blue-200 bg-blue-50 p-3">
            <div className="flex items-center gap-2">
              <Info className="h-4 w-4 text-blue-600" />
              <span className="text-sm font-medium text-slate-900">
                Source Words ({diagnostic.word_count})
              </span>
            </div>
            <div className="ml-6 flex flex-wrap gap-1">
              {diagnostic.source_words.slice(0, 10).map((word) => (
                <span key={word.id} className="inline-flex items-center rounded-full bg-blue-100 px-2 py-1 text-xs font-medium text-blue-900">
                  {word.text}
                </span>
              ))}
              {diagnostic.source_words.length > 10 && (
                <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-1 text-xs font-medium text-blue-900">
                  +{diagnostic.source_words.length - 10} more
                </span>
              )}
            </div>
          </div>
        )}

        {/* Span Bbox */}
        <div className="space-y-1 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
          <span className="font-medium text-slate-700">Rendered Highlight Position:</span>
          <p className="font-mono text-xs text-slate-500 mt-2">
            left={(diagnostic.span_bbox.left * 100).toFixed(1)}%, top={(diagnostic.span_bbox.top * 100).toFixed(1)}%
            <br />
            width={(diagnostic.span_bbox.width * 100).toFixed(1)}%, height={(diagnostic.span_bbox.height * 100).toFixed(1)}%
          </p>
        </div>

        {/* Match Quality Indicator */}
        <div className="rounded-md border-l-4 border-slate-300 bg-slate-50 p-3 text-sm">
          {diagnostic.text_matched ? (
            <div className="flex items-center gap-2 text-green-700">
              <CheckCircle2 className="h-4 w-4" />
              <span>Source OCR data found and validated</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-amber-700">
              <AlertCircle className="h-4 w-4" />
              <span>No source OCR data - using fallback position</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
