import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & {
      id: string;
      clientId: string | null;
      role: "admin" | "client";
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    clientId: string | null;
    role: "admin" | "client";
  }
}
