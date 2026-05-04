import { OpenAI } from "openai";
import { createClient } from "@/lib/supabase/server";
import type { ComparisonLineRecord, DocumentLineRecord, DocumentWordRecord } from "@/lib/types";

export type ComparisonSpanSourceType = "word_diff" | "line_fallback" | "ai_aligned_span" | "estimated_line_fallback";

export interface ComparisonSpanRecord {
  id: string;
  comparison_id: string;
  comparison_line_id: string | null;
  user_id: string;
  side: "old" | "new";
  page_number: number;
  line_id: string | null;
  word_ids: string[] | null;
  change_type: string;
  span_text: string;
  bbox_left: number;
  bbox_top: number;
  bbox_width: number;
  bbox_height: number;
  source_type: ComparisonSpanSourceType;
  linked_span_group: string | null;
  confidence: number;
  created_at: string;
}

export interface ComparisonSpanDiagnostic {
  comparison_line_id: string;
  side: "old" | "new" | "both";
  change_type: string;
  page_number: number | null;
  reason_code:
    | "missing_old_line_id"
    | "missing_new_line_id"
    | "missing_document_line"
    | "missing_page_number"
    | "invalid_bbox"
    | "database_insert_failed"
    | "source_type_constraint_failed"
    | "line_fallback_failed"
    | "estimated_fallback_failed"
    | "no_span_generated";
  reason: string;
}

interface NormalizedToken {
  raw: string;
  normalized: string;
}

interface SpanCandidate {
  wordIds: string[];
  spanText: string;
  bbox_left: number;
  bbox_top: number;
  bbox_width: number;
  bbox_height: number;
  confidence: number;
}

const SPAN_PROMPT = `You are helping identify precise changed phrases between two OCR-extracted versions of the same document.
Return only the shortest changed phrase or phrases from each side.
Do not summarize.
Do not explain.
Do not include unchanged surrounding words.
Do not invent text.
Use only text from the provided old and new versions.
Return JSON only:
{
"old_changed_spans": ["..."],
"new_changed_spans": ["..."],
"confidence": 0.0
}
Rules:
If text was added, old_changed_spans can be empty.
If text was removed, new_changed_spans can be empty.
If only a number changed, return only the number.
If only a date day changed, return only the changed day number.
If wording changed, return the shortest phrase that captures the changed wording.
If the entire line changed, return the full line.`;

function createOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY environment variable.");
  }

  return new OpenAI({ apiKey });
}

function getModelName() {
  return process.env.SUMMARY_MODEL ?? process.env.OCR_MODEL ?? "gpt-4o-mini";
}

function parseJsonObject(content: string) {
  const trimmed = content.trim();

  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");

    if (start === -1 || end === -1 || end <= start) {
      throw new Error("AI response was not valid JSON.");
    }

    return JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
  }
}

function safeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function clampConfidence(value: unknown) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0.75;
  }

  if (value < 0) {
    return 0;
  }

  if (value > 1) {
    return 1;
  }

  return Number(value.toFixed(3));
}

function normalizeToken(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/^[^a-z0-9$]+|[^a-z0-9%]+$/g, "")
    .replace(/\s+/g, " ");
}

