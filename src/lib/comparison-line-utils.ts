import type { ComparisonLineChangeType, ComparisonLineRecord } from "@/lib/types";

function normalizeTextForDisplayComparison(text: string | null) {
  return (text ?? "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/([([{])\s+/g, "$1")
    .replace(/\s+([)\]}])/g, "$1")
    .replace(/\s*-\s*/g, "-");
}

function normalizedOldText(line: ComparisonLineRecord) {
  return line.normalized_old_text ?? normalizeTextForDisplayComparison(line.old_text);
}

function normalizedNewText(line: ComparisonLineRecord) {
  return line.normalized_new_text ?? normalizeTextForDisplayComparison(line.new_text);
}

export function isTrueFormattingOnlyLine(line: ComparisonLineRecord) {
  return line.change_type === "formatting_only" && normalizedOldText(line) === normalizedNewText(line);
}

export function getEffectiveChangeType(line: ComparisonLineRecord): ComparisonLineChangeType {
  if (line.change_type === "formatting_only" && !isTrueFormattingOnlyLine(line)) {
    return "modified";
  }

  return line.change_type;
}

export function isContentComparisonLine(line: ComparisonLineRecord) {
  return getEffectiveChangeType(line) !== "unchanged" && !isTrueFormattingOnlyLine(line);
}

export function withEffectiveChangeType(line: ComparisonLineRecord): ComparisonLineRecord {
  const effectiveChangeType = getEffectiveChangeType(line);

  if (effectiveChangeType === line.change_type) {
    return line;
  }

  return {
    ...line,
    change_type: effectiveChangeType,
  };
}
