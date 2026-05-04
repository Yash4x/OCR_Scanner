export interface CreateComparisonState {
  error: string | null;
}

export interface ProcessComparisonState {
  error: string | null;
}

export interface RunComparisonState {
  error: string | null;
}

export interface RegenerateFullComparisonState {
  error: string | null;
  message: string | null;
}

export interface GenerateSummaryState {
  error: string | null;
}

export interface RegeneratePaperHighlightsState {
  error: string | null;
  message: string | null;
  stats?: {
    spansAttempted: number;
    spansInserted: number;
    skippedCount: number;
    skippedReasons: Record<string, number>;
    skippedDetails: Array<{ comparison_line_id: string; side: string; reason_code: string; reason: string }>;
    insertError: string | null;
  } | null;
}

export interface ComparisonPipelineHealth {
  oldDocumentId: string | null;
  newDocumentId: string | null;
  oldPagesCount: number;
  newPagesCount: number;
  oldLinesCount: number;
  newLinesCount: number;
  oldWordsCount: number;
  newWordsCount: number;
  comparisonLinesCount: number;
  changedComparisonLinesCount: number;
  comparisonSpansCount: number;
  missingOldLineIds: string[];
  missingNewLineIds: string[];
  linesWithoutWords: string[];
  linesWithoutBboxes: string[];
  skippedReasons: string[];
}

export interface PipelineHealthCheckState {
  error: string | null;
  health: ComparisonPipelineHealth | null;
}

export const initialCreateComparisonState: CreateComparisonState = {
  error: null,
};

export const initialProcessComparisonState: ProcessComparisonState = {
  error: null,
};

export const initialRunComparisonState: RunComparisonState = {
  error: null,
};

export const initialRegenerateFullComparisonState: RegenerateFullComparisonState = {
  error: null,
  message: null,
};

export const initialGenerateSummaryState: GenerateSummaryState = {
  error: null,
};

export const initialRegeneratePaperHighlightsState: RegeneratePaperHighlightsState = {
  error: null,
  message: null,
  stats: null,
};

export const initialPipelineHealthCheckState: PipelineHealthCheckState = {
  error: null,
  health: null,
};