function tokenizeForDiff(text: string): NormalizedToken[] {
  const matches = text.match(/\$?\d[\d,]*(?:\.\d+)?%?|[A-Za-z]+(?:'[A-Za-z]+)?(?:-[A-Za-z]+)?|[^\sA-Za-z0-9]/g) ?? [];
  return matches.map((raw) => ({ raw, normalized: normalizeToken(raw) }));
}

function isUsefulToken(token: NormalizedToken) {
  return token.normalized.length > 0;
}

function lcsChangedIndices(oldTokens: NormalizedToken[], newTokens: NormalizedToken[]) {
  const oldUseful = oldTokens.map(isUsefulToken);
  const newUseful = newTokens.map(isUsefulToken);
  const oldValues = oldTokens.map((token) => token.normalized);
  const newValues = newTokens.map((token) => token.normalized);

  const dp = Array.from({ length: oldTokens.length + 1 }, () => Array.from({ length: newTokens.length + 1 }, () => 0));

  for (let i = oldTokens.length - 1; i >= 0; i -= 1) {
    for (let j = newTokens.length - 1; j >= 0; j -= 1) {
      if (oldUseful[i] && newUseful[j] && oldValues[i] === newValues[j]) {
        dp[i][j] = 1 + dp[i + 1][j + 1];
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const unchangedOld = new Set<number>();
  const unchangedNew = new Set<number>();
  let i = 0;
  let j = 0;

  while (i < oldTokens.length && j < newTokens.length) {
    if (oldUseful[i] && newUseful[j] && oldValues[i] === newValues[j]) {
      unchangedOld.add(i);
      unchangedNew.add(j);
      i += 1;
      j += 1;
      continue;
    }

    if (dp[i + 1][j] >= dp[i][j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }

  const changedOld = new Set<number>();
  const changedNew = new Set<number>();

  for (let index = 0; index < oldTokens.length; index += 1) {
    if (oldUseful[index] && !unchangedOld.has(index)) {
      changedOld.add(index);
    }
  }

  for (let index = 0; index < newTokens.length; index += 1) {
    if (newUseful[index] && !unchangedNew.has(index)) {
      changedNew.add(index);
    }
  }

  return { old: changedOld, new: changedNew };
}

function normalizeMatchText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9$%]+/g, "");
}

function buildLineKey(pageNumber: number, lineNumber: number) {
  return `${pageNumber}:${lineNumber}`;
}

function normalizeRelativeValue(value: number | null | undefined) {
  if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) {
    return null;
  }

  if (value >= 0 && value <= 1) {
    return Number(value.toFixed(6));
  }

  if (value > 1 && value <= 100) {
    return Number((value / 100).toFixed(6));
  }

  return null;
}

function isValidSpanBox(params: {
  bbox_left: number;
  bbox_top: number;
  bbox_width: number;
  bbox_height: number;
  sourceType: ComparisonSpanSourceType;
}) {
  const { bbox_left, bbox_top, bbox_width, bbox_height, sourceType } = params;

  if (![bbox_left, bbox_top, bbox_width, bbox_height].every((value) => typeof value === "number" && Number.isFinite(value))) {
    return false;
  }

  if (bbox_width <= 0 || bbox_height <= 0) {
    return false;
  }

  if (bbox_left < 0 || bbox_top < 0) {
    return false;
  }

  if (bbox_left > 1 || bbox_top > 1) {
    return false;
  }

  // Basic sanity: must fit within page bounds
  if (bbox_left + bbox_width > 1.0 || bbox_top + bbox_height > 1.0) {
    return false;
  }

  // Very permissive checks for line-level fallbacks and estimated fallbacks
  if (sourceType === "line_fallback" || sourceType === "estimated_line_fallback") {
    if (bbox_width <= 0 || bbox_height <= 0) return false;
    if (bbox_width > 1.0) return false;
    if (bbox_height > 0.2) return false;
    if (bbox_left < 0 || bbox_left > 1) return false;
    if (bbox_top < 0 || bbox_top > 1) return false;
    return true;
  }

  // Word/AI-aligned spans: prefer tighter boxes but relax limits slightly
  if (bbox_width <= 0 || bbox_height <= 0) return false;
  if (bbox_width > 0.95) return false;
  if (bbox_height > 0.08) return false;
  return true;
}

function averageConfidence(words: DocumentWordRecord[]) {
  const values = words.map((word) => word.confidence).filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  if (values.length === 0) {
    return 0.75;
  }

  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3));
}

function mergeWordBoxes(words: DocumentWordRecord[], sourceType: ComparisonSpanSourceType, spanText: string) {
  if (words.length === 0) {
    return null;
  }

  const lefts = words.map((word) => normalizeRelativeValue(word.bbox_left)).filter((value): value is number => value !== null);
  const tops = words.map((word) => normalizeRelativeValue(word.bbox_top)).filter((value): value is number => value !== null);
  const widths = words.map((word) => normalizeRelativeValue(word.bbox_width)).filter((value): value is number => value !== null);
  const heights = words.map((word) => normalizeRelativeValue(word.bbox_height)).filter((value): value is number => value !== null);

  if (lefts.length !== words.length || tops.length !== words.length || widths.length !== words.length || heights.length !== words.length) {
    return null;
  }

  const bboxLeft = Math.min(...lefts);
  const bboxTop = Math.min(...tops);
  const bboxRight = Math.max(...words.map((word, index) => lefts[index] + widths[index]));
  const bboxBottom = Math.max(...words.map((word, index) => tops[index] + heights[index]));
  const bboxWidth = Number((bboxRight - bboxLeft).toFixed(6));
  const bboxHeight = Number((bboxBottom - bboxTop).toFixed(6));

  if (!isValidSpanBox({ bbox_left: bboxLeft, bbox_top: bboxTop, bbox_width: bboxWidth, bbox_height: bboxHeight, sourceType })) {
    return null;
  }

  // Validate that merged word text matches span text
  const mergedText = words.map((word) => word.text).join(" ");
  if (!validateTextMatch(mergedText, spanText)) {
    return null;
  }

  return {
    wordIds: words.map((word) => word.id),
    spanText,
    bbox_left: bboxLeft,
    bbox_top: bboxTop,
    bbox_width: bboxWidth,
    bbox_height: bboxHeight,
    confidence: averageConfidence(words),
  } satisfies SpanCandidate;
}

function findWordsForTokenSequence(tokens: NormalizedToken[], words: DocumentWordRecord[]) {
  const matchedIndices = new Set<number>();
  let wordCursor = 0;

  for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex += 1) {
    const token = tokens[tokenIndex];
    const normalizedToken = normalizeMatchText(token.raw);

    if (!normalizedToken) {
      continue;
    }

    let foundIndex = -1;

    // First, search forward from current cursor (forward search priority)
    for (let index = wordCursor; index < words.length; index += 1) {
      const word = words[index];
      const normalizedWord = normalizeMatchText(word.normalized_text || word.text);

      if (!normalizedWord) {
        continue;
      }

      if (normalizedWord === normalizedToken || normalizedWord.includes(normalizedToken) || normalizedToken.includes(normalizedWord)) {
        foundIndex = index;
        break;
      }
    }

    // If not found forward, search backward only within a narrow window (prevent drift)
    if (foundIndex === -1 && wordCursor > 0) {
      const searchStart = Math.max(0, wordCursor - 3);
      for (let index = searchStart; index < wordCursor; index += 1) {
        const word = words[index];
        const normalizedWord = normalizeMatchText(word.normalized_text || word.text);

        if (normalizedWord === normalizedToken || normalizedWord.includes(normalizedToken) || normalizedToken.includes(normalizedWord)) {
          foundIndex = index;
          break;
        }
      }
    }

    if (foundIndex === -1) {
      return null;
    }

    matchedIndices.add(foundIndex);
    wordCursor = foundIndex + 1;
  }

  return matchedIndices;
}

/**
 * Validate that the merged word text approximately reconstructs the span text.
 * Allow for minor punctuation/whitespace differences.
 */
function validateTextMatch(wordText: string, spanText: string): boolean {
  if (!wordText || !spanText) {
    return false;
  }

  const normalizedWordText = normalizeMatchText(wordText).replace(/\s+/g, "");
  const normalizedSpanText = normalizeMatchText(spanText).replace(/\s+/g, "");

  if (normalizedSpanText.length === 0) {
    return false;
  }

  // Exact match
  if (normalizedWordText === normalizedSpanText) {
    return true;
  }

  // Word text contains span text (allow extra words)
  if (normalizedWordText.includes(normalizedSpanText)) {
    return true;
  }

  // Span text contains word text (allow fewer words)
  if (normalizedSpanText.includes(normalizedWordText)) {
    return true;
  }

  // Allow partial match if >80% of characters match
  const commonLength = Math.min(normalizedWordText.length, normalizedSpanText.length);
  let matches = 0;
  for (let i = 0; i < commonLength; i += 1) {
    if (normalizedWordText[i] === normalizedSpanText[i]) {
      matches += 1;
    }
  }

  const matchRatio = matches / Math.max(normalizedWordText.length, normalizedSpanText.length);
  return matchRatio > 0.8;
}

