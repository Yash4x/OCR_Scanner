import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ocrPageImage, loadImagePage } from "@/lib/document-processing";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const comparisonId = url.searchParams.get("comparisonId");
    const role = (url.searchParams.get("role") ?? "old") as "old" | "new";
    const pageNumber = Number(url.searchParams.get("pageNumber") ?? "1");

    if (!comparisonId) {
      return NextResponse.json({ error: "comparisonId is required" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: documents } = await supabase
      .from("documents")
      .select("id, document_role, storage_path")
      .eq("comparison_id", comparisonId)
      .eq("user_id", user.id);

    const doc = (documents ?? []).find((d) => d.document_role === role);

    if (!doc) {
      return NextResponse.json({ error: `Document not found for role=${role}` }, { status: 404 });
    }

    // find stored page image path
    const { data: pageRows } = await supabase.from("document_pages").select("image_storage_path").eq("document_id", doc.id).eq("page_number", pageNumber).limit(1).single();

    const imagePath = pageRows?.image_storage_path ?? null;
    if (!imagePath) {
      return NextResponse.json({ error: "Page image not found. Ensure pages were rendered and uploaded." }, { status: 404 });
    }

    const { data, error } = await supabase.storage.from("extracted-text").download(imagePath);
    if (error || !data) {
      return NextResponse.json({ error: error?.message ?? "Failed to download page image" }, { status: 500 });
    }

    const buf = Buffer.from(await data.arrayBuffer());
    const page = await loadImagePage(buf, "image/png");

    const parsed = await ocrPageImage(page);

    return NextResponse.json({ error: null, parsed });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
