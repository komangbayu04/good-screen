import { NextResponse } from "next/server";

/**
 * TODO(backend): start a durable render job (Vercel Workflow) that renders
 * `ReelComposition` from @goodscreen/motion to MP4 with the project JSON as input
 * props, stores the result in Blob, and returns a job id to poll.
 */
export function POST() {
  return NextResponse.json({ error: "Rendering not connected yet" }, { status: 501 });
}
