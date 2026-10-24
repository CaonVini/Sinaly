import { NextResponse, type NextRequest } from "next/server";

// Barreira de navegação: sem cookie de sessão vai para o login. A validação real é sempre da API.
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const hasSession = req.cookies.has("sn_rt") || req.cookies.has("sn_at");
  if (!hasSession && !pathname.startsWith("/login")) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  if (hasSession && pathname.startsWith("/login")) {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!api/|_next/|icon.svg|favicon.ico).*)"] };
