// WCAG 2 contrast between two sRGB colours, each as 0 to 255 channels.

export type Rgb = readonly [number, number, number];

export function luminance([red, green, blue]: Rgb) {
  const linear = (channel: number) => {
    const s = channel / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
}

/** From 1, for two identical colours, to 21, for black against white. */
export function contrast(a: Rgb, b: Rgb) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}
