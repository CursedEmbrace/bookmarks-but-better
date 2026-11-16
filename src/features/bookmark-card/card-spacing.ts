/**
 * Folder card spacing by nesting depth, in one place. Deeper cards use less
 * padding so nested folders don't stack up thick empty frames; a top-level
 * card keeps the original roomy spacing. Values are theme spacing units
 * (`var(--spacing)`, 4px at the default theme), so they follow the theme.
 *
 * Provisional, tuned by eye against Jaime's own nested folders.
 */
export interface CardSpacing {
  /** Padding on every side of the card. */
  padding: number
  /** Gap between the header and the body, and between body sections. */
  bodyGap: number
  /** Gap between sibling subfolder cards. */
  subfolderGap: number
}

const SPACING_BY_DEPTH: readonly CardSpacing[] = [
  { padding: 4, bodyGap: 3, subfolderGap: 3 },
  { padding: 3, bodyGap: 2, subfolderGap: 2 },
  { padding: 2.5, bodyGap: 2, subfolderGap: 2 },
]

/** Depth 0 is a top-level card; anything deeper than the table uses its last row. */
export function cardSpacing(depth: number): CardSpacing {
  return SPACING_BY_DEPTH[
    Math.min(Math.max(0, depth), SPACING_BY_DEPTH.length - 1)
  ]
}

/** A spacing value as CSS, following the theme's spacing token. */
export function spacingCss(units: number): string {
  return `calc(var(--spacing) * ${units})`
}
