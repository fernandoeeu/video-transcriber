import { readFileSync } from "node:fs";

const minimumContrast = 4.5;
const tintOpacity = 0.12;
const css = readFileSync(new URL("../src/styles/globals.css", import.meta.url), "utf8");
const lightTheme = css.match(/:root\s*{(?<tokens>[\s\S]*?)}/)?.groups?.tokens;

if (!lightTheme) throw new Error("Could not find the light theme tokens in globals.css");

function readToken(name) {
  const value = lightTheme.match(
    new RegExp(`--${name}:\\s*oklch\\((?<l>[\\d.]+)\\s+(?<c>[\\d.]+)\\s+(?<h>[\\d.]+)\\)`),
  )?.groups;

  if (!value) throw new Error(`Could not parse --${name} from globals.css`);

  return [Number(value.l), Number(value.c), Number(value.h)];
}

// WCAG 2.x relative luminance after OKLCH -> linear sRGB conversion.
// Out-of-gamut channels are clipped; the token margin keeps each result above 4.5:1.
function relativeLuminance([lightness, chroma, hue]) {
  const radians = (hue * Math.PI) / 180;
  const a = chroma * Math.cos(radians);
  const b = chroma * Math.sin(radians);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const channels = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((channel) => Math.max(0, Math.min(1, channel)));

  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(first, second) {
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

function composite(foreground, background, opacity) {
  return foreground * opacity + background * (1 - opacity);
}

const card = relativeLuminance(readToken("card"));

for (const name of ["success", "warning", "destructive"]) {
  const status = relativeLuminance(readToken(name));
  const ratios = {
    card: contrastRatio(status, card),
    tint: contrastRatio(status, composite(status, card, tintOpacity)),
  };

  for (const [surface, ratio] of Object.entries(ratios)) {
    if (ratio < minimumContrast) {
      throw new Error(`${name} on ${surface} is ${ratio.toFixed(2)}:1; expected 4.5:1 or higher`);
    }
  }

  console.log(`${name}: card ${ratios.card.toFixed(2)}:1, tint ${ratios.tint.toFixed(2)}:1`);
}
