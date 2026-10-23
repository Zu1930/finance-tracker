import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";
import { Welcome } from "@/components/welcome/Welcome";

export const dynamic = "force-dynamic";

/** Опрос-настройка после подтверждения email: пока статус pending, приложение ведёт сюда (components/Shell.tsx) */
export default async function Page() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  return <Welcome userId={session.user.id} />;
}
