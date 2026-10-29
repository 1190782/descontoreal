import { writeFile } from "node:fs/promises";
import { ImageResponse } from "next/og";
import { createElement } from "react";

// The favicon's mark: a white tick on indigo. `inset` is the share of the side left around it.
const INDIGO = "#4338ca";
const TICK =
  '<path d="M18 33l9 9 19-20" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>';

interface Icon {
  file: string;
  size: number;
  /** Rounded corners for "any" icons; maskable and Apple icons are cropped by the system. */
  rounded: boolean;
  /** Maskable icons keep the mark inside the central safe zone (80%). */
  inset: number;
}

const ICONS: Icon[] = [
  { file: "icon-192.png", size: 192, rounded: true, inset: 0 },
  { file: "icon-512.png", size: 512, rounded: true, inset: 0 },
  { file: "icon-maskable-512.png", size: 512, rounded: false, inset: 0.2 },
  { file: "apple-touch-icon.png", size: 180, rounded: false, inset: 0.1 },
];

function svg(icon: Icon): string {
  const scale = 1 - icon.inset;
  const offset = (64 * icon.inset) / 2;
  const background = icon.rounded
    ? `<rect width="64" height="64" rx="14" fill="${INDIGO}"/>`
    : `<rect width="64" height="64" fill="${INDIGO}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${background}<g transform="translate(${offset} ${offset}) scale(${scale})">${TICK}</g></svg>`;
}

/** Writes the PNG icons of the web app manifest into public/icons. Run again only when the mark changes. */
async function main(): Promise<void> {
  for (const icon of ICONS) {
    const source = `data:image/svg+xml;base64,${Buffer.from(svg(icon)).toString("base64")}`;
    const image = createElement("img", { src: source, width: icon.size, height: icon.size, alt: "" });
    const response = new ImageResponse(image, { width: icon.size, height: icon.size });
    await writeFile(
      new URL(`../public/icons/${icon.file}`, import.meta.url),
      Buffer.from(await response.arrayBuffer()),
    );
    console.log(`public/icons/${icon.file}`);
  }
}

await main();
