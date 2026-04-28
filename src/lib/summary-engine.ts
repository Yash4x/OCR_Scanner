import { OpenAI } from "openai";
import type { ChangeSummaryRecord, ComparisonLineRecord, SummaryRiskLevel } from "@/lib/types";

const OVERALL_SUMMARY_PROMPT = `You are an AI document comparison assistant. You are given changed text from an old version and a new version of the same document. Your job is to summarize what changed in plain English.

Do not give legal advice. Do not make claims beyond the text. If something is unclear, say it is unclear.

Focus on:

what changed
where it changed
why it matters
what the new version means compared to the old version
any practical impact
whether the change appears low, medium, or high importance

Return only valid JSON.

JSON format:

{
"executive_summary": "Plain English summary of the main changes.",
"major_changes": [
{
"section_title": "Section name or page area",
"old_text": "Old version text",
"new_text": "New version text",
"what_changed": "What changed",
"meaning_now": "What the new text means now",
"practical_impact": "Practical impact",
"risk_level": "low | medium | high"
}
],
"overall_risk_level": "low | medium | high"
}`;

const LINE_EXPLANATION_PROMPT = `You are an AI document comparison assistant. Explain this specific document change in plain English.

Do not give legal advice. Do not make claims beyond the provided text. If the meaning is uncertain, say that.

Inputs:

Section title
Old text
New text
Surrounding old context
Surrounding new context
Change type

Return only valid JSON.

JSON format:

{
"short_summary": "One sentence explaining what changed.",
"old_meaning": "What the old text meant.",
"new_meaning": "What the new text means now.",
"practical_impact": "Why this change may matter.",
"risk_level": "low | medium | high",
"confidence": 0.0
}`;

const MAX_GROUP_TEXT_LENGTH = 3500;

export interface SummaryGroup {
  id: string;
  sectionTitle: string | null;
  startPage: number | null;
  endPage: number | null;
  lines: ComparisonLineRecord[];
  oldText: string;
  newText: string;
}

export interface OverallSummaryResult {
  executive_summary: string;
  major_changes: Array<{
    section_title: string;
    old_text: string;
    new_text: string;
    what_changed: string;
    meaning_now: string;
    practical_impact: string;
    risk_level: SummaryRiskLevel;
  }>;
  overall_risk_level: SummaryRiskLevel;
}

export interface LineExplanationResult {
  short_summary: string;
  old_meaning: string | null;
  new_meaning: string | null;
  practical_impact: string | null;
  risk_level: SummaryRiskLevel;
  confidence: number | null;
}

function safeText(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function normalizeRiskLevel(value: unknown): SummaryRiskLevel {
  if (typeof value !== "string") {
    return "low";
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "high" || normalized === "medium" || normalized === "low") {
    return normalized;
  }

  return "low";
}

function clampConfidence(value: unknown): number | null {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null;
  }

  if (value < 0) {
    return 0;
  }

  if (value > 1) {
    return 1;
  }

  return Number(value.toFixed(3));
}

function parseJsonObject(content: string) {
  const trimmed = content.trim();

  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");

    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
      throw new Error("AI response was not valid JSON.");
    }

    return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)) as Record<string, unknown>;
  }
}

function dedupeAndJoin(parts: Array<string | null | undefined>, limit = MAX_GROUP_TEXT_LENGTH) {
  const unique = Array.from(new Set(parts.map((part) => (part ?? "").trim()).filter(Boolean)));
  const joined = unique.join("\n");
  return joined.length > limit ? `${joined.slice(0, limit)}...` : joined;
}

function nearby(left: ComparisonLineRecord, right: ComparisonLineRecord) {
  const leftPage = left.new_page_number ?? left.old_page_number ?? 0;
  const rightPage = right.new_page_number ?? right.old_page_number ?? 0;
  const leftLine = left.new_line_number ?? left.old_line_number ?? 0;
  const rightLine = right.new_line_number ?? right.old_line_number ?? 0;

  const pageGap = Math.abs(leftPage - rightPage);
  const lineGap = Math.abs(leftLine - rightLine);
  const sameSection = (left.section_title ?? "").trim().toLowerCase() === (right.section_title ?? "").trim().toLowerCase();

  if (sameSection && pageGap <= 1 && lineGap <= 6) {
    return true;
  }

  return pageGap === 0 && lineGap <= 3;
}

export function groupChangedLines(lines: ComparisonLineRecord[]): SummaryGroup[] {
  const changed = lines
    .filter((line) => line.change_type !== "unchanged")
    .slice()
    .sort((left, right) => {
      const leftPage = left.old_page_number ?? left.new_page_number ?? Number.MAX_SAFE_INTEGER;
      const rightPage = right.old_page_number ?? right.new_page_number ?? Number.MAX_SAFE_INTEGER;

      if (leftPage !== rightPage) {
        return leftPage - rightPage;
      }

      const leftLine = left.old_line_number ?? left.new_line_number ?? Number.MAX_SAFE_INTEGER;
      const rightLine = right.old_line_number ?? right.new_line_number ?? Number.MAX_SAFE_INTEGER;
      return leftLine - rightLine;
    });

  if (changed.length === 0) {
    return [];
  }

  const groups: SummaryGroup[] = [];
  let current: ComparisonLineRecord[] = [changed[0]];

  for (let index = 1; index < changed.length; index += 1) {
    const nextLine = changed[index];
    const previousLine = current[current.length - 1];

    if (nearby(previousLine, nextLine)) {
      current.push(nextLine);
      continue;
    }

    groups.push(makeGroup(current, groups.length));
    current = [nextLine];
  }

  groups.push(makeGroup(current, groups.length));
  return groups;
}

