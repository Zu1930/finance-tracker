export const dynamic = "force-dynamic";
import { ForgotForm } from "@/components/auth/AuthForms";

export default function Page() {
  return <ForgotForm siteKey={process.env.TURNSTILE_SITE_KEY} />;
}
