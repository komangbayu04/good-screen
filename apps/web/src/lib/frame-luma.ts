/**
 * Brightness of a VideoFrame, one byte per pixel, read from the GPU in one go (each read
 * costs a fixed sync, so reading small pieces separately is far slower). Screen frames are
 * usually NV12/I420, whose first plane already is the brightness.
 */
export async function frameLuma(frame: VideoFrame, scratch: { buf: Uint8Array; luma: Uint8Array }) {
  // The visible part, not the display size: tab and window captures often come padded (a
  // coded size larger than the picture) or with a display size that differs from it, and a
  // rect past the coded size fails to copy (every frame, so no pointer at all).
  const vr = frame.visibleRect ?? { x: 0, y: 0, width: frame.codedWidth, height: frame.codedHeight };
  const w = vr.width;
  const h = vr.height;
  const format = frame.format ?? "";
  const rgb = /^(RGB|BGR)/.test(format);
  let layout: PlaneLayout[];
  let skip = 0;
  try {
    const rect = { x: vr.x, y: vr.y, width: w, height: h };
    const size = frame.allocationSize({ rect });
    if (scratch.buf.length < size) scratch.buf = new Uint8Array(size);
    layout = await frame.copyTo(scratch.buf, { rect });
  } catch {
    // A rect the format can't cut (odd offsets on 4:2:0): copy it all, start at the picture.
    const size = frame.allocationSize();
    if (scratch.buf.length < size) scratch.buf = new Uint8Array(size);
    layout = await frame.copyTo(scratch.buf);
    skip = vr.y * layout[0]!.stride + vr.x * (rgb ? 4 : 1);
  }
  const plane = { offset: layout[0]!.offset + skip, stride: layout[0]!.stride };
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
