import Link from "next/link";
import { SignupForm } from "@/components/signup-form";

export default function SignupPage() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_#e2e8f0,_#f8fafc_50%,_#ffffff)] px-4 py-12">
      <div className="mx-auto max-w-md">
        <SignupForm />
        <p className="mt-6 text-center text-sm text-slate-600">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-slate-900 underline-offset-4 hover:underline">
            Log in
          </Link>
        </p>
      </div>
    </main>
  );
}