async function aiAlignChangedPhrases(params: {
  oldText: string;
  newText: string;
  oldContext: string;
  newContext: string;
}) {
  const client = createOpenAIClient();
  const response = await client.chat.completions.create({
    model: getModelName(),
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SPAN_PROMPT },
      {
        role: "user",
        content: JSON.stringify(
          {
            old_text: params.oldText,
            new_text: params.newText,
            old_context: params.oldContext,
            new_context: params.newContext,
          },
          null,
          2,
        ),
      },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("AI alignment model returned no content.");
  }

  const parsed = parseJsonObject(content);
  const oldChangedSpans = Array.isArray(parsed.old_changed_spans) ? parsed.old_changed_spans.map(safeString).filter(Boolean) : [];
  const newChangedSpans = Array.isArray(parsed.new_changed_spans) ? parsed.new_changed_spans.map(safeString).filter(Boolean) : [];

  return {
    oldChangedSpans,
    newChangedSpans,
    confidence: clampConfidence(parsed.confidence),
  };
}

function lineFallbackSpan(params: {
  comparisonId: string;
  comparisonLineId: string;
  userId: string;
  changeType: string;
  side: "old" | "new";
  pageNumber: number;
  lineId: string | null;
  linkedSpanGroup: string;
  spanText: string;
  bbox_left: number | null;
  bbox_top: number | null;
  bbox_width: number | null;
  bbox_height: number | null;
  lineText: string;
}) {
  const bbox_left = normalizeRelativeValue(params.bbox_left);
  const bbox_top = normalizeRelativeValue(params.bbox_top);
  const bbox_width = normalizeRelativeValue(params.bbox_width);
  const bbox_height = normalizeRelativeValue(params.bbox_height);

  if (bbox_left === null || bbox_top === null || bbox_width === null || bbox_height === null) {
    return null;
  }

  if (!isValidSpanBox({ bbox_left, bbox_top, bbox_width, bbox_height, sourceType: "line_fallback" })) {
    return null;
  }

  return {
    comparison_id: params.comparisonId,
    comparison_line_id: params.comparisonLineId,
    user_id: params.userId,
    side: params.side,
    page_number: params.pageNumber,
    line_id: params.lineId,
    word_ids: null,
    change_type: params.changeType,
    span_text: params.spanText,
    bbox_left,
    bbox_top,
    bbox_width,
    bbox_height,
    source_type: "line_fallback" as const,
    linked_span_group: params.linkedSpanGroup,
    confidence: 0.75,
  } satisfies Omit<ComparisonSpanRecord, "id" | "created_at">;
}

function buildMatchedWordSpans(params: {
  comparisonId: string;
  comparisonLineId: string;
  userId: string;
  changeType: string;
  side: "old" | "new";
  pageNumber: number;
  lineId: string | null;
  linkedSpanGroup: string;
  words: DocumentWordRecord[];
}) {
  if (params.words.length === 0) {
    return [] as Omit<ComparisonSpanRecord, "id" | "created_at">[];
  }

  const bbox = mergeWordBoxes(params.words, "word_diff", params.words.map((word) => word.text).join(" "));

  if (!bbox) {
    return [] as Omit<ComparisonSpanRecord, "id" | "created_at">[];
  }

  return [
    {
      comparison_id: params.comparisonId,
      comparison_line_id: params.comparisonLineId,
      user_id: params.userId,
      side: params.side,
      page_number: params.pageNumber,
      line_id: params.lineId,
      word_ids: bbox.wordIds,
      change_type: params.changeType,
      span_text: bbox.spanText,
      bbox_left: bbox.bbox_left,
      bbox_top: bbox.bbox_top,
      bbox_width: bbox.bbox_width,
      bbox_height: bbox.bbox_height,
      source_type: "word_diff" as const,
      linked_span_group: params.linkedSpanGroup,
      confidence: bbox.confidence,
    } satisfies Omit<ComparisonSpanRecord, "id" | "created_at">,
  ];
}

function groupWordsByLine(words: DocumentWordRecord[]) {
  return words.reduce<Record<string, DocumentWordRecord[]>>((result, word) => {
    const key = buildLineKey(word.page_number, word.line_number);
    result[key] ||= [];
    result[key].push(word);
    return result;
  }, {});
}

function groupWordsByDocumentLineId(words: DocumentWordRecord[]) {
  return words.reduce<Record<string, DocumentWordRecord[]>>((result, word) => {
    const key = word.document_line_id;
    if (!key) {
      return result;
    }

    result[key] ||= [];
    result[key].push(word);
    return result;
  }, {});
}

function groupLinesByPage(lines: DocumentLineRecord[]) {
  return lines.reduce<Record<number, DocumentLineRecord[]>>((result, line) => {
    const page = Number(line.page_number ?? 0) || 0;
    result[page] ||= [];
    result[page].push(line);
    return result;
  }, {});
}

