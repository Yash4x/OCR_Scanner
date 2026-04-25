import Link from "next/link";
import { LoginForm } from "@/components/login-form";

export default function LoginPage() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_#e2e8f0,_#f8fafc_50%,_#ffffff)] px-4 py-12">
      <div className="mx-auto max-w-md">
        <LoginForm />
        <p className="mt-6 text-center text-sm text-slate-600">
          No account yet?{" "}
          <Link href="/signup" className="font-medium text-slate-900 underline-offset-4 hover:underline">
            Create one
          </Link>
        </p>
      </div>
    </main>
  );
}
