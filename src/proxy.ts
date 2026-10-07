import { NextResponse, type NextRequest } from "next/server";
import { createProxyClient } from "@/lib/supabase/proxy-client";

// Optimistic session check and cookie refresh. This is not the security boundary:
// every data function still calls getUser() inside the Data Access Layer.

const AUTH_PAGES = new Set(["/login", "/register"]);
const PUBLIC_PAGES = new Set(["/", "/login", "/register"]);

function isAuthPage(pathname: string) {
  return AUTH_PAGES.has(pathname);
}

function isPublicPage(pathname: string) {
  return PUBLIC_PAGES.has(pathname);
}

/** Email-confirm and OAuth/PKCE callbacks must run before a session exists. */
function isAuthCallback(pathname: string) {
  return pathname === "/auth/confirm" || pathname.startsWith("/auth/confirm/");
}

function isPublicAsset(pathname: string) {
  return (
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico" ||
    /\.(?:svg|png|jpg|jpeg|gif|webp|ico)$/i.test(pathname)
  );
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isPublicAsset(pathname)) return NextResponse.next({ request });

  const { supabase, response } = createProxyClient(request);

  // If Supabase is not configured yet, send students to sign-in (which explains why).
  if (!supabase) {
    if (isPublicPage(pathname) || isAuthCallback(pathname)) return response;
    if (pathname.startsWith("/api/")) return response;
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  let user = null;
  try {
    const { data, error } = await supabase.auth.getUser();
    if (!error) user = data.user;
  } catch (error) {
    console.error("[proxy] session check:", error instanceof Error ? error.message : "unknown");
  }

  // A sign-in or sign-out action must receive its own response. A redirect here
  // makes the form report "an unexpected response was received from the server."
  const isServerAction = request.headers.has("next-action");

  // API routes return 401 themselves; do not redirect fetch() calls.
  if (pathname.startsWith("/api/") || isServerAction) return response;

  if (!user && !isPublicPage(pathname) && !isAuthCallback(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname + request.nextUrl.search);
    return NextResponse.redirect(url);
  }

  if (user && isAuthPage(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
