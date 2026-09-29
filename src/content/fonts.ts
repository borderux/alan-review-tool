// The Recursica theme names two typefaces (Dongle for headings, Nunito
// Sans for everything else) and every one must load, or the browser
// silently substitutes a default face.
//
// They ship inside content.js rather than being fetched: a Google Fonts
// request would go out from every site a reviewer visits, and a host
// page's Content-Security-Policy can block it. Chrome also ignores
// @font-face rules declared inside a shadow root, so the faces are added
// to the host document's FontFaceSet - the panel's shadow tree resolves
// fonts from there. Built from bytes, not from a URL, so no page's
// font-src policy applies. This is the panel's one global side effect.
import dongle400 from "@fontsource/dongle/files/dongle-latin-400-normal.woff2";
import dongle700 from "@fontsource/dongle/files/dongle-latin-700-normal.woff2";
import nunitoSans from "@fontsource-variable/nunito-sans/files/nunito-sans-latin-wght-normal.woff2";

const FACES: { family: string; dataUrl: string; weight: string }[] = [
  { family: "Dongle", dataUrl: dongle400, weight: "400" },
  { family: "Dongle", dataUrl: dongle700, weight: "700" },
  { family: "Nunito Sans", dataUrl: nunitoSans, weight: "200 1000" },
];

// Faces added to document.fonts outlive this script instance, so the
// flag lives on the DOM, not in a closure (a fresh injection runs on every
// toolbar click).
const REGISTERED_FLAG = "taggerFonts";

function dataUrlToBytes(dataUrl: string): Uint8Array<ArrayBuffer> {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function registerFonts(): void {
  const html = document.documentElement;
  if (html.dataset[REGISTERED_FLAG]) return;
  if (typeof FontFace === "undefined" || !document.fonts) return;
  for (const { family, dataUrl, weight } of FACES) {
    try {
      const face = new FontFace(family, dataUrlToBytes(dataUrl), {
        weight,
        style: "normal",
        display: "swap",
      });
      document.fonts.add(face);
    } catch (err) {
      console.error(`Tagger: could not load ${family}.`, err);
    }
  }
  html.dataset[REGISTERED_FLAG] = "1";
}
