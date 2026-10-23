import { getAuth } from "@/lib/auth";

/** Better Auth: /api/auth/sign-in/email, sign-out, list-sessions, change-password… Регистрация отключена */
export const GET = (req: Request) => getAuth().handler(req);
export const POST = (req: Request) => getAuth().handler(req);
