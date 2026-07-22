import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { isPublicPath, requiredRolesForPath, isAllowed } from "./lib/route-guards";

/*
 * Root middleware — the front door. It runs on the Edge runtime, so it cannot
 * touch Postgres; it verifies the cookie JWT (signature + expiry only) as a
 * cheap first gate and stamps security headers on every response. The
 * authoritative session check — revocation and live is_active — happens in
 * lib/auth.getSession() on the Node side, which every protected page and API
 * already calls. So a revoked-but-unexpired token can pass here but is still
 * rejected at the page, which redirects to /login.
 */

const COOKIE_NAME = "close_session";

function secretKey() {
  const s = process.env.SESSION_SECRET;
  return s && s.length >= 16 ? new TextEncoder().encode(s) : null;
}

async function verifyToken(req) {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  const key = secretKey();
  if (!token || !key) return null;
  try {
    const { payload } = await jwtVerify(token, key);
    return payload;
  } catch {
    return null; // bad signature or expired
  }
}

function withSecurityHeaders(res, dev) {
  // Nothing in the app loads cross-origin scripts, styles, fonts or images
  // (fonts are self-hosted, the grain texture is a data: URI). Inline script
  // (theme bootstrap) and inline style (styled-jsx, design tokens) are part of
  // the current architecture, so script/style keep 'unsafe-inline'; everything
  // else is locked to 'self'. Tightening script-src to nonces is a later step.
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self'${dev ? " ws:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(dev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");

  res.headers.set("Content-Security-Policy", csp);
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  res.headers.set("X-DNS-Prefetch-Control", "off");
  if (!dev) res.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  return res;
}

export async function middleware(req) {
  const dev = process.env.NODE_ENV !== "production";
  const { pathname, search } = req.nextUrl;
  const isApi = pathname.startsWith("/api/");

  // Public routes skip the auth gate but still get the headers.
  if (isPublicPath(pathname)) {
    return withSecurityHeaders(NextResponse.next(), dev);
  }

  const payload = await verifyToken(req);

  // No valid token: API callers get JSON 401, page requests go to /login with
  // the intended destination preserved.
  if (!payload) {
    if (isApi) {
      return withSecurityHeaders(NextResponse.json({ error: "Not signed in" }, { status: 401 }), dev);
    }
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
    return withSecurityHeaders(NextResponse.redirect(url), dev);
  }

  // Role gating (held OFF until the first non-finance user — see route-guards).
  const need = requiredRolesForPath(pathname);
  if (need && !isAllowed(payload.roles, need)) {
    if (isApi) {
      return withSecurityHeaders(NextResponse.json({ error: "You do not have access to this area" }, { status: 403 }), dev);
    }
    const url = req.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return withSecurityHeaders(NextResponse.redirect(url), dev);
  }

  return withSecurityHeaders(NextResponse.next(), dev);
}

export const config = {
  // Run on everything except Next internals and static asset routes.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|fonts/|robots.txt|sitemap.xml|manifest.webmanifest).*)"],
};
