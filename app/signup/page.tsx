import { SignupForm } from "@/components/auth/AuthForms";
import { registrationMode } from "@/lib/codes";

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

/** Регистрация: ?code= — код закрытой регистрации, ?invite= — код ссылки в семью */
export default async function Page({ searchParams }: { searchParams: Search }) {
  const q = await searchParams;
  return <SignupForm siteKey={process.env.TURNSTILE_SITE_KEY} mode={registrationMode()} invite={one(q.invite)} initialCode={one(q.code)} />;
}
