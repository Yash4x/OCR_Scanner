import Link from "next/link";
import { redirect } from "next/navigation";
import { logoutAction } from "@/app/auth/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createClient } from "@/lib/supabase/server";

function formatDate(dateString: string) {
  return new Date(dateString).toLocaleString();
}

function statusVariant(status: string): "success" | "secondary" {
  if (status === "processing") {
    return "secondary";
  }

  if (
    status === "processed" ||
    status === "compared" ||
    status === "summarized" ||
    status === "completed" ||
    status === "uploaded"
  ) {
    return "success";
  }

  return "secondary";
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: comparisons, error } = await supabase
    .from("comparisons")
    .select(
      "id, title, status, created_at, old_document:old_document_id(file_name), new_document:new_document_id(file_name)",
    )
    .order("created_at", { ascending: false });

  const comparisonIds = (comparisons ?? []).map((comparison) => comparison.id);

  const [{ data: changedLines }, { data: summaries }] = comparisonIds.length
    ? await Promise.all([
        supabase
          .from("comparison_lines")
          .select("comparison_id")
          .in("comparison_id", comparisonIds)
          .neq("change_type", "unchanged"),
        supabase
          .from("comparison_summaries")
          .select("comparison_id, risk_level")
          .in("comparison_id", comparisonIds),
      ])
    : [{ data: [] as Array<{ comparison_id: string }> }, { data: [] as Array<{ comparison_id: string; risk_level: string | null }> }];

  const changeCountByComparisonId = (changedLines ?? []).reduce<Record<string, number>>((result, row) => {
    result[row.comparison_id] = (result[row.comparison_id] ?? 0) + 1;
    return result;
  }, {});

  const riskByComparisonId = (summaries ?? []).reduce<Record<string, string | null>>((result, row) => {
    result[row.comparison_id] = row.risk_level;
    return result;
  }, {});

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Dashboard</h1>
            <p className="text-slate-600">Track your uploaded document comparisons.</p>
          </div>
          <div className="flex gap-2">
            <Button asChild>
              <Link href="/compare/new">New Comparison</Link>
            </Button>
            <form action={logoutAction}>
              <Button type="submit" variant="outline">
                Log out
              </Button>
            </form>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Comparison History</CardTitle>
            <CardDescription>Your recent comparison jobs appear here.</CardDescription>
          </CardHeader>
          <CardContent>
            {error ? (
              <p className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                Failed to load comparisons: {error.message}
              </p>
            ) : null}

            {!error && (!comparisons || comparisons.length === 0) ? (
              <div className="rounded-lg border border-dashed border-slate-300 p-10 text-center">
                <p className="text-lg font-medium text-slate-800">No comparisons yet</p>
                <p className="mt-1 text-sm text-slate-600">
                  Create your first comparison to start building document history.
                </p>
                <Button className="mt-4" asChild>
                  <Link href="/compare/new">New Comparison</Link>
                </Button>
              </div>
            ) : null}

            {!error && comparisons && comparisons.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Changes</TableHead>
                    <TableHead>Risk</TableHead>
                    <TableHead>Old Document</TableHead>
                    <TableHead>New Document</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Open</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {comparisons.map((comparison) => {
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
                      <TableRow key={comparison.id}>
                        <TableCell className="font-medium">{comparison.title}</TableCell>
                        <TableCell>
                          <Badge variant={statusVariant(comparison.status)}>{comparison.status}</Badge>
                        </TableCell>
                        <TableCell>{changeCountByComparisonId[comparison.id] ?? 0}</TableCell>
                        <TableCell>
                          {riskByComparisonId[comparison.id] ? (
                            <Badge
                              variant={
                                riskByComparisonId[comparison.id] === "high"
                                  ? "destructive"
                                  : riskByComparisonId[comparison.id] === "medium"
                                    ? "warning"
                                    : "secondary"
                              }
                            >
                              {riskByComparisonId[comparison.id]}
                            </Badge>
                          ) : (
                            "-"
                          )}
                        </TableCell>
                        <TableCell>{oldFileName}</TableCell>
                        <TableCell>{newFileName}</TableCell>
                        <TableCell>{formatDate(comparison.created_at)}</TableCell>
                        <TableCell className="text-right">
                          <Button asChild size="sm" variant="secondary">
                            <Link href={`/compare/${comparison.id}`}>View</Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
