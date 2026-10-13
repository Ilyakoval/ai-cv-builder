import type { NextRequest } from 'next/server';

/**
 * Same-origin proxy to the Nest API. The browser only ever talks to the web
 * origin, so the session cookie can be httpOnly + SameSite=Lax without CORS,
 * and API_URL is read at runtime (not baked into the build).
 */
const API_URL = process.env.API_URL ?? 'http://localhost:3001';

const FORWARD_REQUEST_HEADERS = ['content-type', 'cookie', 'accept', 'user-agent'];
const FORWARD_RESPONSE_HEADERS = ['content-type', 'content-disposition', 'cache-control', 'retry-after', 'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset'];

export const dynamic = 'force-dynamic';

async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const target = new URL(`/api/${path.map(encodeURIComponent).join('/')}`, API_URL);
  target.search = req.nextUrl.search;

  const headers = new Headers();
  for (const name of FORWARD_REQUEST_HEADERS) {
    const value = req.headers.get(name);
    if (value) headers.set(name, value);
  }
  const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? req.headers.get('x-real-ip');
  if (clientIp) headers.set('x-forwarded-for', clientIp);

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : req.body,
      // Required to stream a request body (multipart uploads) with undici.
      duplex: 'half',
      redirect: 'manual',
      cache: 'no-store',
    } as RequestInit & { duplex: 'half' });
  } catch {
    return Response.json(
      { statusCode: 502, error: 'BadGateway', message: 'The server is unavailable. Please try again shortly.' },
      { status: 502 },
    );
  }

  const resHeaders = new Headers();
  for (const name of FORWARD_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) resHeaders.set(name, value);
  }
  for (const cookie of upstream.headers.getSetCookie()) resHeaders.append('set-cookie', cookie);

  return new Response(upstream.body, { status: upstream.status, headers: resHeaders });
}

export { proxy as GET, proxy as POST, proxy as PUT, proxy as PATCH, proxy as DELETE };
