# Assets and attribution

The interface draws its own icon set (`ui/icons.js`, compact stroke paths). Two
glyphs were supplied by the owner from Flaticon and are kept as source files in
`ui/icons/`, then inlined into `icons.js` so no external request is made.

| File | Used as | Source | Attribution |
|---|---|---|---|
| `ui/icons/print.svg` | journal header, print action | https://www.flaticon.com/free-icon-font/print_3917119 | Flaticon — attribution required by the free licence |
| `ui/icons/menu-dots-vertical.svg` | journal header, overflow menu | https://www.flaticon.com/free-icon-font/menu-dots-vertical_3917764 | Flaticon — attribution required by the free licence |

The paths are rendered with `fill="currentColor"`, so they follow the interface
colour in light and dark themes. They are vector, loaded from the local bundle, and
add no network dependency. If the design is ever published outside this review
build, the Flaticon attribution above must travel with it (or a paid licence must
replace it).
