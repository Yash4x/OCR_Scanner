"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const ACCEPTED_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpg",
  "image/jpeg",
] as const;

export interface CreateComparisonState {
  error: string | null;
}

export const initialCreateComparisonState: CreateComparisonState = {
  error: null,
};

function sanitizeFilename(filename: string) {
  return filename.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function asFile(formData: FormData, key: string): File | null {
  const value = formData.get(key);
  if (value instanceof File && value.size > 0) {
    return value;
  }
  return null;
}

function isValidType(file: File) {
  return ACCEPTED_TYPES.includes(file.type as (typeof ACCEPTED_TYPES)[number]);
}

export async function createComparisonAction(
  _prevState: CreateComparisonState,
  formData: FormData,
): Promise<CreateComparisonState> {
  const titleValue = formData.get("title");
  const title = typeof titleValue === "string" ? titleValue.trim() : "";
  const oldFile = asFile(formData, "oldDocument");
  const newFile = asFile(formData, "newDocument");

  if (!title || !oldFile || !newFile) {
    return { error: "Title, old document, and new document are required." };
  }

  if (!isValidType(oldFile) || !isValidType(newFile)) {
    return { error: "Only PDF, PNG, JPG, and JPEG files are supported." };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { error: "You must be logged in." };
  }

  const { data: comparison, error: comparisonError } = await supabase
    .from("comparisons")
    .insert({
      user_id: user.id,
      title,
      status: "uploaded",
    })
    .select("id")
    .single();

  if (comparisonError || !comparison) {
    return { error: comparisonError?.message ?? "Failed to create comparison." };
  }

  const oldPath = `${user.id}/${comparison.id}/old/${sanitizeFilename(oldFile.name)}`;
  const newPath = `${user.id}/${comparison.id}/new/${sanitizeFilename(newFile.name)}`;

  const { error: uploadOldError } = await supabase.storage
    .from("raw-documents")
    .upload(oldPath, oldFile, {
      contentType: oldFile.type,
      upsert: false,
    });

  if (uploadOldError) {
    await supabase.from("comparisons").delete().eq("id", comparison.id);
    return { error: `Old document upload failed: ${uploadOldError.message}` };
  }

  const { error: uploadNewError } = await supabase.storage
    .from("raw-documents")
    .upload(newPath, newFile, {
      contentType: newFile.type,
      upsert: false,
    });

  if (uploadNewError) {
    await supabase.storage.from("raw-documents").remove([oldPath]);
    await supabase.from("comparisons").delete().eq("id", comparison.id);
    return { error: `New document upload failed: ${uploadNewError.message}` };
  }

  const { data: createdDocuments, error: docsError } = await supabase
    .from("documents")
    .insert([
      {
        user_id: user.id,
        comparison_id: comparison.id,
        document_role: "old",
        file_name: oldFile.name,
        file_type: oldFile.type,
        file_size: oldFile.size,
        storage_path: oldPath,
        status: "uploaded",
      },
      {
        user_id: user.id,
        comparison_id: comparison.id,
        document_role: "new",
        file_name: newFile.name,
        file_type: newFile.type,
        file_size: newFile.size,
        storage_path: newPath,
        status: "uploaded",
      },
    ])
    .select("id, document_role");

  if (docsError || !createdDocuments || createdDocuments.length !== 2) {
    await supabase.storage.from("raw-documents").remove([oldPath, newPath]);
    await supabase.from("comparisons").delete().eq("id", comparison.id);
    return { error: docsError?.message ?? "Failed to save document metadata." };
  }

  const oldDocument = createdDocuments.find((doc) => doc.document_role === "old");
  const newDocument = createdDocuments.find((doc) => doc.document_role === "new");

  const { error: updateComparisonError } = await supabase
    .from("comparisons")
    .update({
      old_document_id: oldDocument?.id ?? null,
      new_document_id: newDocument?.id ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", comparison.id);

  if (updateComparisonError) {
    return { error: updateComparisonError.message };
  }

  redirect(`/compare/${comparison.id}`);
}
