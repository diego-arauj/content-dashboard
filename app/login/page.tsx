import { Suspense } from "react";
import { LoginForm } from "./login-form";

function LoginFallback() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#F5F5F5] px-6">
      <div className="h-64 w-full max-w-md animate-pulse rounded-xl border border-[#E5E5E5] bg-white" />
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginFallback />}>
      <LoginForm />
    </Suspense>
  );
}