function median(values: number[]) {
  if (values.length === 0) {
    return null;
  }

  const sorted = values.slice().sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

function isLineBoxOrderConsistent(params: {
  lineNumber: number;
  top: number;
  known: Array<{ lineNumber: number; top: number }>;
}) {
  const previous = params.known
    .filter((item) => item.lineNumber < params.lineNumber)
    .sort((left, right) => right.lineNumber - left.lineNumber)
    .find((item) => item.top < params.top);
  const next = params.known
    .filter((item) => item.lineNumber > params.lineNumber)
    .sort((left, right) => left.lineNumber - right.lineNumber)
    .find((item) => item.top > params.top);

  const nearestPrevious = params.known
    .filter((item) => item.lineNumber < params.lineNumber)
    .sort((left, right) => right.lineNumber - left.lineNumber)[0] ?? null;
  const nearestNext = params.known
    .filter((item) => item.lineNumber > params.lineNumber)
    .sort((left, right) => left.lineNumber - right.lineNumber)[0] ?? null;

  if (nearestPrevious && params.top < nearestPrevious.top - 0.01) {
    return false;
  }

  if (nearestNext && params.top > nearestNext.top + 0.01) {
    return false;
  }

  return Boolean(previous || next || (!nearestPrevious && !nearestNext));
}

function estimatedLineFallbackSpan(params: {
  comparisonId: string;
  comparisonLineId: string;
  userId: string;
  changeType: string;
  side: "old" | "new";
  pageNumber: number;
  lineId: string | null;
  lineNumber: number | null;
  linkedSpanGroup: string;
  spanText: string;
  bbox_top_override?: number | null;
}) {
  const lineNumber = params.lineNumber ?? 1;
  const bbox_left = 0.08;
  const bbox_width = 0.84;
  const bbox_height = 0.018;
  const rawTop = 0.08 + (Math.max(lineNumber, 1) - 1) * 0.018;
  const computedTop = params.bbox_top_override ?? rawTop;
  const bbox_top = Math.min(Math.max(computedTop, 0.02), 0.95);

  if (!isValidSpanBox({ bbox_left, bbox_top, bbox_width, bbox_height, sourceType: "estimated_line_fallback" })) {
    return null;
  }

  return {
    comparison_id: params.comparisonId,
    comparison_line_id: params.comparisonLineId,
    user_id: params.userId,
    side: params.side,
    page_number: params.pageNumber,
    line_id: params.lineId,
    word_ids: null,
    change_type: params.changeType,
    span_text: params.spanText,
    bbox_left,
    bbox_top,
    bbox_width,
    bbox_height,
    source_type: "estimated_line_fallback" as const,
    linked_span_group: params.linkedSpanGroup,
    confidence: 0.5,
  } satisfies Omit<ComparisonSpanRecord, "id" | "created_at">;
}

export async function generateComparisonSpans(params: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  comparisonId: string;
  userId: string;
}) {
  const { supabase, comparisonId, userId } = params;

  const [{ data: comparison }, { data: documents }, { data: comparisonLines }, { data: documentLines }, { data: documentWords }] = await Promise.all([
    supabase.from("comparisons").select("id, user_id, title, status, old_document_id, new_document_id, created_at, updated_at, completed_at").eq("id", comparisonId).eq("user_id", userId).maybeSingle(),
    supabase
      .from("documents")
      .select("id, user_id, comparison_id, document_role, file_name, file_type, file_size, storage_path, status, created_at, updated_at")
      .eq("comparison_id", comparisonId)
      .eq("user_id", userId),
    supabase
      .from("comparison_lines")
      .select("id, comparison_id, user_id, old_line_id, new_line_id, old_page_number, new_page_number, old_line_number, new_line_number, old_text, new_text, normalized_old_text, normalized_new_text, section_title, change_type, similarity_score, created_at")
      .eq("comparison_id", comparisonId)
      .eq("user_id", userId)
      .order("created_at", { ascending: true }),
    supabase
      .from("document_lines")
      .select("id, document_id, user_id, page_number, line_number, text, normalized_text, section_title, block_type, bbox_top, bbox_left, bbox_width, bbox_height, confidence, created_at")
      .eq("user_id", userId),
    supabase
      .from("document_words")
      .select("id, document_id, document_line_id, user_id, page_number, line_number, word_index, text, normalized_text, bbox_top, bbox_left, bbox_width, bbox_height, confidence, created_at")
      .eq("user_id", userId),
  ]);

  if (!comparison) {
    throw new Error("Comparison not found.");
  }

  const comparisonRows = (comparisonLines ?? []) as ComparisonLineRecord[];
  const docs = documents ?? [];
  const oldDocument = docs.find((document) => document.document_role === "old") ?? null;
  const newDocument = docs.find((document) => document.document_role === "new") ?? null;

  if (!oldDocument || !newDocument) {
    throw new Error("Both documents are required to generate comparison spans.");
  }

  const comparisonDocumentIds = new Set([oldDocument.id, newDocument.id]);
  const lineRows = ((documentLines ?? []) as DocumentLineRecord[]).filter((line) => comparisonDocumentIds.has(line.document_id));
  const wordRows = ((documentWords ?? []) as DocumentWordRecord[]).filter((word) => comparisonDocumentIds.has(word.document_id));
  const linesById = Object.fromEntries(lineRows.map((line) => [line.id, line])) as Record<string, DocumentLineRecord>;
  const wordsByLineKey = groupWordsByLine(wordRows);
  const wordsByDocumentLineId = groupWordsByDocumentLineId(wordRows);

  const changedLines = comparisonRows.filter((line) => line.change_type !== "unchanged");
  const spans: Omit<ComparisonSpanRecord, "id" | "created_at">[] = [];
  const diagnostics: ComparisonSpanDiagnostic[] = [];

  const comparisonLineLookup = new Map(comparisonRows.map((line) => [line.id, line]));

  // group lines by page and detect page-number offset (0-based -> 1-based)
  const linesByPage = groupLinesByPage(lineRows);
  const pageNumbers = Object.keys(linesByPage).map((p) => Number(p)).filter((n) => Number.isFinite(n));
  const minPage = pageNumbers.length > 0 ? Math.min(...pageNumbers) : 1;
  const pageOffset = minPage < 1 ? 1 - minPage : 0;

  // Estimate a reasonable bbox_top for a line on a page using nearby lines with sane bboxes.
  // Vision OCR occasionally returns a valid-looking box for the wrong visual line; line order catches that.
  function estimateTopFor(pageNumber: number, targetLineNumber: number | null) {
    const page = pageNumber;
    const pageLines = (linesByPage[page] ?? linesByPage[page - pageOffset] ?? []) as DocumentLineRecord[];

    if (!pageLines || pageLines.length === 0 || targetLineNumber === null) {
      return null;
    }

    const known = pageLines
      .map((l) => ({ line: l, top: normalizeRelativeValue(l.bbox_top) }))
      .filter((item) => typeof item.top === "number" && item.line.line_number != null)
      .map((item) => ({ lineNumber: item.line.line_number ?? 0, top: item.top as number }))
      .sort((a, b) => a.lineNumber - b.lineNumber);

    if (known.length === 0) {
      return null;
    }

    const exact = known.find((item) => item.lineNumber === targetLineNumber);
    if (exact && isLineBoxOrderConsistent({ lineNumber: targetLineNumber, top: exact.top, known })) {
      return exact.top;
    }

    const saneKnown = known.filter((item) => isLineBoxOrderConsistent({ lineNumber: item.lineNumber, top: item.top, known }));
    const usableKnown = saneKnown.length >= 2 ? saneKnown : known.filter((item) => item.lineNumber !== targetLineNumber);

    const before = usableKnown
      .filter((item) => item.lineNumber < targetLineNumber)
      .sort((left, right) => right.lineNumber - left.lineNumber)[0] ?? null;
    const after = usableKnown
      .filter((item) => item.lineNumber > targetLineNumber)
      .sort((left, right) => left.lineNumber - right.lineNumber)[0] ?? null;

    if (before && after && after.lineNumber !== before.lineNumber) {
      const progress = (targetLineNumber - before.lineNumber) / (after.lineNumber - before.lineNumber);
      const interpolated = before.top + (after.top - before.top) * progress;
      return Math.min(Math.max(interpolated, 0.02), 0.95);
    }

    const steps: number[] = [];
    for (let i = 1; i < usableKnown.length; i += 1) {
      const prev = usableKnown[i - 1];
      const cur = usableKnown[i];
      const lineDelta = cur.lineNumber - prev.lineNumber;
      if (lineDelta <= 0) continue;
      const step = (cur.top - prev.top) / lineDelta;
      if (step > 0 && step < 0.08) {
        steps.push(step);
      }
    }

    const step = median(steps) ?? 0.032;
    const nearestCandidates = usableKnown.length > 0 ? usableKnown : known;
    let nearest = nearestCandidates[0];
    let bestDist = Math.abs(nearest.lineNumber - targetLineNumber);
    for (const k of nearestCandidates) {
      const dist = Math.abs(k.lineNumber - (targetLineNumber ?? 0));
      if (dist < bestDist) {
        bestDist = dist;
        nearest = k;
      }
    }

    const estimated = nearest.top + (targetLineNumber - nearest.lineNumber) * step;
    return Math.min(Math.max(estimated, 0.02), 0.95);
  }

  function isTopConsistentWithLine(pageNumber: number, lineNumber: number | null, bboxTop: number | null | undefined) {
    const normalizedTop = normalizeRelativeValue(bboxTop);
    if (normalizedTop === null || lineNumber === null) {
      return true;
    }

    const estimatedTop = estimateTopFor(pageNumber, lineNumber);
    if (estimatedTop === null) {
      return true;
    }

    return Math.abs(normalizedTop - estimatedTop) <= 0.08;
  }

  function fallbackSpanForLine(params: {
    comparisonId: string;
    comparisonLineId: string;
    userId: string;
    changeType: string;
    side: "old" | "new";
    pageNumber: number;
    normalizedPage: number;
    line: DocumentLineRecord;
    linkedSpanGroup: string;
    spanText: string;
  }) {
    const canTrustLineBox = isTopConsistentWithLine(params.normalizedPage, params.line.line_number ?? null, params.line.bbox_top);

    if (canTrustLineBox) {
      const fallback = lineFallbackSpan({
        comparisonId: params.comparisonId,
        comparisonLineId: params.comparisonLineId,
        userId: params.userId,
        changeType: params.changeType,
        side: params.side,
        pageNumber: params.pageNumber,
        lineId: params.line.id,
        linkedSpanGroup: params.linkedSpanGroup,
        spanText: params.spanText,
        bbox_left: params.line.bbox_left,
        bbox_top: params.line.bbox_top,
        bbox_width: params.line.bbox_width,
        bbox_height: params.line.bbox_height,
        lineText: params.line.text,
      });

      if (fallback) {
        return fallback;
      }
    }

    const estimatedTop = estimateTopFor(params.normalizedPage, params.line.line_number ?? null);
    return estimatedLineFallbackSpan({
      comparisonId: params.comparisonId,
      comparisonLineId: params.comparisonLineId,
      userId: params.userId,
      changeType: params.changeType,
      side: params.side,
      pageNumber: params.normalizedPage,
      lineId: params.line.id,
      lineNumber: params.line.line_number,
      linkedSpanGroup: params.linkedSpanGroup,
      spanText: params.spanText.trim() || "(no text)",
      bbox_top_override: estimatedTop,
    });
  }

  let wordSpansGenerated = 0;
  let lineFallbackSpansGenerated = 0;
  let estimatedFallbackSpansGenerated = 0;

  for (const comparisonLine of changedLines) {
    const linkedSpanGroup = `${comparisonId}:${comparisonLine.id}`;
    const isOldSide = comparisonLine.change_type !== "added";
    const isNewSide = comparisonLine.change_type !== "removed";
    const sideEntries: Array<{ side: "old" | "new"; lineId: string | null; pageNumber: number | null; text: string | null }> = [];

    if (isOldSide) {
      sideEntries.push({ side: "old", lineId: comparisonLine.old_line_id, pageNumber: comparisonLine.old_page_number, text: comparisonLine.old_text });
    }

    if (isNewSide) {
      sideEntries.push({ side: "new", lineId: comparisonLine.new_line_id, pageNumber: comparisonLine.new_page_number, text: comparisonLine.new_text });
    }

    let generatedAnySpan = false;

    for (const entry of sideEntries) {
      if (!entry.lineId) {
        diagnostics.push({
          comparison_line_id: comparisonLine.id,
          side: entry.side,
          change_type: comparisonLine.change_type,
          page_number: entry.pageNumber,
          reason_code: entry.side === "old" ? "missing_old_line_id" : "missing_new_line_id",
          reason: `${entry.side}_line_id is missing`,
        });
        continue;
      }

      const sideLine = linesById[entry.lineId] ?? null;
      if (!sideLine) {
        diagnostics.push({
          comparison_line_id: comparisonLine.id,
          side: entry.side,
          change_type: comparisonLine.change_type,
          page_number: entry.pageNumber,
          reason_code: "missing_document_line",
          reason: `document_lines row not found for ${entry.side}_line_id=${entry.lineId}`,
        });
        continue;
      }

      const pageNumber = entry.pageNumber ?? sideLine.page_number ?? null;
      if (pageNumber === null) {
        diagnostics.push({
          comparison_line_id: comparisonLine.id,
          side: entry.side,
          change_type: comparisonLine.change_type,
          page_number: null,
          reason_code: "missing_page_number",
          reason: `page_number missing for ${entry.side} side`,
        });
        continue;
      }

      const normalizedPage = pageNumber + pageOffset;
      const words = wordsByDocumentLineId[entry.lineId] ?? wordsByLineKey[buildLineKey(normalizedPage, sideLine.line_number ?? 0)] ?? [];

      if (comparisonLine.change_type === "added" || comparisonLine.change_type === "removed") {
        const wordSpans = buildMatchedWordSpans({
          comparisonId,
          comparisonLineId: comparisonLine.id,
          userId,
          changeType: comparisonLine.change_type,
          side: entry.side,
          pageNumber,
          lineId: entry.lineId,
          linkedSpanGroup,
          words,
        });

        if (wordSpans.length > 0) {
          spans.push(...wordSpans);
          wordSpansGenerated += wordSpans.length;
          generatedAnySpan = true;
          continue;
        }

        const fallback = fallbackSpanForLine({
          comparisonId,
          comparisonLineId: comparisonLine.id,
          userId,
          changeType: comparisonLine.change_type,
          side: entry.side,
          pageNumber,
          normalizedPage,
          line: sideLine,
          linkedSpanGroup,
          spanText: sideLine.text,
        });

        if (fallback) {
          spans.push(fallback);
          if (fallback.source_type === "line_fallback") {
            lineFallbackSpansGenerated += 1;
          } else {
            estimatedFallbackSpansGenerated += 1;
          }
          generatedAnySpan = true;
          continue;
        }


        const estimatedTop = estimateTopFor(normalizedPage, sideLine.line_number ?? null);
        const estimated = estimatedLineFallbackSpan({
          comparisonId,
          comparisonLineId: comparisonLine.id,
          userId,
          changeType: comparisonLine.change_type,
          side: entry.side,
          pageNumber: normalizedPage,
          lineId: entry.lineId,
          lineNumber: sideLine.line_number,
          linkedSpanGroup,
          spanText: (entry.text ?? sideLine.text ?? "").trim() || "(no text)",
          bbox_top_override: estimatedTop,
        });

        if (estimated) {
          spans.push(estimated);
          estimatedFallbackSpansGenerated += 1;
          generatedAnySpan = true;
          continue;
        }

        diagnostics.push({
          comparison_line_id: comparisonLine.id,
          side: entry.side,
          change_type: comparisonLine.change_type,
          page_number: pageNumber,
          reason_code: "estimated_fallback_failed",
          reason: "Word match, line fallback, and estimated fallback all failed",
        });
        continue;
      }

      if (comparisonLine.change_type === "modified" || comparisonLine.change_type === "moved" || comparisonLine.change_type === "formatting_only") {
        const otherText = entry.side === "old" ? comparisonLine.new_text ?? "" : comparisonLine.old_text ?? "";
        const currentText = entry.text ?? "";
        const currentTokens = tokenizeForDiff(currentText);
        const otherTokens = tokenizeForDiff(otherText);
        const changedIndices = lcsChangedIndices(entry.side === "old" ? currentTokens : otherTokens, entry.side === "old" ? otherTokens : currentTokens);
        const tokenIndices = entry.side === "old" ? changedIndices.old : changedIndices.new;
        const tokenList = entry.side === "old" ? currentTokens : otherTokens;

        const matchedWordIndices = findWordsForTokenSequence(
          tokenList.filter((_, index) => tokenIndices.has(index)),
          words,
        );

        if (matchedWordIndices && matchedWordIndices.size > 0) {
          const matchedWords = [...matchedWordIndices].sort((left, right) => left - right).map((index) => words[index]).filter(Boolean);
          const bbox = mergeWordBoxes(matchedWords, "word_diff", matchedWords.map((word) => word.text).join(" "));

          if (bbox && isTopConsistentWithLine(normalizedPage, sideLine.line_number ?? null, bbox.bbox_top)) {
            spans.push({
              comparison_id: comparisonId,
              comparison_line_id: comparisonLine.id,
              user_id: userId,
              side: entry.side,
              page_number: pageNumber,
              line_id: entry.lineId,
              word_ids: bbox.wordIds,
              change_type: comparisonLine.change_type,
              span_text: bbox.spanText,
              bbox_left: bbox.bbox_left,
              bbox_top: bbox.bbox_top,
              bbox_width: bbox.bbox_width,
              bbox_height: bbox.bbox_height,
              source_type: "word_diff",
              linked_span_group: linkedSpanGroup,
              confidence: bbox.confidence,
            });
            generatedAnySpan = true;
            wordSpansGenerated += 1;
            continue;
          }
        }
      }

      if (comparisonLine.change_type === "moved" || comparisonLine.change_type === "formatting_only") {
        const fallback = fallbackSpanForLine({
          comparisonId,
          comparisonLineId: comparisonLine.id,
          userId,
          changeType: comparisonLine.change_type,
          side: entry.side,
          pageNumber,
          normalizedPage,
          line: sideLine,
          linkedSpanGroup,
          spanText: sideLine.text,
        });

        if (fallback) {
          spans.push(fallback);
          if (fallback.source_type === "line_fallback") {
            lineFallbackSpansGenerated += 1;
          } else {
            estimatedFallbackSpansGenerated += 1;
          }
          generatedAnySpan = true;
          continue;
        }
      }

      if (comparisonLine.change_type === "modified" && currentTextLooksUseful(entry.text ?? "")) {
        const aiResult = await aiAlignChangedPhrases({
          oldText: comparisonLine.old_text ?? "",
          newText: comparisonLine.new_text ?? "",
          oldContext: buildAiContext(comparisonLineLookup, comparisonLine, "old"),
          newContext: buildAiContext(comparisonLineLookup, comparisonLine, "new"),
        });

        const phraseList = entry.side === "old" ? aiResult.oldChangedSpans : aiResult.newChangedSpans;
        const matchedWords = findWordsForPhrases(phraseList, words);

        if (matchedWords.length > 0) {
          const bbox = mergeWordBoxes(matchedWords, "ai_aligned_span", matchedWords.map((word) => word.text).join(" "));

          if (bbox && isTopConsistentWithLine(normalizedPage, sideLine.line_number ?? null, bbox.bbox_top)) {
            spans.push({
              comparison_id: comparisonId,
              comparison_line_id: comparisonLine.id,
              user_id: userId,
              side: entry.side,
              page_number: pageNumber,
              line_id: entry.lineId,
              word_ids: bbox.wordIds,
              change_type: comparisonLine.change_type,
              span_text: bbox.spanText,
              bbox_left: bbox.bbox_left,
              bbox_top: bbox.bbox_top,
              bbox_width: bbox.bbox_width,
              bbox_height: bbox.bbox_height,
              source_type: "ai_aligned_span",
              linked_span_group: linkedSpanGroup,
              confidence: aiResult.confidence,
            });
            generatedAnySpan = true;
            wordSpansGenerated += 1;
            continue;
          }
        }
      }

      // required fallback chain: line fallback, then estimated fallback
      const fallback = fallbackSpanForLine({
        comparisonId,
        comparisonLineId: comparisonLine.id,
        userId,
        changeType: comparisonLine.change_type,
        side: entry.side,
        pageNumber,
        normalizedPage,
        line: sideLine,
        linkedSpanGroup,
        spanText: sideLine.text,
      });

      if (fallback) {
        spans.push(fallback);
        if (fallback.source_type === "line_fallback") {
          lineFallbackSpansGenerated += 1;
        } else {
          estimatedFallbackSpansGenerated += 1;
        }
        generatedAnySpan = true;
      } else {
        const estimatedTop = estimateTopFor(normalizedPage, sideLine.line_number ?? null);
        const estimated = estimatedLineFallbackSpan({
          comparisonId,
          comparisonLineId: comparisonLine.id,
          userId,
          changeType: comparisonLine.change_type,
          side: entry.side,
          pageNumber: normalizedPage,
          lineId: entry.lineId,
          lineNumber: sideLine.line_number,
          linkedSpanGroup,
          spanText: (entry.text ?? sideLine.text ?? "").trim() || "(no text)",
          bbox_top_override: estimatedTop,
        });

        if (estimated) {
          spans.push(estimated);
          estimatedFallbackSpansGenerated += 1;
          generatedAnySpan = true;
          continue;
        }

        diagnostics.push({
          comparison_line_id: comparisonLine.id,
          side: entry.side,
          change_type: comparisonLine.change_type,
          page_number: pageNumber,
          reason_code: "line_fallback_failed",
          reason: `Line fallback and estimated fallback failed for ${entry.side} side.`,
        });
      }
    }

    if (!generatedAnySpan) {
      const contextLines = [] as string[];
      try {
        const before = comparisonRows
          .filter((l) => (l.old_page_number ?? l.new_page_number) === (comparisonLine.old_page_number ?? comparisonLine.new_page_number))
          .slice(0, 5)
          .map((l) => `${l.id}:${l.change_type}:${(l.old_line_number ?? l.new_line_number) ?? "?"}`);
        contextLines.push(...before);
      } catch {
        // ignore
      }

      diagnostics.push({
        comparison_line_id: comparisonLine.id,
        side: "both",
        change_type: comparisonLine.change_type,
        page_number: comparisonLine.old_page_number ?? comparisonLine.new_page_number ?? null,
        reason_code: "no_span_generated",
        reason: `No comparison spans were generated for this change after all fallbacks. contextLines=${contextLines.join("|")}`,
      });
      // emit a console trace to aid debugging when running the pipeline
      try {
        // Keep output concise but include ids and change_type
        // eslint-disable-next-line no-console
        console.warn(`[comparison:${comparisonId}] no spans for line ${comparisonLine.id} change_type=${comparisonLine.change_type} old_line_id=${comparisonLine.old_line_id} new_line_id=${comparisonLine.new_line_id} old_page=${comparisonLine.old_page_number} new_page=${comparisonLine.new_page_number}`);
      } catch {
        // ignore logging errors
      }
    }
  }

  const spansAttempted = changedLines.reduce((count, line) => {
    const includeOld = line.change_type !== "added";
    const includeNew = line.change_type !== "removed";
    return count + (includeOld ? 1 : 0) + (includeNew ? 1 : 0);
  }, 0);

  const skippedReasons = diagnostics.reduce<Record<string, number>>((acc, item) => {
    acc[item.reason_code] ||= 0;
    acc[item.reason_code] += 1;
    return acc;
  }, {});

  const stats = {
    changedLinesFound: changedLines.length,
    spansAttempted,
    spansGenerated: spans.length,
    wordSpansGenerated,
    lineFallbackSpansGenerated,
    estimatedFallbackSpansGenerated,
    skippedCount: diagnostics.length,
    skippedReasons,
    skippedDetails: diagnostics.slice(0, 10),
  };

  return {
    comparison,
    spans,
    diagnostics,
    changedLineCount: changedLines.length,
    stats,
  } as const;
}

