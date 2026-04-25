export type ComparisonStatus = "uploaded" | "processing" | "completed" | "failed";

export interface DocumentRecord {
  id: string;
  user_id: string;
  comparison_id: string;
  document_role: "old" | "new";
  file_name: string;
  file_type: string;
  file_size: number;
  storage_path: string;
  status: string;
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
