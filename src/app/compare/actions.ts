"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { buildComparisonLines } from "@/lib/comparison-engine";
<<<<<<< HEAD
import { isContentComparisonLine, withEffectiveChangeType } from "@/lib/comparison-line-utils";
=======
import { generateComparisonSpans, getComparisonPipelineHealth } from "@/lib/comparison-spans";
>>>>>>> 2d40c72 (ai detection)
import { generateLineExplanation, generateOverallSummary, groupChangedLines, toChangeSummaryRow } from "@/lib/summary-engine";
import type { ComparisonLineRecord, ComparisonStatus, DocumentLineRecord, DocumentOutputType, DocumentRecord } from "@/lib/types";
import type {
  CreateComparisonState,
  GenerateSummaryState,
  ProcessComparisonState,
  PipelineHealthCheckState,
  RegenerateFullComparisonState,
  RegeneratePaperHighlightsState,
  RunComparisonState,
} from "@/app/compare/state";
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
  toDocumentWordRows,
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
  await supabase.from("document_words").delete().eq("document_id", document.id);
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

    // Build a map of line IDs by page and line number for word insertion
    const { data: insertedLines } = await supabase
      .from("document_lines")
      .select("id, page_number, line_number")
      .eq("document_id", document.id);

    const lineIdsByPageAndLine = Object.fromEntries(
      (insertedLines ?? []).map((line) => [`${line.page_number}:${line.line_number}`, line.id]),
    ) as Record<string, string>;

    const wordRows = toDocumentWordRows(document.id, userId, lineIdsByPageAndLine, ocrPages);

    if (wordRows.length > 0) {
      traceProcessStep(comparisonId, `${document.document_role}: insert document_words (${wordRows.length})`);
      const { error: wordsError } = await supabase.from("document_words").insert(wordRows);

      if (wordsError) {
        throw new Error(wordsError.message);
      }
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

async function runWithConcurrency<TInput, TOutput>(items: TInput[], concurrency: number, task: (item: TInput) => Promise<TOutput>) {
  const results: TOutput[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const current = nextIndex;
      nextIndex += 1;
      results[current] = await task(items[current]);
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

async function runComparisonPipeline(params: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  comparisonId: string;
  userId: string;
}) {
  const { supabase, comparisonId, userId } = params;

  const { data: comparison, error: comparisonError } = await supabase
    .from("comparisons")
    .select("id, status, old_document_id, new_document_id")
    .eq("id", comparisonId)
    .eq("user_id", userId)
    .maybeSingle();

  if (comparisonError || !comparison) {
    return { error: comparisonError?.message ?? "Comparison not found." } as const;
  }

  traceComparisonStep(comparisonId, "comparison loaded");

  const { data: documents, error: documentsError } = await supabase
    .from("documents")
    .select("id, user_id, comparison_id, document_role, file_name, file_type, file_size, storage_path, status, created_at, updated_at")
    .eq("comparison_id", comparisonId)
    .eq("user_id", userId)
    .order("document_role", { ascending: true });

  if (documentsError || !documents || documents.length !== 2) {
    return { error: documentsError?.message ?? "Both documents must be uploaded before comparing." } as const;
  }

  const oldDocument = documents.find((document) => document.document_role === "old");
  const newDocument = documents.find((document) => document.document_role === "new");

  if (!oldDocument || !newDocument) {
    return { error: "Both old and new documents are required." } as const;
  }

  if (oldDocument.status !== "processed" || newDocument.status !== "processed") {
    return { error: "Both documents must be processed before running the comparison." } as const;
  }

  const { data: oldLines, error: oldLinesError } = await supabase
    .from("document_lines")
    .select("id, document_id, user_id, page_number, line_number, text, normalized_text, section_title, block_type, bbox_top, bbox_left, bbox_width, bbox_height, confidence, created_at")
    .eq("document_id", oldDocument.id)
    .eq("user_id", userId)
    .order("page_number", { ascending: true })
    .order("line_number", { ascending: true });

  const { data: newLines, error: newLinesError } = await supabase
    .from("document_lines")
    .select("id, document_id, user_id, page_number, line_number, text, normalized_text, section_title, block_type, bbox_top, bbox_left, bbox_width, bbox_height, confidence, created_at")
    .eq("document_id", newDocument.id)
    .eq("user_id", userId)
    .order("page_number", { ascending: true })
    .order("line_number", { ascending: true });

  if (oldLinesError || newLinesError) {
    return { error: oldLinesError?.message ?? newLinesError?.message ?? "Failed to load document lines." } as const;
  }

  if (!oldLines || !newLines) {
    return { error: "Document lines are missing for one or both documents." } as const;
  }

  traceComparisonStep(comparisonId, `loaded ${oldLines.length} old line(s) and ${newLines.length} new line(s)`);

  const statusNow = new Date().toISOString();

  const { error: processingError } = await supabase
    .from("comparisons")
    .update({ status: "processing", updated_at: statusNow })
    .eq("id", comparisonId)
    .eq("user_id", userId);

  if (processingError) {
    return { error: processingError.message } as const;
  }

  const comparisonLines = buildComparisonLines({
    comparisonId,
    userId,
    oldLines: oldLines as DocumentLineRecord[],
    newLines: newLines as DocumentLineRecord[],
  });

  traceComparisonStep(comparisonId, `built ${comparisonLines.length} comparison row(s)`);

  const { error: deleteError } = await supabase.from("comparison_lines").delete().eq("comparison_id", comparisonId);

  if (deleteError) {
    throw new Error(deleteError.message);
  }

  const { error: deleteSummaryError } = await supabase.from("comparison_summaries").delete().eq("comparison_id", comparisonId);

  if (deleteSummaryError) {
    throw new Error(deleteSummaryError.message);
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

  const { spans, diagnostics, stats } = await generateComparisonSpans({
    supabase,
    comparisonId,
    userId,
  });

  const { error: deleteSpanError } = await supabase.from("comparison_spans").delete().eq("comparison_id", comparisonId);

  if (deleteSpanError) {
    throw new Error(deleteSpanError.message);
  }

  if (spans.length > 0) {
    const { data: insertedSpans, error: insertSpanError } = await supabase.from("comparison_spans").insert(spans).select("id");

    if (insertSpanError) {
      console.error(`[comparison:${comparisonId}] comparison_spans insert failed`, insertSpanError);
      throw new Error(insertSpanError.message);
    }

    traceComparisonStep(comparisonId, `comparison_spans insert ok: attempted=${spans.length}, inserted=${insertedSpans?.length ?? 0}`);
  }

  traceComparisonStep(comparisonId, `generated ${spans.length} comparison span(s)`);
  if (diagnostics.length > 0) {
    traceComparisonStep(comparisonId, `span diagnostics: ${diagnostics.length} skipped change(s)`);
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
    .eq("user_id", userId);

  if (finalComparisonUpdateError) {
    throw new Error(finalComparisonUpdateError.message);
  }

  traceComparisonStep(comparisonId, "comparison marked compared");

  return {
    error: null,
    stats,
  } as const;
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
    const result = await runComparisonPipeline({ supabase, comparisonId, userId: user.id });

    if (result.error) {
      return { error: result.error };
    }

    revalidatePath(`/compare/${comparisonId}`);
    revalidatePath(`/compare/${comparisonId}/paper-view`);
    redirect(`/compare/${comparisonId}`);
  } catch (error) {
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

export async function regenerateFullComparisonAction(
  _prevState: RegenerateFullComparisonState,
  formData: FormData,
): Promise<RegenerateFullComparisonState> {
  const comparisonIdValue = formData.get("comparisonId");
  const comparisonId = typeof comparisonIdValue === "string" ? comparisonIdValue.trim() : "";

  if (!comparisonId) {
    return { error: "Comparison id is required.", message: null };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { error: "You must be logged in.", message: null };
  }

  try {
    const result = await runComparisonPipeline({ supabase, comparisonId, userId: user.id });

    if (result.error) {
      return { error: result.error, message: null };
    }

    revalidatePath(`/compare/${comparisonId}`);
    revalidatePath(`/compare/${comparisonId}/paper-view`);

    return {
      error: null,
      message: `Rebuilt comparison lines and spans successfully.`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to regenerate full comparison.";
    console.error(`[comparison:${comparisonId}] regenerate full comparison failed`, error);
    return { error: message, message: null };
  }
}

export async function regeneratePaperHighlightsAction(
  _prevState: RegeneratePaperHighlightsState,
  formData: FormData,
): Promise<RegeneratePaperHighlightsState> {
  const comparisonIdValue = formData.get("comparisonId");
  const comparisonId = typeof comparisonIdValue === "string" ? comparisonIdValue.trim() : "";

  if (!comparisonId) {
    return { error: "Comparison id is required.", message: null };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { error: "You must be logged in.", message: null };
  }

  try {
    const { spans, diagnostics, changedLineCount, stats } = await generateComparisonSpans({
      supabase,
      comparisonId,
      userId: user.id,
    });

    const { error: deleteError } = await supabase.from("comparison_spans").delete().eq("comparison_id", comparisonId);

    if (deleteError) {
      throw new Error(deleteError.message);
    }

    let insertErrorMessage: string | null = null;
    let insertedCount = 0;

    if (spans.length > 0) {
      const { data: inserted, error: insertError } = await supabase.from("comparison_spans").insert(spans).select("id");

      if (insertError) {
        insertErrorMessage = insertError.message;
        console.error(`[comparison:${comparisonId}] comparison_spans insert failed`, insertError);
      } else {
        insertedCount = inserted?.length ?? 0;
        traceComparisonStep(comparisonId, `comparison_spans insert ok: attempted=${spans.length}, inserted=${insertedCount}`);
      }
    }

    revalidatePath(`/compare/${comparisonId}`);
    revalidatePath(`/compare/${comparisonId}/paper-view`);

    const reasonSummary = Object.entries(stats.skippedReasons)
      .map(([reason, count]) => `${reason}:${count}`)
      .join(", ");

    return {
      error: insertErrorMessage,
      message: insertErrorMessage
        ? `Span generation attempted=${stats.spansAttempted}, generated=${spans.length}, inserted=${insertedCount}. Insert failed: ${insertErrorMessage}`
        : `Regenerated spans: attempted=${stats.spansAttempted}, generated=${spans.length}, inserted=${insertedCount} from ${changedLineCount} changed line(s). Skipped=${diagnostics.length}${reasonSummary ? ` [${reasonSummary}]` : ""}.`,
      stats: {
        spansAttempted: stats.spansAttempted,
        spansInserted: insertedCount,
        skippedCount: diagnostics.length,
        skippedReasons: stats.skippedReasons,
        skippedDetails: diagnostics.slice(0, 10).map((d) => ({
          comparison_line_id: d.comparison_line_id,
          side: d.side,
          reason_code: d.reason_code,
          reason: d.reason,
        })),
        insertError: insertErrorMessage,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to regenerate paper highlights.";
    console.error(`[comparison:${comparisonId}] regenerate highlights failed`, error);
    return { error: message, message: null, stats: null };
  }
}

export async function getComparisonPipelineHealthAction(
  _prevState: PipelineHealthCheckState,
  formData: FormData,
): Promise<PipelineHealthCheckState> {
  const comparisonIdValue = formData.get("comparisonId");
  const comparisonId = typeof comparisonIdValue === "string" ? comparisonIdValue.trim() : "";

  if (!comparisonId) {
    return { error: "Comparison id is required.", health: null };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { error: "You must be logged in.", health: null };
  }

  try {
    const health = await getComparisonPipelineHealth({ supabase, comparisonId, userId: user.id });
    return { error: null, health };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to compute pipeline health.";
    return { error: message, health: null };
  }
}

export async function generateSummaryAction(
  _prevState: GenerateSummaryState,
  formData: FormData,
): Promise<GenerateSummaryState> {
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
      .select("id, status")
      .eq("id", comparisonId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (comparisonError || !comparison) {
      return { error: comparisonError?.message ?? "Comparison not found." };
    }

    if (!["compared", "summarized"].includes(comparison.status)) {
      return { error: "Run comparison before generating an AI summary." };
    }

    const { data: comparisonLines, error: linesError } = await supabase
      .from("comparison_lines")
      .select(
        "id, comparison_id, user_id, old_line_id, new_line_id, old_page_number, new_page_number, old_line_number, new_line_number, old_text, new_text, normalized_old_text, normalized_new_text, section_title, change_type, similarity_score, created_at",
      )
      .eq("comparison_id", comparisonId)
      .eq("user_id", user.id)
      .order("old_page_number", { ascending: true })
      .order("new_page_number", { ascending: true })
      .order("old_line_number", { ascending: true })
      .order("new_line_number", { ascending: true })
      .order("created_at", { ascending: true });

    if (linesError || !comparisonLines) {
      return { error: linesError?.message ?? "Failed to load comparison lines." };
    }

    const effectiveComparisonLines = (comparisonLines as ComparisonLineRecord[]).map(withEffectiveChangeType);
    const changedLines = effectiveComparisonLines.filter(isContentComparisonLine);

    if (changedLines.length === 0) {
      return { error: "No changed lines found to summarize." };
    }

    traceComparisonStep(comparisonId, `building summaries for ${changedLines.length} changed line(s)`);

    const groupedChanges = groupChangedLines(effectiveComparisonLines);
    const overallSummary = await generateOverallSummary(groupedChanges);

    const { error: deleteLineSummaryError } = await supabase
      .from("change_summaries")
      .delete()
      .eq("comparison_id", comparisonId)
      .eq("user_id", user.id);

    if (deleteLineSummaryError) {
      throw new Error(deleteLineSummaryError.message);
    }

    const { error: upsertComparisonSummaryError } = await supabase.from("comparison_summaries").upsert(
      {
        comparison_id: comparisonId,
        user_id: user.id,
        executive_summary: overallSummary.executive_summary,
        major_changes: overallSummary.major_changes,
        risk_level: overallSummary.overall_risk_level,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "comparison_id" },
    );

    if (upsertComparisonSummaryError) {
      throw new Error(upsertComparisonSummaryError.message);
    }

    const explanationRows = await runWithConcurrency(changedLines, 3, async (line) => {
      const explanation = await generateLineExplanation({
        line,
        allSortedLines: effectiveComparisonLines,
      });

      return toChangeSummaryRow({
        comparisonId,
        userId: user.id,
        line,
        explanation,
      });
    });

    for (const chunk of chunkArray(explanationRows, 150)) {
      if (chunk.length === 0) {
        continue;
      }

      const { error: insertError } = await supabase.from("change_summaries").insert(chunk);

      if (insertError) {
        throw new Error(insertError.message);
      }
    }

    const completedAt = new Date().toISOString();
    const { error: finalUpdateError } = await supabase
      .from("comparisons")
      .update({
        status: "summarized" satisfies ComparisonStatus,
        updated_at: completedAt,
        completed_at: completedAt,
      })
      .eq("id", comparisonId)
      .eq("user_id", user.id);

    if (finalUpdateError) {
      throw new Error(finalUpdateError.message);
    }

    traceComparisonStep(comparisonId, "comparison marked summarized");
    revalidatePath(`/compare/${comparisonId}`);
    revalidatePath("/dashboard");
    redirect(`/compare/${comparisonId}`);
  } catch (error) {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") {
      throw error;
    }

    const message = error instanceof Error ? error.message : "Failed to generate AI summary.";
    console.error(`[summary:${comparisonId}] failed`, error);
    return { error: message };
  }
}
