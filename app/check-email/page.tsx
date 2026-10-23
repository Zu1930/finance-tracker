import { CheckEmail } from "@/components/auth/AuthForms";

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function Page({ searchParams }: { searchParams: Search }) {
  const q = await searchParams;
  return <CheckEmail email={typeof q.email === "string" ? q.email : ""} invite={typeof q.invite === "string" ? q.invite : undefined} />;
}
