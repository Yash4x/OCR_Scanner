export type ComparisonStatus = "uploaded" | "processing" | "processed" | "completed" | "failed";
export type DocumentStatus = "uploaded" | "processing" | "processed" | "failed";
export type DocumentOutputType = "txt" | "markdown";
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
