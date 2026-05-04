export type ComparisonStatus = "uploaded" | "processing" | "processed" | "compared" | "summarized" | "completed" | "failed";
export type DocumentStatus = "uploaded" | "processing" | "processed" | "failed";
export type DocumentOutputType = "txt" | "markdown";
export type SummaryRiskLevel = "low" | "medium" | "high";
export type ComparisonLineChangeType =
  | "unchanged"
  | "modified"
  | "added"
  | "removed"
  | "moved"
  | "formatting_only";
export type ComparisonSpanSourceType = "word_diff" | "line_fallback" | "ai_aligned_span" | "estimated_line_fallback";
export type DocumentBlockType =
  | "heading"
  | "paragraph"
  | "table_row"
  | "signature"
  | "footer"
  | "header"
  | "unknown";

export interface DocumentPageRecord {
  id: string;
  document_id: string;
  user_id: string;
  page_number: number;
  image_storage_path: string | null;
  width: number | null;
  height: number | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface DocumentLineRecord {
  id: string;
  document_id: string;
  user_id: string;
  page_number: number;
  line_number: number;
  text: string;
  normalized_text: string;
  section_title: string | null;
  block_type: DocumentBlockType;
  bbox_top: number | null;
  bbox_left: number | null;
  bbox_width: number | null;
  bbox_height: number | null;
  confidence: number | null;
  created_at: string;
}

export interface DocumentWordRecord {
  id: string;
  document_id: string;
  document_line_id: string;
  user_id: string;
  page_number: number;
  line_number: number;
  word_index: number;
  text: string;
  normalized_text: string;
  bbox_top: number | null;
  bbox_left: number | null;
  bbox_width: number | null;
  bbox_height: number | null;
  confidence: number | null;
  created_at: string;
}

export interface DocumentOutputRecord {
  id: string;
  document_id: string;
  user_id: string;
  output_type: DocumentOutputType;
  storage_path: string;
  created_at: string;
}

export interface DocumentRecord {
  id: string;
  user_id: string;
  comparison_id: string;
  document_role: "old" | "new";
  file_name: string;
  file_type: string;
  file_size: number;
  storage_path: string;
  status: DocumentStatus;
  created_at: string;
  updated_at: string;
}

export interface ComparisonRecord {
  id: string;
  user_id: string;
  title: string;
  status: ComparisonStatus;
  old_document_id: string | null;
  new_document_id: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface ComparisonLineRecord {
  id: string;
  comparison_id: string;
  user_id: string;
  old_line_id: string | null;
  new_line_id: string | null;
  old_page_number: number | null;
  new_page_number: number | null;
  old_line_number: number | null;
  new_line_number: number | null;
  old_text: string | null;
  new_text: string | null;
  normalized_old_text: string | null;
  normalized_new_text: string | null;
  section_title: string | null;
  change_type: ComparisonLineChangeType;
  similarity_score: number | null;
  created_at: string;
}

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

export interface ComparisonSummaryRecord {
  id: string;
  comparison_id: string;
  user_id: string;
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
  risk_level: SummaryRiskLevel | null;
  created_at: string;
  updated_at: string;
}

export interface ChangeSummaryRecord {
  id: string;
  comparison_id: string;
  comparison_line_id: string;
  user_id: string;
  section_title: string | null;
  change_type: Exclude<ComparisonLineChangeType, "unchanged">;
  short_summary: string;
  old_meaning: string | null;
  new_meaning: string | null;
  practical_impact: string | null;
  risk_level: SummaryRiskLevel;
  confidence: number | null;
  created_at: string;
}
