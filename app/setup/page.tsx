import { count } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { users } from "@/db/schema";
import { SetupForm } from "./setup-form";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const [{ c }] = await db.select({ c: count() }).from(users);
  if (c > 0) {
    redirect("/login");
  }

  return <SetupForm />;
}
