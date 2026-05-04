import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateComparisonSpans, getComparisonPipelineHealth } from "@/lib/comparison-spans";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const comparisonId = url.searchParams.get("comparisonId");

    if (!comparisonId) {
      return NextResponse.json({ error: "comparisonId query param is required" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const health = await getComparisonPipelineHealth({ supabase, comparisonId, userId: user.id });

    const { spans, diagnostics, stats, changedLineCount } = await generateComparisonSpans({
      supabase,
      comparisonId,
      userId: user.id,
    });

    return NextResponse.json({ error: null, health, spansCount: spans.length, diagnostics, stats, changedLineCount });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