function buildAiContext(comparisonLines: Map<string, ComparisonLineRecord>, target: ComparisonLineRecord, side: "old" | "new") {
  const lines = [...comparisonLines.values()].filter((line) => {
    const page = side === "old" ? line.old_page_number : line.new_page_number;
    const targetPage = side === "old" ? target.old_page_number : target.new_page_number;
    const pageMatch = page === targetPage;
    return pageMatch;
  });

  const index = lines.findIndex((line) => line.id === target.id);
  const nearby = lines.slice(Math.max(0, index - 2), Math.min(lines.length, index + 3));
  return nearby
    .map((line) => (side === "old" ? line.old_text : line.new_text))
    .filter((text): text is string => typeof text === "string" && text.trim().length > 0)
    .join("\n")
    .slice(0, 3500);
}

function currentTextLooksUseful(text: string) {
  return text.trim().length > 0;
}

function findWordsForPhrases(phrases: string[], words: DocumentWordRecord[]) {
  if (phrases.length === 0 || words.length === 0) {
    return [] as DocumentWordRecord[];
  }

  const normalizedWords = words.map((word) => ({ word, normalized: normalizeMatchText(word.normalized_text || word.text) }));
  const matched = new Set<number>();

  for (const phrase of phrases) {
    const tokens = tokenizeForDiff(phrase).map((token) => normalizeMatchText(token.raw)).filter(Boolean);
    if (tokens.length === 0) {
      continue;
    }

    for (let start = 0; start < normalizedWords.length; start += 1) {
      let matchedCount = 0;
      let wordIndex = start;

      while (matchedCount < tokens.length && wordIndex < normalizedWords.length) {
        if (normalizedWords[wordIndex].normalized === tokens[matchedCount] || normalizedWords[wordIndex].normalized.includes(tokens[matchedCount])) {
          matchedCount += 1;
          wordIndex += 1;
          continue;
        }

        break;
      }

      if (matchedCount === tokens.length) {
        for (let index = start; index < wordIndex; index += 1) {
          matched.add(index);
        }
        break;
      }
    }
  }

  return [...matched].sort((left, right) => left - right).map((index) => words[index]);
}

