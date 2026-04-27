import type { ComparisonLineChangeType, ComparisonLineRecord, DocumentLineRecord } from "@/lib/types";

interface PreparedLine {
  line: DocumentLineRecord;
  canonicalText: string;
  strictText: string;
  sectionTitle: string;
}

interface ComparisonRowInput {
  comparisonId: string;
  userId: string;
  oldLine: DocumentLineRecord | null;
  newLine: DocumentLineRecord | null;
  changeType: ComparisonLineChangeType;
  similarityScore: number | null;
}

interface MatchCandidate {
  oldIndex: number;
  newIndex: number;
  score: number;
}

function normalizeComparisonText(text: string) {
  return text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/([([{])\s+/g, "$1")
    .replace(/\s+([)\]}])/g, "$1")
    .replace(/\s*-\s*/g, "-");
}

function normalizeStrictText(text: string) {
  return text.toLowerCase().trim().replace(/\s+/g, " ");
}

function isSimilarSectionTitle(oldTitle: string, newTitle: string) {
  return oldTitle.length > 0 && oldTitle === newTitle;
}

function levenshteinSimilarity(left: string, right: string) {
  if (left === right) {
    return 1;
  }

  const leftLength = left.length;
  const rightLength = right.length;

  if (leftLength === 0 || rightLength === 0) {
    return 0;
  }

  const previousRow = new Array<number>(rightLength + 1);
  const currentRow = new Array<number>(rightLength + 1);

  for (let column = 0; column <= rightLength; column += 1) {
    previousRow[column] = column;
  }

  for (let row = 1; row <= leftLength; row += 1) {
    currentRow[0] = row;

    for (let column = 1; column <= rightLength; column += 1) {
      const substitutionCost = left[row - 1] === right[column - 1] ? 0 : 1;
      currentRow[column] = Math.min(
        previousRow[column] + 1,
        currentRow[column - 1] + 1,
        previousRow[column - 1] + substitutionCost,
      );
    }

    for (let column = 0; column <= rightLength; column += 1) {
      previousRow[column] = currentRow[column];
    }
  }

  const distance = previousRow[rightLength];
  const maxLength = Math.max(leftLength, rightLength);

  return Math.max(0, 1 - distance / maxLength);
}

function isFarLocation(oldLine: DocumentLineRecord, newLine: DocumentLineRecord) {
  const pageDistance = Math.abs(oldLine.page_number - newLine.page_number);
  const lineDistance = Math.abs(oldLine.line_number - newLine.line_number);

  return pageDistance >= 2 || lineDistance >= 40;
}

function scoreCandidate(oldLine: PreparedLine, newLine: PreparedLine) {
  const exactCanonicalMatch = oldLine.canonicalText === newLine.canonicalText;
  const baseSimilarity = exactCanonicalMatch
    ? 1
    : levenshteinSimilarity(oldLine.canonicalText, newLine.canonicalText);

  let score = baseSimilarity;

  if (isSimilarSectionTitle(oldLine.sectionTitle, newLine.sectionTitle)) {
    score += 0.06;
  }

  const pageDistance = Math.abs(oldLine.line.page_number - newLine.line.page_number);
  if (pageDistance === 0) {
    score += 0.05;
  } else if (pageDistance === 1) {
    score += 0.03;
  } else if (pageDistance === 2) {
    score += 0.015;
  }

  const lineDistance = Math.abs(oldLine.line.line_number - newLine.line.line_number);
  if (lineDistance <= 1) {
    score += 0.05;
  } else if (lineDistance <= 5) {
    score += 0.025;
  } else if (lineDistance <= 15) {
    score += 0.01;
  }

  return Math.min(1, score);
}

function classifyMatch(oldLine: PreparedLine, newLine: PreparedLine, score: number): ComparisonLineChangeType {
  const farLocation = isFarLocation(oldLine.line, newLine.line);
  const canonicalMatch = oldLine.canonicalText === newLine.canonicalText;
  const strictMatch = oldLine.strictText === newLine.strictText;

  if (canonicalMatch) {
    if (farLocation) {
      return "moved";
    }

    return strictMatch && oldLine.line.text === newLine.line.text ? "unchanged" : "formatting_only";
  }

  if (score >= 0.9) {
    return farLocation ? "moved" : "formatting_only";
  }

  return "modified";
}

function toPreparedLine(line: DocumentLineRecord): PreparedLine {
  return {
    line,
    canonicalText: normalizeComparisonText(line.text),
    strictText: normalizeStrictText(line.text),
    sectionTitle: normalizeComparisonText(line.section_title ?? ""),
  };
}

function buildComparisonRow({ comparisonId, userId, oldLine, newLine, changeType, similarityScore }: ComparisonRowInput): ComparisonLineRecord {
  return {
    id: crypto.randomUUID(),
    comparison_id: comparisonId,
    user_id: userId,
    old_line_id: oldLine?.id ?? null,
    new_line_id: newLine?.id ?? null,
    old_page_number: oldLine?.page_number ?? null,
    new_page_number: newLine?.page_number ?? null,
    old_line_number: oldLine?.line_number ?? null,
    new_line_number: newLine?.line_number ?? null,
    old_text: oldLine?.text ?? null,
    new_text: newLine?.text ?? null,
    normalized_old_text: oldLine ? normalizeComparisonText(oldLine.text) : null,
    normalized_new_text: newLine ? normalizeComparisonText(newLine.text) : null,
    section_title: oldLine?.section_title ?? newLine?.section_title ?? null,
    change_type: changeType,
    similarity_score: similarityScore,
    created_at: new Date().toISOString(),
  };
}

