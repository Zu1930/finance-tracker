import { ResetForm } from "@/components/auth/AuthForms";

type Search = Promise<Record<string, string | string[] | undefined>>;

/** Сюда ведёт ссылка из письма: Better Auth проверяет её и передаёт ?token= (или ?error=INVALID_TOKEN) */
export default async function Page({ searchParams }: { searchParams: Search }) {
  const q = await searchParams;
  return <ResetForm token={typeof q.token === "string" ? q.token : ""} invalid={!!q.error} />;
}
