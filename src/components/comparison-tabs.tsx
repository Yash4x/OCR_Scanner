import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ComparisonTab = "summary" | "text-diff" | "paper-view" | "files";

const tabs: Array<{ key: ComparisonTab; label: string; href: (comparisonId: string) => string }> = [
  { key: "summary", label: "Summary", href: (comparisonId) => `/compare/${comparisonId}#summary` },
  { key: "text-diff", label: "Text Diff", href: (comparisonId) => `/compare/${comparisonId}#text-diff` },
  { key: "paper-view", label: "Scanned Paper View", href: (comparisonId) => `/compare/${comparisonId}/paper-view` },
  { key: "files", label: "Files", href: (comparisonId) => `/compare/${comparisonId}#files` },
];

export function ComparisonTabs({ comparisonId, activeTab }: { comparisonId: string; activeTab: ComparisonTab }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white/90 p-2 shadow-sm">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {tabs.map((tab) => (
          <Button
            asChild
            key={tab.key}
            variant={activeTab === tab.key ? "default" : "outline"}
            className={cn("justify-center", activeTab === tab.key ? "shadow-sm" : "")}
          >
            <Link href={tab.href(comparisonId)}>{tab.label}</Link>
          </Button>
        ))}
      </div>
    </div>
  );
}