function findBestCandidate(
  oldLine: PreparedLine,
  newLines: PreparedLine[],
  unmatchedNewIndices: Set<number>,
  candidateIndices: number[],
) {
  let bestCandidate: MatchCandidate | null = null;

  for (const newIndex of candidateIndices) {
    if (!unmatchedNewIndices.has(newIndex)) {
      continue;
    }

    const score = scoreCandidate(oldLine, newLines[newIndex]);

    if (!bestCandidate || score > bestCandidate.score) {
      bestCandidate = { oldIndex: -1, newIndex, score };
    }
  }

  return bestCandidate;
}

function addMatch(
  rows: ComparisonLineRecord[],
  matchedOld: PreparedLine,
  matchedNew: PreparedLine,
  comparisonId: string,
  userId: string,
  score: number,
) {
  rows.push(
    buildComparisonRow({
      comparisonId,
      userId,
      oldLine: matchedOld.line,
      newLine: matchedNew.line,
      changeType: classifyMatch(matchedOld, matchedNew, score),
      similarityScore: score,
    }),
  );
}

function sortComparisonRows(rows: ComparisonLineRecord[]) {
  return rows.sort((left, right) => {
    const leftPage = left.old_page_number ?? left.new_page_number ?? Number.MAX_SAFE_INTEGER;
    const rightPage = right.old_page_number ?? right.new_page_number ?? Number.MAX_SAFE_INTEGER;

    if (leftPage !== rightPage) {
      return leftPage - rightPage;
    }

    const leftLine = left.old_line_number ?? left.new_line_number ?? Number.MAX_SAFE_INTEGER;
    const rightLine = right.old_line_number ?? right.new_line_number ?? Number.MAX_SAFE_INTEGER;

    if (leftLine !== rightLine) {
      return leftLine - rightLine;
    }

    return left.created_at.localeCompare(right.created_at);
  });
}

function pairExactMatches(
  rows: ComparisonLineRecord[],
  oldLines: PreparedLine[],
  newLines: PreparedLine[],
  unmatchedOldIndices: Set<number>,
  unmatchedNewIndices: Set<number>,
  comparisonId: string,
  userId: string,
) {
  for (const oldIndex of [...unmatchedOldIndices]) {
    const oldLine = oldLines[oldIndex];

    for (const newIndex of unmatchedNewIndices) {
      const newLine = newLines[newIndex];

      if (oldLine.canonicalText !== newLine.canonicalText) {
        continue;
      }

      const score = scoreCandidate(oldLine, newLine);
      addMatch(rows, oldLine, newLine, comparisonId, userId, score);
      unmatchedOldIndices.delete(oldIndex);
      unmatchedNewIndices.delete(newIndex);
      break;
    }
  }
}

export function buildComparisonLines({
  comparisonId,
  userId,
  oldLines,
  newLines,
}: {
  comparisonId: string;
  userId: string;
  oldLines: DocumentLineRecord[];
  newLines: DocumentLineRecord[];
}) {
  const preparedOldLines = oldLines.map(toPreparedLine);
  const preparedNewLines = newLines.map(toPreparedLine);
  const unmatchedOldIndices = new Set(preparedOldLines.map((_, index) => index));
  const unmatchedNewIndices = new Set(preparedNewLines.map((_, index) => index));
  const rows: ComparisonLineRecord[] = [];
  const localWindow = 30;
  let newCursor = 0;

  for (let oldIndex = 0; oldIndex < preparedOldLines.length; oldIndex += 1) {
    const oldLine = preparedOldLines[oldIndex];
    const startIndex = Math.max(0, newCursor - 3);
    const endIndex = Math.min(preparedNewLines.length - 1, newCursor + localWindow);
    const candidateIndices: number[] = [];

    for (let newIndex = startIndex; newIndex <= endIndex; newIndex += 1) {
      if (unmatchedNewIndices.has(newIndex)) {
        candidateIndices.push(newIndex);
      }
    }

    const bestCandidate = findBestCandidate(oldLine, preparedNewLines, unmatchedNewIndices, candidateIndices);

    if (bestCandidate && bestCandidate.score >= 0.6) {
      addMatch(
        rows,
        oldLine,
        preparedNewLines[bestCandidate.newIndex],
        comparisonId,
        userId,
        bestCandidate.score,
      );
      unmatchedOldIndices.delete(oldIndex);
      unmatchedNewIndices.delete(bestCandidate.newIndex);
      newCursor = Math.max(newCursor, bestCandidate.newIndex + 1);
    }
  }

  pairExactMatches(
    rows,
    preparedOldLines,
    preparedNewLines,
    unmatchedOldIndices,
    unmatchedNewIndices,
    comparisonId,
    userId,
  );

  for (const oldIndex of unmatchedOldIndices) {
    const oldLine = preparedOldLines[oldIndex];
    rows.push(
      buildComparisonRow({
        comparisonId,
        userId,
        oldLine: oldLine.line,
        newLine: null,
        changeType: "removed",
        similarityScore: null,
      }),
    );
  }

  for (const newIndex of unmatchedNewIndices) {
    const newLine = preparedNewLines[newIndex];
    rows.push(
      buildComparisonRow({
        comparisonId,
        userId,
        oldLine: null,
        newLine: newLine.line,
        changeType: "added",
        similarityScore: null,
      }),
    );
  }

  return sortComparisonRows(rows);
}