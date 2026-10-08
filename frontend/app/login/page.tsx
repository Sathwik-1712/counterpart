import { AuthForm } from "@/components/auth-form";

export const metadata = { title: "Sign in · Counterpart" };

export default function LoginPage() {
  return <AuthForm mode="login" />;
}
