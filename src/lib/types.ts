export type ComparisonStatus = "uploaded" | "processing" | "processed" | "compared" | "completed" | "failed";
export type DocumentStatus = "uploaded" | "processing" | "processed" | "failed";
export type DocumentOutputType = "txt" | "markdown";
export type ComparisonLineChangeType =
  | "unchanged"
  | "modified"
  | "added"
  | "removed"
  | "moved"
  | "formatting_only";
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
