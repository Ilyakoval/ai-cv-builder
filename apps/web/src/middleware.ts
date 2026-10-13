import { NextResponse, type NextRequest } from 'next/server';

/** Cheap presence check only; the API is the real authority on the session. */
export function middleware(req: NextRequest) {
  if (!req.cookies.has('cvb_session')) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = `?next=${encodeURIComponent(req.nextUrl.pathname)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ['/', '/cvs/:path*'] };
