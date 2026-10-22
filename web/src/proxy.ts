import { NextResponse, type NextRequest } from "next/server";

/**
 * Forwards /api/* to the FastAPI service, so the browser talks to one origin and the session
 * cookie needs no CORS. API_ORIGIN is read per request, so one image serves every environment
 * (spec v3 D25): the API's Cloud Run URL in the cloud, localhost:8001 without Docker.
 *
 * When a person opens an API address in the address bar (a document navigation, not a fetch from
 * the app), a refusal is shown as a page instead of raw JSON.
 */
export async function proxy(request: NextRequest) {
  const origin = process.env.API_ORIGIN ?? "http://localhost:8001";
  const target = new URL(request.nextUrl.pathname + request.nextUrl.search, origin);

  if (request.method === "GET" && request.headers.get("sec-fetch-dest") === "document") {
    const upstream = await fetch(target, { headers: { cookie: request.headers.get("cookie") ?? "" }, redirect: "manual" });
    if (upstream.status === 401) {
      return NextResponse.redirect(new URL(`/sign-in?next=${encodeURIComponent(request.nextUrl.pathname)}`, request.url));
    }
    if (upstream.status === 403 || upstream.status === 404) {
      return NextResponse.rewrite(new URL(`/problem?status=${upstream.status}`, request.url));
    }
  }
  return NextResponse.rewrite(target);
}

export const config = {
  matcher: "/api/:path*",
};
