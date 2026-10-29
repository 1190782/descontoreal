import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE_OPTIONS, isAdmin, supabaseConfig } from "@/lib/admin";

/**
 * Refreshes the admin's Supabase session, which pages can't write, and sends anyone else to /entrar. It runs only on
 * /admin, so public pages never read cookies and stay cached. A middleware.ts and not Next 16's proxy.ts: OpenNext
 * runs edge middleware, while its support for the Node.js proxy is experimental.
 */
export async function middleware(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });
  // Supabase's no-store headers, for every response that writes the session's cookies.
  const sessionHeaders: Record<string, string> = {};
  const { url, key } = supabaseConfig();
  const supabase = createServerClient(url, key, {
    cookieOptions: AUTH_COOKIE_OPTIONS,
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet, headers) => {
        Object.assign(sessionHeaders, headers);
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        for (const [name, value] of Object.entries(sessionHeaders)) {
          response.headers.set(name, value);
        }
      },
    },
  });
  const { data } = await supabase.auth.getClaims();
  if (isAdmin(data?.claims)) {
    return response;
  }
  const signIn = new URL("/entrar", request.url);
  if (data !== null) {
    signIn.searchParams.set("aviso", "sem-acesso");
  }
  // 303: a Server Action posted with an expired session comes back to /entrar as a GET.
  const redirect = NextResponse.redirect(signIn, 303);
  for (const cookie of response.cookies.getAll()) {
    redirect.cookies.set(cookie);
  }
  for (const [name, value] of Object.entries(sessionHeaders)) {
    redirect.headers.set(name, value);
  }
  return redirect;
}

export const config = {
  matcher: ["/admin/:path*"],
};
