import type { ChangeSummaryRecord, ComparisonLineRecord, ComparisonSummaryRecord } from "@/lib/types";

function safe(value: string | null | undefined) {
  return (value ?? "").replace(/\|/g, "\\|").trim();
}

function stringifyMajorChanges(summary: ComparisonSummaryRecord | null) {
  if (!summary || !Array.isArray(summary.major_changes) || summary.major_changes.length === 0) {
    return "No major changes were identified.";
  }

  return summary.major_changes
    .map((change, index) => {
      return [
        `${index + 1}. **${change.section_title || "Unknown section"}** (${change.risk_level})`,
        `   - What changed: ${change.what_changed || "-"}`,
        `   - Meaning now: ${change.meaning_now || "-"}`,
        `   - Practical impact: ${change.practical_impact || "-"}`,
      ].join("\n");
    })
    .join("\n");
}

export function buildComparisonReportMarkdown(params: {
  title: string;
  createdAt: string;
  oldFileName: string;
  newFileName: string;
  summary: ComparisonSummaryRecord | null;
  lines: ComparisonLineRecord[];
  changeSummaries: ChangeSummaryRecord[];
}) {
  const changedLines = params.lines.filter((line) => line.change_type !== "unchanged");
  const explanationByLineId = Object.fromEntries(params.changeSummaries.map((row) => [row.comparison_line_id, row]));

  const changedLinesTableHeader = [
    "| Section | Type | Old | New | Risk | AI Summary |",
    "|---|---|---|---|---|---|",
  ].join("\n");

  const changedLinesTableRows = changedLines
    .map((line) => {
      const explanation = explanationByLineId[line.id];
      return [
        "|",
        safe(line.section_title) || "-",
        "|",
        safe(line.change_type),
        "|",
        safe(line.old_text) || "-",
        "|",
        safe(line.new_text) || "-",
        "|",
        explanation?.risk_level ?? "-",
        "|",
        safe(explanation?.short_summary) || "-",
        "|",
      ].join(" ");
    })
    .join("\n");

  const explanationSection = params.changeSummaries.length
    ? params.changeSummaries
        .map((item, index) => {
          return [
            `### Change ${index + 1}`,
            `- Section: ${item.section_title ?? "-"}`,
            `- Change type: ${item.change_type}`,
            `- Risk: ${item.risk_level}`,
            `- Confidence: ${typeof item.confidence === "number" ? item.confidence.toFixed(2) : "-"}`,
            `- Summary: ${item.short_summary}`,
            `- Old meaning: ${item.old_meaning ?? "-"}`,
            `- New meaning: ${item.new_meaning ?? "-"}`,
            `- Practical impact: ${item.practical_impact ?? "-"}`,
          ].join("\n");
        })
        .join("\n\n")
    : "No AI explanations available.";

  return [
    `# ${params.title}`,
    "",
    `Date created: ${new Date(params.createdAt).toLocaleString()}`,
    `Old document: ${params.oldFileName}`,
    `New document: ${params.newFileName}`,
    "",
    "## Executive summary",
    "",
    params.summary?.executive_summary ?? "No executive summary generated yet.",
    "",
    "## Overall risk level",
    "",
    params.summary?.risk_level ?? "unknown",
    "",
    "## Major changes",
    "",
    stringifyMajorChanges(params.summary),
    "",
    "## Full changed-lines table",
    "",
    changedLinesTableHeader,
    changedLinesTableRows || "| - | - | - | - | - | - |",
    "",
    "## AI explanations",
    "",
    explanationSection,
    "",
    "## Disclaimer",
    "",
    "This summary is informational only and is not legal, financial, or professional advice.",
  ].join("\n");
}
