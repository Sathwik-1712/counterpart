import { AuthForm } from "@/components/auth-form";

export const metadata = { title: "Create your account · Counterpart" };

export default function SignupPage() {
  return <AuthForm mode="signup" />;
}
