// A number between 0 and 1 that stays the same for the same `i`, so the
// parts are scattered the same way every time the piece is drawn.
export function scatter(i: number, salt = 0) {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453
  return x - Math.floor(x)
}