function makeGroup(groupLines: ComparisonLineRecord[], index: number): SummaryGroup {
  const pages = groupLines
    .map((line) => line.new_page_number ?? line.old_page_number)
    .filter((page): page is number => typeof page === "number");

  return {
    id: `group-${index + 1}`,
    sectionTitle: groupLines.find((line) => Boolean(line.section_title))?.section_title ?? null,
    startPage: pages.length > 0 ? Math.min(...pages) : null,
    endPage: pages.length > 0 ? Math.max(...pages) : null,
    lines: groupLines,
    oldText: dedupeAndJoin(groupLines.map((line) => line.old_text)),
    newText: dedupeAndJoin(groupLines.map((line) => line.new_text)),
  };
}

function buildContextWindow(lines: ComparisonLineRecord[], targetIndex: number, size = 2) {
  const start = Math.max(0, targetIndex - size);
  const end = Math.min(lines.length - 1, targetIndex + size);
  const oldContext: string[] = [];
  const newContext: string[] = [];

  for (let index = start; index <= end; index += 1) {
    const line = lines[index];
    if (line.old_text) {
      oldContext.push(line.old_text);
    }
    if (line.new_text) {
      newContext.push(line.new_text);
    }
  }

  return {
    oldContext: oldContext.join("\n").slice(0, MAX_GROUP_TEXT_LENGTH),
    newContext: newContext.join("\n").slice(0, MAX_GROUP_TEXT_LENGTH),
  };
}

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY environment variable.");
  }

  return new OpenAI({ apiKey });
}

function getSummaryModel() {
  return process.env.SUMMARY_MODEL ?? process.env.OCR_MODEL ?? "gpt-4o-mini";
}

export async function generateOverallSummary(groups: SummaryGroup[]): Promise<OverallSummaryResult> {
  const client = getOpenAIClient();
  const model = getSummaryModel();

  const response = await client.chat.completions.create({
    model,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: OVERALL_SUMMARY_PROMPT },
      {
        role: "user",
        content: JSON.stringify(
          {
            grouped_changes: groups.map((group) => ({
              group_id: group.id,
              section_title: group.sectionTitle,
              page_range: [group.startPage, group.endPage],
              old_text: group.oldText,
              new_text: group.newText,
              line_count: group.lines.length,
            })),
          },
          null,
          2,
        ),
      },
    ],
  });

  const content = response.choices[0]?.message?.content;

  if (!content) {
    throw new Error("AI summary model returned no content.");
  }

  const parsed = parseJsonObject(content);
  const majorChangesInput = Array.isArray(parsed.major_changes) ? parsed.major_changes : [];

  const majorChanges = majorChangesInput.map((change) => {
    const typed = typeof change === "object" && change ? (change as Record<string, unknown>) : {};

    return {
      section_title: safeText(typed.section_title, "Unknown section"),
      old_text: safeText(typed.old_text),
      new_text: safeText(typed.new_text),
      what_changed: safeText(typed.what_changed),
      meaning_now: safeText(typed.meaning_now),
      practical_impact: safeText(typed.practical_impact),
      risk_level: normalizeRiskLevel(typed.risk_level),
    };
  });

  return {
    executive_summary: safeText(parsed.executive_summary, "Summary unavailable."),
    major_changes: majorChanges,
    overall_risk_level: normalizeRiskLevel(parsed.overall_risk_level),
  };
}

export async function generateLineExplanation(params: {
  line: ComparisonLineRecord;
  allSortedLines: ComparisonLineRecord[];
}): Promise<LineExplanationResult> {
  const client = getOpenAIClient();
  const model = getSummaryModel();
  const targetIndex = params.allSortedLines.findIndex((line) => line.id === params.line.id);
  const { oldContext, newContext } = buildContextWindow(params.allSortedLines, Math.max(0, targetIndex));

  const response = await client.chat.completions.create({
    model,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: LINE_EXPLANATION_PROMPT },
      {
        role: "user",
        content: JSON.stringify(
          {
            section_title: params.line.section_title,
            change_type: params.line.change_type,
            old_text: params.line.old_text,
            new_text: params.line.new_text,
            surrounding_old_context: oldContext,
            surrounding_new_context: newContext,
          },
          null,
          2,
        ),
      },
    ],
  });

  const content = response.choices[0]?.message?.content;

  if (!content) {
    throw new Error("AI line summary model returned no content.");
  }

  const parsed = parseJsonObject(content);

  return {
    short_summary: safeText(parsed.short_summary, "Change detected."),
    old_meaning: safeText(parsed.old_meaning) || null,
    new_meaning: safeText(parsed.new_meaning) || null,
    practical_impact: safeText(parsed.practical_impact) || null,
    risk_level: normalizeRiskLevel(parsed.risk_level),
    confidence: clampConfidence(parsed.confidence),
  };
}

export function toChangeSummaryRow(params: {
  comparisonId: string;
  userId: string;
  line: ComparisonLineRecord;
  explanation: LineExplanationResult;
}): Omit<ChangeSummaryRecord, "id"> {
  return {
    comparison_id: params.comparisonId,
    comparison_line_id: params.line.id,
    user_id: params.userId,
    section_title: params.line.section_title,
    change_type: params.line.change_type === "unchanged" ? "modified" : params.line.change_type,
    short_summary: params.explanation.short_summary,
    old_meaning: params.explanation.old_meaning,
    new_meaning: params.explanation.new_meaning,
    practical_impact: params.explanation.practical_impact,
    risk_level: params.explanation.risk_level,
    confidence: params.explanation.confidence,
    created_at: new Date().toISOString(),
  };
}
