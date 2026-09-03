function srgbToLinear(c: number): number {
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance of an RGB color, each channel 0–255. */
export function luminanceRgb(r: number, g: number, b: number): number {
  return 0.2126 * srgbToLinear(r / 255) + 0.7152 * srgbToLinear(g / 255) + 0.0722 * srgbToLinear(b / 255);
}

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Relative luminance of a hex color like "#2e3436" or "#fff", or null for anything else. */
export function luminanceHex(hex: string): number | null {
  const m = HEX_RE.exec(hex.trim());
  if (!m) return null;
  let h = m[1]!;
  if (h.length === 3) h = h.split("").map(ch => ch + ch).join("");
  return luminanceRgb(parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16));
}