import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";

const publicPaths = ["/login", "/convite", "/setup", "/api/auth"];

export async function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname;

  if (publicPaths.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const token = await getToken({ req, secret: process.env.AUTH_SECRET });

  if (!token) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  if (token.role === "client" && token.clientId) {
    const cid = token.clientId as string;
    if (pathname === "/dashboard") {
      return NextResponse.redirect(new URL(`/dashboard/${cid}`, req.url));
    }
    const seg = pathname.match(/^\/dashboard\/([^/]+)/);
    if (seg && seg[1] !== cid) {
      return NextResponse.redirect(new URL(`/dashboard/${cid}`, req.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/convite/:path*"]
};
