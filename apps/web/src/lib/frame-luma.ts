/**
 * Brightness of a VideoFrame, one byte per pixel, read from the GPU in one go (each read
 * costs a fixed sync, so reading small pieces separately is far slower). Screen frames are
 * usually NV12/I420, whose first plane already is the brightness.
 */
export async function frameLuma(frame: VideoFrame, scratch: { buf: Uint8Array; luma: Uint8Array }) {
  const w = frame.displayWidth;
  const h = frame.displayHeight;
  const rect = { x: frame.visibleRect?.x ?? 0, y: frame.visibleRect?.y ?? 0, width: w, height: h };
  const format = frame.format ?? "";
  const rgb = /^(RGB|BGR)/.test(format);
  const size = frame.allocationSize({ rect });
  if (scratch.buf.length < size) scratch.buf = new Uint8Array(size);
  const layout = await frame.copyTo(scratch.buf, { rect });
  const plane = layout[0]!;
  if (!rgb) return { luma: scratch.buf.subarray(plane.offset), stride: plane.stride, w, h };
  // RGBA / RGBX / BGRA / BGRX: weigh the channels (red and blue swap places in BGR).
  if (scratch.luma.length < w * h) scratch.luma = new Uint8Array(w * h);
  const [r, b] = format.startsWith("BGR") ? [2, 0] : [0, 2];
  const src = scratch.buf;
  for (let y = 0; y < h; y++)
    for (let x = 0, i = plane.offset + y * plane.stride, p = y * w; x < w; x++, i += 4, p++)
      scratch.luma[p] = (src[i + r]! * 77 + src[i + 1]! * 150 + src[i + b]! * 29) >> 8;
  return { luma: scratch.luma, stride: w, w, h };
}
