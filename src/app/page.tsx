import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-slate-950 px-4 py-16 text-slate-100 sm:px-6 lg:px-8">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top_left,_#1e293b,_transparent_55%),radial-gradient(circle_at_80%_20%,_#334155,_transparent_35%),linear-gradient(120deg,_#020617,_#0f172a)]" />
      <div className="mx-auto flex max-w-5xl flex-col items-start justify-center gap-8">
        <p className="rounded-full border border-slate-700 bg-slate-900/80 px-4 py-1 text-xs uppercase tracking-[0.2em] text-slate-300">
          DocumentDiff AI
        </p>
        <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
          Compare scanned documents with AI.
        </h1>
        <p className="max-w-3xl text-base text-slate-300 sm:text-lg">
          Upload two versions of a document, recreate the text, highlight every change, and
          understand what changed in plain English.
        </p>
        <Button asChild size="lg" className="bg-white text-slate-900 hover:bg-slate-200">
          <Link href="/signup">Get Started</Link>
        </Button>
      </div>
    </main>
  );
}
