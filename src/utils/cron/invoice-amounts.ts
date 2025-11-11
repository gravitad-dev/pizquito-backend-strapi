export interface InvoiceAmount {
  concept: string;
  amount: number;
  description?: string;
}

// Accepts various input shapes (array of objects, plain object map, or null)
// Returns a sanitized array of {concept, amount, description?} or null when no valid items
export function normalizeInvoiceAmounts(input: any): InvoiceAmount[] | null {
  const addItem = (
    acc: Map<string, InvoiceAmount>,
    conceptRaw: any,
    amountRaw: any,
    description?: any,
  ) => {
    const concept = String(conceptRaw || "").trim();
    const amount =
      typeof amountRaw === "number" ? amountRaw : Number(amountRaw);

    // Validations
    if (!concept) return acc; // concept cannot be empty
    if (!Number.isFinite(amount) || amount < 0) return acc; // amount must be >= 0

    const key = concept.toLowerCase();
    const existing = acc.get(key);
    if (existing) {
      // Detect duplicates case-insensitive, sum amounts
      existing.amount += amount;
      if (!existing.description && description) {
        existing.description = String(description);
      }
    } else {
      acc.set(key, {
        concept,
        amount,
        description: description ? String(description) : undefined,
      });
    }
    return acc;
  };

  const accumulator = new Map<string, InvoiceAmount>();

  if (!input) {
    // null or undefined
  } else if (Array.isArray(input)) {
    for (const item of input) {
      if (!item || typeof item !== "object") continue;
      addItem(accumulator, item.concept, item.amount, item.description);
    }
  } else if (typeof input === "object") {
    // Plain object map: { concept: amount }
    for (const [key, value] of Object.entries(input)) {
      addItem(accumulator, key, value);
    }
  } else {
    // Unsupported shape, ignore
  }

  if (accumulator.size === 0) return null; // If no valid concepts, send null
  return Array.from(accumulator.values());
}

// Helper to compute subtotal from normalized amounts
export function subtotalFromAmounts(
  amounts: InvoiceAmount[] | null | undefined,
): number {
  if (!amounts || !Array.isArray(amounts)) return 0;
  return amounts.reduce(
    (sum, a) => sum + (Number.isFinite(a.amount) ? a.amount : 0),
    0,
  );
}
