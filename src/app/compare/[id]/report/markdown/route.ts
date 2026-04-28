import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildComparisonReportMarkdown } from "@/lib/comparison-report";
import type { ChangeSummaryRecord, ComparisonLineRecord, ComparisonSummaryRecord } from "@/lib/types";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: comparison } = await supabase
    .from("comparisons")
    .select("id, title, created_at, old_document:old_document_id(file_name), new_document:new_document_id(file_name)")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!comparison) {
    return NextResponse.json({ error: "Comparison not found" }, { status: 404 });
  }

  const [{ data: summary }, { data: lines }, { data: changeSummaries }] = await Promise.all([
    supabase
      .from("comparison_summaries")
      .select("id, comparison_id, user_id, executive_summary, major_changes, risk_level, created_at, updated_at")
      .eq("comparison_id", id)
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("comparison_lines")
      .select(
        "id, comparison_id, user_id, old_line_id, new_line_id, old_page_number, new_page_number, old_line_number, new_line_number, old_text, new_text, normalized_old_text, normalized_new_text, section_title, change_type, similarity_score, created_at",
      )
      .eq("comparison_id", id)
      .eq("user_id", user.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("change_summaries")
      .select(
        "id, comparison_id, comparison_line_id, user_id, section_title, change_type, short_summary, old_meaning, new_meaning, practical_impact, risk_level, confidence, created_at",
      )
      .eq("comparison_id", id)
      .eq("user_id", user.id)
      .order("created_at", { ascending: true }),
  ]);

  const oldFileName =
    comparison.old_document && typeof comparison.old_document === "object" && "file_name" in comparison.old_document
      ? String(comparison.old_document.file_name)
      : "-";
  const newFileName =
    comparison.new_document && typeof comparison.new_document === "object" && "file_name" in comparison.new_document
      ? String(comparison.new_document.file_name)
      : "-";

  const markdown = buildComparisonReportMarkdown({
    title: comparison.title,
    createdAt: comparison.created_at,
    oldFileName,
    newFileName,
    summary: (summary as ComparisonSummaryRecord | null) ?? null,
    lines: (lines as ComparisonLineRecord[] | null) ?? [],
    changeSummaries: (changeSummaries as ChangeSummaryRecord[] | null) ?? [],
  });

  return new NextResponse(markdown, {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="comparison-report-${id}.md"`,
    },
  });
}
