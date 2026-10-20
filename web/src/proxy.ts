import { NextResponse, type NextRequest } from "next/server";

/**
 * Forwards /api/* to the FastAPI service, so the browser talks to one origin and the session
 * cookie needs no CORS. API_ORIGIN is read per request, so one image serves every environment
 * (spec v3 D25): the API's Cloud Run URL in the cloud, localhost:8001 without Docker.
 */
export function proxy(request: NextRequest) {
  const origin = process.env.API_ORIGIN ?? "http://localhost:8001";
  const target = new URL(request.nextUrl.pathname + request.nextUrl.search, origin);
  return NextResponse.rewrite(target);
}

export const config = {
  matcher: "/api/:path*",
};
