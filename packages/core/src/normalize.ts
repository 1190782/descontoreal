const MAX_SLUG_LENGTH = 80;
// Samsung EU codes end in a tuner/region tail such as "TXXC" or "XXU".
const REGION_TAIL = /T?XX[A-Z]$/;
const MIN_MODEL_LENGTH_AFTER_TAIL = 7;
// A color or market variant after the last "/" or "." ("/S3", ".AEU", "/A"). Digit-only parts stay,
// because brands such as De'Longhi put the model number there ("ECAM22.110.B" ≠ "ECAM22.360.S").
const VARIANT_SUFFIX = /[/.]\s*(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{1,4}\s*$/;

function stripAccents(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "");
}

/** Lowercase, accents removed, only letters and digits ("Bosch" → "bosch", "De'Longhi" → "delonghi"). */
export function normalizeBrand(brand: string | null | undefined): string | null {
  if (!brand) {
    return null;
  }
  const normalized = stripAccents(brand)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return normalized || null;
}

/**
 * Model code for matching across stores: uppercase, without spaces, hyphens, dots or slashes,
 * and without color or region suffixes ("WW90T534DAE/S3" → "WW90T534DAE",
 * "OLED55C46LA.AEU" → "OLED55C46LA", "QE55Q67RATXXC" → "QE55Q67RA", "ECAM22.110.B" → "ECAM22110").
 * Conservative: when unsure it keeps characters, so different models never collapse into one code.
 * Returns null when empty.
 */
export function normalizeModel(model: string | null | undefined): string | null {
  if (!model) {
    return null;
  }
  const base = model.trim().replace(VARIANT_SUFFIX, "");
  const compact = stripAccents(base)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  const withoutTail = compact.replace(REGION_TAIL, "");
  const normalized = withoutTail.length >= MIN_MODEL_LENGTH_AFTER_TAIL ? withoutTail : compact;
  return normalized || null;
}

/** URL slug: lowercase, accents removed, hyphen-separated ("Máquina de Lavar" → "maquina-de-lavar"). */
export function slugify(text: string): string {
  return stripAccents(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Product slug base "{marca}-{modelo}-{tipo}", e.g.
 * { brand: "Samsung", model: "WW90T534DAE", categorySingular: "máquina de lavar roupa" }
 * → "samsung-ww90t534dae-maquina-de-lavar-roupa". Falls back to the product name when brand or
 * model are missing. The database appends "-2", "-3"… on collision.
 */
export function productSlugBase(input: {
  brand: string | null;
  model: string | null;
  name: string;
  categorySingular: string | null;
}): string {
  const source =
    input.brand && input.model ? `${input.brand} ${input.model} ${input.categorySingular ?? ""}` : input.name;
  const words: string[] = [];
  let length = 0;
  for (const word of slugify(source).split("-")) {
    // Skips "samsung-samsung-…" when the model already starts with the brand.
    if (!word || words[words.length - 1] === word) {
      continue;
    }
    const separator = words.length > 0 ? 1 : 0;
    if (length + separator + word.length > MAX_SLUG_LENGTH) {
      break;
    }
    length += separator + word.length;
    words.push(word);
  }
  return words.join("-") || "produto";
}
