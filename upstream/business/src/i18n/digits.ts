// Decimal keyboards used by the release languages. Protocols retain ASCII digits.
const zeroes = [
  0x0660, 0x06f0, 0x0966, 0x0be6, 0x0c66, 0x0ce6, 0x0d66, 0x0de6, 0x0e50,
  0xff10,
];
export function normalizeDigits(value: string) {
  return [...value]
    .map((character) => {
      const point = character.codePointAt(0)!;
      const zero = zeroes.find((start) => point >= start && point <= start + 9);
      return zero === undefined ? character : String(point - zero);
    })
    .join("");
}
export function pinInput(value: string) {
  return normalizeDigits(value).replace(/\D/g, "").slice(0, 6);
}
