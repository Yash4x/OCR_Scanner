import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

function formatDate(dateString: string) {
  return new Date(dateString).toLocaleString();
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
    .select(
      "id, title, status, created_at, old_document:old_document_id(file_name), new_document:new_document_id(file_name)",
    )
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    notFound();
  }

  if (!comparison) {
    notFound();
  }

  const oldFileName =
    comparison.old_document &&
    typeof comparison.old_document === "object" &&
    "file_name" in comparison.old_document
      ? String(comparison.old_document.file_name)
      : "-";

  const newFileName =
    comparison.new_document &&
    typeof comparison.new_document === "object" &&
    "file_name" in comparison.new_document
      ? String(comparison.new_document.file_name)
      : "-";

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-3xl space-y-4">
        <Button asChild variant="ghost" size="sm">
          <Link href="/dashboard">Back to dashboard</Link>
        </Button>

        <Card>
          <CardHeader>
            <CardTitle>{comparison.title}</CardTitle>
            <CardDescription>Comparison detail</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-slate-700">
            <div className="flex items-center gap-2">
              <span className="text-slate-500">Status:</span>
              <Badge variant="success">{comparison.status}</Badge>
            </div>
            <p>
              <span className="text-slate-500">Old document:</span> {oldFileName}
            </p>
            <p>
              <span className="text-slate-500">New document:</span> {newFileName}
            </p>
            <p>
              <span className="text-slate-500">Uploaded at:</span> {formatDate(comparison.created_at)}
            </p>
            <div className="rounded-md border border-slate-200 bg-slate-100 p-4 text-slate-700">
              Processing will be added in Phase 2.
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
