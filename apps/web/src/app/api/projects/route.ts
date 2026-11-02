import { NextResponse } from "next/server";

/** TODO(backend): persist projects (Postgres + Drizzle). The editor keeps projects in memory for now. */
export function GET() {
  return NextResponse.json({ error: "Project storage not connected yet" }, { status: 501 });
}
export const POST = GET;