// Estimated fallback was removed - we now prioritize real OCR data only
// No more guessed positions when words/lines aren't found

export async function getComparisonPipelineHealth(params: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  comparisonId: string;
  userId: string;
}) {
  const { supabase, comparisonId, userId } = params;

  const [{ data: comparison }, { data: documents }, { data: comparisonLines }, { data: documentLines }, { data: documentWords }, { data: spans }] = await Promise.all([
    supabase.from("comparisons").select("id, old_document_id, new_document_id").eq("id", comparisonId).eq("user_id", userId).maybeSingle(),
    supabase.from("documents").select("id, document_role").eq("comparison_id", comparisonId).eq("user_id", userId),
    supabase.from("comparison_lines").select("id, old_line_id, new_line_id, change_type").eq("comparison_id", comparisonId).eq("user_id", userId),
    supabase.from("document_lines").select("id, document_id, page_number, line_number, bbox_left, bbox_top, bbox_width, bbox_height").eq("user_id", userId),
    supabase.from("document_words").select("id, document_id, page_number, line_number").eq("user_id", userId),
    supabase.from("comparison_spans").select("id, comparison_id").eq("comparison_id", comparisonId).eq("user_id", userId),
  ]);

  if (!comparison) {
    throw new Error("Comparison not found.");
  }

  const docs = documents ?? [];
  const oldDoc = docs.find((d) => d.document_role === "old") ?? null;
  const newDoc = docs.find((d) => d.document_role === "new") ?? null;

  const oldLines = (documentLines ?? []).filter((l) => l.document_id === oldDoc?.id);
  const newLines = (documentLines ?? []).filter((l) => l.document_id === newDoc?.id);
  const oldWords = (documentWords ?? []).filter((w) => w.document_id === oldDoc?.id);
  const newWords = (documentWords ?? []).filter((w) => w.document_id === newDoc?.id);

  const comparisonLinesCount = (comparisonLines ?? []).length;
  const changedComparisonLinesCount = (comparisonLines ?? []).filter((l) => l.change_type !== "unchanged").length;
  const comparisonSpansCount = (spans ?? []).length;

  const lineIds = new Set((documentLines ?? []).map((l) => l.id));
  const missingOldLineIds = (comparisonLines ?? []).map((l) => l.old_line_id).filter(Boolean).filter((id) => !lineIds.has(id)) as string[];
  const missingNewLineIds = (comparisonLines ?? []).map((l) => l.new_line_id).filter(Boolean).filter((id) => !lineIds.has(id)) as string[];

  const wordsByLine = new Set((documentWords ?? []).map((w) => `${w.page_number}:${w.line_number}`));
  const linesWithoutWords = (documentLines ?? []).filter((l) => !wordsByLine.has(`${l.page_number}:${l.line_number}`)).map((l) => l.id ?? "");

  const linesWithoutBboxes = (documentLines ?? []).filter((l) => typeof l.bbox_left !== "number" || typeof l.bbox_top !== "number" || typeof l.bbox_width !== "number" || typeof l.bbox_height !== "number").map((l) => l.id ?? "");

  return {
    oldDocumentId: oldDoc?.id ?? null,
    newDocumentId: newDoc?.id ?? null,
    oldPagesCount: oldLines.length > 0 ? Math.max(...oldLines.map((l) => Number(l.page_number ?? 0))) : 0,
    newPagesCount: newLines.length > 0 ? Math.max(...newLines.map((l) => Number(l.page_number ?? 0))) : 0,
    oldLinesCount: oldLines.length,
    newLinesCount: newLines.length,
    oldWordsCount: oldWords.length,
    newWordsCount: newWords.length,
    comparisonLinesCount,
    changedComparisonLinesCount,
    comparisonSpansCount,
    missingOldLineIds,
    missingNewLineIds,
    linesWithoutWords,
    linesWithoutBboxes,
    skippedReasons: [],
  };
}
