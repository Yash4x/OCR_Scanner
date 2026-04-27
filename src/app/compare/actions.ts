"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { buildComparisonLines } from "@/lib/comparison-engine";
import type { ComparisonStatus, DocumentLineRecord, DocumentOutputType, DocumentRecord } from "@/lib/types";
import type { CreateComparisonState, ProcessComparisonState, RunComparisonState } from "@/app/compare/state";
import {
  buildMarkdownOutput,
  buildPlainTextOutput,
  createDocumentOutputPath,
  createPageImagePath,
  loadImagePage,
  ocrPageImage,
  renderPdfPages,
  toDocumentLineRows,
  toDocumentPageRows,
} from "@/lib/document-processing";

const ACCEPTED_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpg",
  "image/jpeg",
] as const;

function traceProcessStep(comparisonId: string, step: string) {
  console.log(`[compare:${comparisonId}] ${step}`);
}

function traceComparisonStep(comparisonId: string, step: string) {
  console.log(`[comparison:${comparisonId}] ${step}`);
}

function sanitizeFilename(filename: string) {
  return filename.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function asFile(formData: FormData, key: string): File | null {
  const value = formData.get(key);
  if (
    value &&
    typeof value === "object" &&
    "size" in value &&
    typeof value.size === "number" &&
    value.size > 0 &&
    "type" in value &&
    typeof value.type === "string" &&
    typeof (value as File).arrayBuffer === "function"
  ) {
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

async function downloadFileFromStorage(
  supabase: Awaited<ReturnType<typeof createClient>>,
  storagePath: string,
  comparisonId: string,
  documentRole: "old" | "new",
) {
  traceProcessStep(comparisonId, `${documentRole}: downloading raw file`);
  const { data, error } = await supabase.storage.from("raw-documents").download(storagePath);

  if (error || !data) {
    throw new Error(error?.message ?? `Failed to download ${storagePath}.`);
  }

  return Buffer.from(await data.arrayBuffer());
}

async function uploadGeneratedTextFile(
  supabase: Awaited<ReturnType<typeof createClient>>,
  storagePath: string,
  fileContents: string,
  comparisonId: string,
  documentRole: "old" | "new",
  outputType: DocumentOutputType,
) {
  traceProcessStep(comparisonId, `${documentRole}: uploading ${outputType} output`);
  const { error } = await supabase.storage.from("extracted-text").upload(
    storagePath,
    Buffer.from(fileContents, "utf8"),
    {
      contentType: storagePath.endsWith(".md") ? "text/markdown" : "text/plain",
      upsert: true,
    },
  );

  if (error) {
    throw new Error(error.message);
  }
}

async function uploadPageImage(
  supabase: Awaited<ReturnType<typeof createClient>>,
  storagePath: string,
  imageBuffer: Buffer,
  comparisonId: string,
  documentRole: "old" | "new",
  pageNumber: number,
) {
  traceProcessStep(comparisonId, `${documentRole}: uploading page image ${pageNumber}`);
  const { error } = await supabase.storage.from("extracted-text").upload(storagePath, imageBuffer, {
    contentType: "image/png",
    upsert: true,
  });

  if (error) {
    throw new Error(error.message);
  }
}

async function processSingleDocument(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  comparisonId: string,
  document: DocumentRecord,
) {
  traceProcessStep(comparisonId, `${document.document_role}: start processing`);
  const fileBuffer = await downloadFileFromStorage(supabase, document.storage_path, comparisonId, document.document_role);
  const isPdf = document.file_type === "application/pdf" || document.file_name.toLowerCase().endsWith(".pdf");
  traceProcessStep(comparisonId, `${document.document_role}: detected ${isPdf ? "pdf" : "image"}`);
  traceProcessStep(comparisonId, `${document.document_role}: entering ${isPdf ? "pdf render" : "image load"}`);
  const pages = isPdf ? await renderPdfPages(fileBuffer) : [await loadImagePage(fileBuffer, document.file_type)];
  traceProcessStep(comparisonId, `${document.document_role}: rendered ${pages.length} page(s)`);

  const ocrPages = [] as Awaited<ReturnType<typeof ocrPageImage>>[];
  const pageImageRows = [] as Array<{ pageNumber: number; storagePath: string | null }>;

  for (const page of pages) {
    const pageImagePath = createPageImagePath(userId, comparisonId, document.document_role, page.pageNumber);
    await uploadPageImage(supabase, pageImagePath, page.imageBuffer, comparisonId, document.document_role, page.pageNumber);
    pageImageRows.push({ pageNumber: page.pageNumber, storagePath: pageImagePath });
    traceProcessStep(comparisonId, `${document.document_role}: OCR page ${page.pageNumber}`);
    ocrPages.push(await ocrPageImage(page));
  }

  const lineRows = toDocumentLineRows(document.id, userId, ocrPages);
  const pageRows = toDocumentPageRows(
    document.id,
    userId,
    pages,
    Object.fromEntries(pageImageRows.map((entry) => [entry.pageNumber, { storagePath: entry.storagePath }])) as Record<
      number,
      { storagePath: string | null }
    >,
  );

  await supabase.from("document_pages").delete().eq("document_id", document.id);
  await supabase.from("document_lines").delete().eq("document_id", document.id);
  await supabase.from("document_outputs").delete().eq("document_id", document.id);

  if (pageRows.length > 0) {
    traceProcessStep(comparisonId, `${document.document_role}: insert document_pages (${pageRows.length})`);
    const { error: pagesError } = await supabase.from("document_pages").insert(pageRows);

    if (pagesError) {
      throw new Error(pagesError.message);
    }
  }

  if (lineRows.length > 0) {
    traceProcessStep(comparisonId, `${document.document_role}: insert document_lines (${lineRows.length})`);
    const { error: linesError } = await supabase.from("document_lines").insert(lineRows);

    if (linesError) {
      throw new Error(linesError.message);
    }
  }

  const plainText = buildPlainTextOutput(ocrPages);
  const markdown = buildMarkdownOutput(ocrPages);
  const outputPaths: Record<DocumentOutputType, string> = {
    txt: createDocumentOutputPath(userId, comparisonId, document.document_role, "txt"),
    markdown: createDocumentOutputPath(userId, comparisonId, document.document_role, "markdown"),
  };

  await uploadGeneratedTextFile(supabase, outputPaths.txt, plainText, comparisonId, document.document_role, "txt");
  await uploadGeneratedTextFile(supabase, outputPaths.markdown, markdown, comparisonId, document.document_role, "markdown");

  traceProcessStep(comparisonId, `${document.document_role}: insert document_outputs`);
  const { error: outputsError } = await supabase.from("document_outputs").insert([
    {
      document_id: document.id,
      user_id: userId,
      output_type: "txt",
      storage_path: outputPaths.txt,
    },
    {
      document_id: document.id,
      user_id: userId,
      output_type: "markdown",
      storage_path: outputPaths.markdown,
    },
  ]);

  if (outputsError) {
    throw new Error(outputsError.message);
  }

  traceProcessStep(comparisonId, `${document.document_role}: update document status`);
  const { error: documentUpdateError } = await supabase
    .from("documents")
    .update({ status: "processed", updated_at: new Date().toISOString() })
    .eq("id", document.id);

  if (documentUpdateError) {
    throw new Error(documentUpdateError.message);
  }
}

export async function processComparisonAction(
  _prevState: ProcessComparisonState,
  formData: FormData,
): Promise<ProcessComparisonState> {
  const comparisonIdValue = formData.get("comparisonId");
  const comparisonId = typeof comparisonIdValue === "string" ? comparisonIdValue.trim() : "";

  if (!comparisonId) {
    return { error: "Comparison id is required." };
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
    .select("id, status, old_document_id, new_document_id")
    .eq("id", comparisonId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (comparisonError || !comparison) {
    return { error: comparisonError?.message ?? "Comparison not found." };
  }

  traceProcessStep(comparisonId, "comparison loaded");

  const { data: documents, error: documentsError } = await supabase
    .from("documents")
    .select("id, user_id, comparison_id, document_role, file_name, file_type, file_size, storage_path, status, created_at, updated_at")
    .eq("comparison_id", comparisonId)
    .eq("user_id", user.id)
    .order("document_role", { ascending: true });

  if (documentsError || !documents || documents.length !== 2) {
    return { error: documentsError?.message ?? "Both documents must be uploaded before processing." };
  }

  traceProcessStep(comparisonId, `documents loaded (${documents.length})`);

  const oldDocument = documents.find((document) => document.document_role === "old");
  const newDocument = documents.find((document) => document.document_role === "new");

  if (!oldDocument || !newDocument) {
    return { error: "Both old and new documents are required." };
  }

  const statusNow = new Date().toISOString();
  const { error: comparisonProcessingError } = await supabase
    .from("comparisons")
    .update({ status: "processing", updated_at: statusNow })
    .eq("id", comparisonId)
    .eq("user_id", user.id);

  if (comparisonProcessingError) {
    return { error: comparisonProcessingError.message };
  }

  traceProcessStep(comparisonId, "comparison marked processing");

  const { error: documentProcessingError } = await supabase
    .from("documents")
    .update({ status: "processing", updated_at: statusNow })
    .in("id", [oldDocument.id, newDocument.id])
    .eq("user_id", user.id);

  if (documentProcessingError) {
    return { error: documentProcessingError.message };
  }

  traceProcessStep(comparisonId, "documents marked processing");

  try {
    traceProcessStep(comparisonId, "begin old document processing");
    await processSingleDocument(supabase, user.id, comparisonId, oldDocument);
    traceProcessStep(comparisonId, "old document complete");
    traceProcessStep(comparisonId, "begin new document processing");
    await processSingleDocument(supabase, user.id, comparisonId, newDocument);
    traceProcessStep(comparisonId, "new document complete");

    const { error: finalComparisonUpdateError } = await supabase
      .from("comparisons")
      .update({
        status: "processed" satisfies ComparisonStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", comparisonId)
      .eq("user_id", user.id);

    if (finalComparisonUpdateError) {
      return { error: finalComparisonUpdateError.message };
    }

    traceProcessStep(comparisonId, "comparison marked processed");

    revalidatePath(`/compare/${comparisonId}`);
    redirect(`/compare/${comparisonId}`);
  } catch (error) {
    // Re-throw Next.js redirect errors (not real failures)
    if (error instanceof Error && error.message === "NEXT_REDIRECT") {
      throw error;
    }

    const message = error instanceof Error ? error.message : "Failed to process documents.";
    console.error(`[compare:${comparisonId}] failed`, error);

    await supabase
      .from("comparisons")
      .update({ status: "failed", updated_at: new Date().toISOString() })
      .eq("id", comparisonId)
      .eq("user_id", user.id);

    await supabase
      .from("documents")
      .update({ status: "failed", updated_at: new Date().toISOString() })
      .in("id", [oldDocument.id, newDocument.id])
      .eq("user_id", user.id);

    return { error: message };
  }
}

function chunkArray<T>(items: T[], chunkSize: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }

  return chunks;
}

export async function runComparisonAction(
  _prevState: RunComparisonState,
  formData: FormData,
): Promise<RunComparisonState> {
  const comparisonIdValue = formData.get("comparisonId");
  const comparisonId = typeof comparisonIdValue === "string" ? comparisonIdValue.trim() : "";

  if (!comparisonId) {
    return { error: "Comparison id is required." };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { error: "You must be logged in." };
  }

  try {
    const { data: comparison, error: comparisonError } = await supabase
      .from("comparisons")
      .select("id, status, old_document_id, new_document_id")
      .eq("id", comparisonId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (comparisonError || !comparison) {
      return { error: comparisonError?.message ?? "Comparison not found." };
    }

    traceComparisonStep(comparisonId, "comparison loaded");

    const { data: documents, error: documentsError } = await supabase
      .from("documents")
      .select("id, user_id, comparison_id, document_role, file_name, file_type, file_size, storage_path, status, created_at, updated_at")
      .eq("comparison_id", comparisonId)
      .eq("user_id", user.id)
      .order("document_role", { ascending: true });

    if (documentsError || !documents || documents.length !== 2) {
      return { error: documentsError?.message ?? "Both documents must be uploaded before comparing." };
    }

    const oldDocument = documents.find((document) => document.document_role === "old");
    const newDocument = documents.find((document) => document.document_role === "new");

    if (!oldDocument || !newDocument) {
      return { error: "Both old and new documents are required." };
    }

    if (oldDocument.status !== "processed" || newDocument.status !== "processed") {
      return { error: "Both documents must be processed before running the comparison." };
    }

    const { data: oldLines, error: oldLinesError } = await supabase
      .from("document_lines")
      .select("id, document_id, user_id, page_number, line_number, text, normalized_text, section_title, block_type, bbox_top, bbox_left, bbox_width, bbox_height, confidence, created_at")
      .eq("document_id", oldDocument.id)
      .eq("user_id", user.id)
      .order("page_number", { ascending: true })
      .order("line_number", { ascending: true });

    const { data: newLines, error: newLinesError } = await supabase
      .from("document_lines")
      .select("id, document_id, user_id, page_number, line_number, text, normalized_text, section_title, block_type, bbox_top, bbox_left, bbox_width, bbox_height, confidence, created_at")
      .eq("document_id", newDocument.id)
      .eq("user_id", user.id)
      .order("page_number", { ascending: true })
      .order("line_number", { ascending: true });

    if (oldLinesError || newLinesError) {
      return { error: oldLinesError?.message ?? newLinesError?.message ?? "Failed to load document lines." };
    }

    if (!oldLines || !newLines) {
      return { error: "Document lines are missing for one or both documents." };
    }

    traceComparisonStep(comparisonId, `loaded ${oldLines.length} old line(s) and ${newLines.length} new line(s)`);

    const statusNow = new Date().toISOString();

    const { error: processingError } = await supabase
      .from("comparisons")
      .update({ status: "processing", updated_at: statusNow })
      .eq("id", comparisonId)
      .eq("user_id", user.id);

    if (processingError) {
      return { error: processingError.message };
    }

    const comparisonLines = buildComparisonLines({
      comparisonId,
      userId: user.id,
      oldLines: oldLines as DocumentLineRecord[],
      newLines: newLines as DocumentLineRecord[],
    });

    traceComparisonStep(comparisonId, `built ${comparisonLines.length} comparison row(s)`);

    const { error: deleteError } = await supabase.from("comparison_lines").delete().eq("comparison_id", comparisonId);

    if (deleteError) {
      throw new Error(deleteError.message);
    }

    for (const chunk of chunkArray(comparisonLines, 200)) {
      if (chunk.length === 0) {
        continue;
      }

      const { error: insertError } = await supabase.from("comparison_lines").insert(chunk);

      if (insertError) {
        throw new Error(insertError.message);
      }
    }

    const completedAt = new Date().toISOString();
    const { error: finalComparisonUpdateError } = await supabase
      .from("comparisons")
      .update({
        status: "compared" satisfies ComparisonStatus,
        updated_at: completedAt,
        completed_at: completedAt,
      })
      .eq("id", comparisonId)
      .eq("user_id", user.id);

    if (finalComparisonUpdateError) {
      throw new Error(finalComparisonUpdateError.message);
    }

    traceComparisonStep(comparisonId, "comparison marked compared");

    revalidatePath(`/compare/${comparisonId}`);
    redirect(`/compare/${comparisonId}`);
  } catch (error) {
    // Re-throw Next.js redirect errors (not real failures)
    if (error instanceof Error && error.message === "NEXT_REDIRECT") {
      throw error;
    }

    const message = error instanceof Error ? error.message : "Failed to compare documents.";
    console.error(`[comparison:${comparisonId}] failed`, error);

    await supabase
      .from("comparisons")
      .update({ status: "failed", updated_at: new Date().toISOString() })
      .eq("id", comparisonId)
      .eq("user_id", user.id);

    return { error: message };
  }
}
