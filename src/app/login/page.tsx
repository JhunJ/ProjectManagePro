import { LoginForm } from "@/components/login-form";

export const dynamic = "force-dynamic";

interface LoginPageProps {
  searchParams: Promise<{ from?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const from = params?.from ?? "/projects";

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--background)] p-4">
      <LoginForm redirectFrom={from} />
    </div>
  );
}
