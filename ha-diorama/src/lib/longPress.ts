// How long a press is held still before it is a long press, everywhere in
// the card. Half a second is what iOS waits by default. Android waits a
// little less and raises a context menu when it is done, which the card
// takes as the long press too, so there it follows the phone's own setting.
export const LONG_PRESS_MS = 500

// When a press last turned into something of its own while it was held,
// like dragging a blind or a slider. A long press never comes after that in
// the same press, however still the finger is left once it has done it.
let claimedAt = -Infinity

export function claim() {
  claimedAt = performance.now()
}

// Whether a press that went down at the moment given has since been taken
// by something else.
export const claimedSince = (at: number) => claimedAt >= at
