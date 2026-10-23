import { JoinScreen } from "@/components/auth/JoinScreen";

/** /join/<код>: без входа proxy.ts уводит на /login?next=… (оттуда — регистрация по этому приглашению) */
export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  return <JoinScreen code={(await params).code} />;
}
