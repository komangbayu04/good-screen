import { NextResponse } from "next/server";

/**
 * TODO(backend): issue a Vercel Blob client-upload token (`handleUpload` from
 * `@vercel/blob/client`) so large raw videos go straight from the browser to
 * storage (function bodies are limited to 4.5 MB). The editor currently plays
 * local object URLs and fills `asset.remoteUrl` once this route exists.
 */
export function POST() {
  return NextResponse.json({ error: "Upload storage not connected yet" }, { status: 501 });
}
