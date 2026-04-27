import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ProcessDocumentsForm } from "@/components/process-documents-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import type { DocumentLineRecord, DocumentOutputRecord, DocumentRecord } from "@/lib/types";

function formatDate(dateString: string) {
  return new Date(dateString).toLocaleString();
}

function badgeVariant(status: string): "success" | "warning" | "secondary" | "destructive" {
  if (status === "processing") {
    return "warning";
  }

  if (status === "failed") {
    return "destructive";
  }

  if (status === "processed" || status === "completed" || status === "uploaded") {
    return "success";
  }

  return "secondary";
}

function groupLinesByPage(lines: DocumentLineRecord[]) {
  return lines.reduce<Record<number, DocumentLineRecord[]>>((pages, line) => {
    pages[line.page_number] ||= [];
    pages[line.page_number].push(line);
    return pages;
  }, {});
}

async function createSignedDownloadLink(supabase: Awaited<ReturnType<typeof createClient>>, storagePath: string) {
  console.log(`[compare:page] signing download url for ${storagePath}`);
  const { data, error } = await supabase.storage.from("extracted-text").createSignedUrl(storagePath, 60 * 30);

  if (error || !data) {
    console.error(`[compare:page] failed to sign ${storagePath}`, error);
    return null;
  }

  return data.signedUrl;
}

