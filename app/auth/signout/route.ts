import { NextResponse } from "next/server";
import { signOut } from "@/auth";

export async function POST(request: Request) {
  await signOut({ redirect: false });

  const url = new URL("/login", request.url);
  return NextResponse.redirect(url);
}