export default async function ComparisonDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: comparison, error } = await supabase
    .from("comparisons")
    .select("id, title, status, created_at, old_document_id, new_document_id")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    console.error(`[compare:page] failed to load comparison ${id}`, error);
    notFound();
  }

  if (!comparison) {
    notFound();
  }

  const { data: documents } = await supabase
    .from("documents")
    .select("id, user_id, comparison_id, document_role, file_name, file_type, file_size, storage_path, status, created_at, updated_at")
    .eq("comparison_id", comparison.id)
    .eq("user_id", user.id);

  console.log(`[compare:page] loaded documents for ${id}: ${(documents ?? []).length}`);

  const documentsByRole = (documents ?? []).reduce<Record<"old" | "new", DocumentRecord | null>>(
    (result, document) => {
      const documentRole = document.document_role as "old" | "new";
      result[documentRole] = document as DocumentRecord;
      return result;
    },
    { old: null, new: null },
  );

  const documentIds = [documentsByRole.old?.id, documentsByRole.new?.id].filter(
    (documentId): documentId is string => Boolean(documentId),
  );

  const { data: documentLines } =
    documentIds.length > 0
      ? await supabase
          .from("document_lines")
          .select("id, document_id, user_id, page_number, line_number, text, normalized_text, section_title, block_type, bbox_top, bbox_left, bbox_width, bbox_height, confidence, created_at")
          .in("document_id", documentIds)
          .order("page_number", { ascending: true })
          .order("line_number", { ascending: true })
      : { data: [] as DocumentLineRecord[] };

  console.log(`[compare:page] loaded lines for ${id}: ${(documentLines ?? []).length}`);

  const { data: documentOutputs } =
    documentIds.length > 0
      ? await supabase
          .from("document_outputs")
          .select("id, document_id, user_id, output_type, storage_path, created_at")
          .in("document_id", documentIds)
          .order("created_at", { ascending: true })
      : { data: [] as DocumentOutputRecord[] };

  console.log(`[compare:page] loaded outputs for ${id}: ${(documentOutputs ?? []).length}`);

  const linesByDocumentId = (documentLines ?? []).reduce<Record<string, DocumentLineRecord[]>>(
    (result, line) => {
      result[line.document_id] ||= [];
      result[line.document_id].push(line);
      return result;
    },
    {},
  );

  const outputsByDocumentId = (documentOutputs ?? []).reduce<Record<string, DocumentOutputRecord[]>>(
    (result, output) => {
      result[output.document_id] ||= [];
      result[output.document_id].push(output);
      return result;
    },
    {},
  );

  const oldFileName = documentsByRole.old?.file_name ?? "-";
  const newFileName = documentsByRole.new?.file_name ?? "-";
  const oldLines = groupLinesByPage(linesByDocumentId[documentsByRole.old?.id ?? ""] ?? []);
  const newLines = groupLinesByPage(linesByDocumentId[documentsByRole.new?.id ?? ""] ?? []);
  const oldOutputs = outputsByDocumentId[documentsByRole.old?.id ?? ""] ?? [];
  const newOutputs = outputsByDocumentId[documentsByRole.new?.id ?? ""] ?? [];

  const oldTxtOutput = oldOutputs.find((output) => output.output_type === "txt") ?? null;
  const oldMarkdownOutput = oldOutputs.find((output) => output.output_type === "markdown") ?? null;
  const newTxtOutput = newOutputs.find((output) => output.output_type === "txt") ?? null;
  const newMarkdownOutput = newOutputs.find((output) => output.output_type === "markdown") ?? null;

  const [oldTxtUrl, oldMarkdownUrl, newTxtUrl, newMarkdownUrl] = await Promise.all([
    oldTxtOutput ? createSignedDownloadLink(supabase, oldTxtOutput.storage_path) : Promise.resolve(null),
    oldMarkdownOutput ? createSignedDownloadLink(supabase, oldMarkdownOutput.storage_path) : Promise.resolve(null),
    newTxtOutput ? createSignedDownloadLink(supabase, newTxtOutput.storage_path) : Promise.resolve(null),
    newMarkdownOutput ? createSignedDownloadLink(supabase, newMarkdownOutput.storage_path) : Promise.resolve(null),
  ]);

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-5xl space-y-6">
        <Button asChild variant="ghost" size="sm">
          <Link href="/dashboard">Back to dashboard</Link>
        </Button>

        <Card>
          <CardHeader>
            <CardTitle>{comparison.title}</CardTitle>
            <CardDescription>Comparison detail</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5 text-sm text-slate-700">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-slate-500">Comparison status:</span>
              <Badge variant={badgeVariant(comparison.status)}>{comparison.status}</Badge>
            </div>
            <p>
              <span className="text-slate-500">Uploaded at:</span> {formatDate(comparison.created_at)}
            </p>
            <ProcessDocumentsForm comparisonId={comparison.id} />
            <div className="grid gap-4 md:grid-cols-2">
              {(["old", "new"] as const).map((role) => {
                const document = documentsByRole[role];
                const pageLines = role === "old" ? oldLines : newLines;
                const txtUrl = role === "old" ? oldTxtUrl : newTxtUrl;
                const markdownUrl = role === "old" ? oldMarkdownUrl : newMarkdownUrl;
                const documentOutputsForRole = role === "old" ? oldOutputs : newOutputs;

                return (
                  <Card key={role} className="border-slate-200 bg-white/80">
                    <CardHeader>
                      <CardTitle className="text-lg capitalize">{role} document extracted text preview</CardTitle>
                      <CardDescription>{document?.file_name ?? "No document uploaded"}</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-wide text-slate-500">
                        <span>Status</span>
                        <Badge variant={badgeVariant(document?.status ?? "uploaded")}>
                          {document?.status ?? "uploaded"}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {txtUrl ? (
                          <Button asChild size="sm" variant="secondary">
                            <a href={txtUrl} target="_blank" rel="noreferrer">
                              Download TXT
                            </a>
                          </Button>
                        ) : null}
                        {markdownUrl ? (
                          <Button asChild size="sm" variant="secondary">
                            <a href={markdownUrl} target="_blank" rel="noreferrer">
                              Download Markdown
                            </a>
                          </Button>
                        ) : null}
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                        {documentOutputsForRole.length === 0 ? (
                          <p className="text-slate-500">No extracted output stored yet.</p>
                        ) : (
                          <div className="space-y-5">
                            {Object.entries(pageLines).map(([pageNumber, lines]) => (
                              <section key={pageNumber} className="space-y-3">
                                <h3 className="font-semibold text-slate-900">Page {pageNumber}</h3>
                                <div className="space-y-2">
                                  {lines.map((line) => (
                                    <p key={line.id} className="leading-6 text-slate-700">
                                      {line.text}
                                    </p>
                                  ))}
                                </div>
                              </section>
                            ))}
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
            <div className="flex flex-wrap gap-3 text-sm text-slate-700">
              <p>
                <span className="text-slate-500">Old document:</span> {oldFileName}
              </p>
              <p>
                <span className="text-slate-500">New document:</span> {newFileName}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
