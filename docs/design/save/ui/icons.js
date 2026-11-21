// Original compact stroke icons; no external font, asset library or network
// dependency. Two glyphs are supplied artwork from the owner, kept in
// ui/icons/ and used inline below; see docs/design/ASSETS.md for attribution.
const supplied = {
  // print.svg — Flaticon "icon font" print glyph, viewBox 0 0 24 24.
  printer: {
    viewBox: '0 0 24 24',
    body: '<path d="M19,6V4a4,4,0,0,0-4-4H9A4,4,0,0,0,5,4V6a5.006,5.006,0,0,0-5,5v5a5.006,5.006,0,0,0,5,5,3,3,0,0,0,3,3h8a3,3,0,0,0,3-3,5.006,5.006,0,0,0,5-5V11A5.006,5.006,0,0,0,19,6ZM7,4A2,2,0,0,1,9,2h6a2,2,0,0,1,2,2V6H7ZM17,21a1,1,0,0,1-1,1H8a1,1,0,0,1-1-1V17a1,1,0,0,1,1-1h8a1,1,0,0,1,1,1Zm5-5a3,3,0,0,1-3,3V17a3,3,0,0,0-3-3H8a3,3,0,0,0-3,3v2a3,3,0,0,1-3-3V11A3,3,0,0,1,5,8H19a3,3,0,0,1,3,3Z"/><path d="M18,10H16a1,1,0,0,0,0,2h2a1,1,0,0,0,0-2Z"/>'
  },
  // menu-dots-vertical.svg — Flaticon "icon font" vertical kebab, viewBox 0 0 512 512.
  more: {
    viewBox: '0 0 512 512',
    body: '<circle cx="256" cy="53.333" r="53.333"/><circle cx="256" cy="256" r="53.333"/><circle cx="256" cy="458.667" r="53.333"/>'
  }
};
const paths={'arrow-left':'M20 12H4m7-7-7 7 7 7','arrow-right':'M4 12h16m-7-7 7 7-7 7',accounting:'M5 3h14v18H5zM9 7h6M9 11h6M9 15h2M14 15h1',banking:'m3 9 9-6 9 6M3 10h18M5 10v10M10 10v10M15 10v10M20 10v10M3 21h18',payments:'M3 7h17m-4-4 4 4-4 4M21 17H4m4-4-4 4 4 4',sales:'M5 19 19 5M5 5h14v14',purchases:'M5 5l14 14M5 19h14V5',tax:'M6 18 18 6M7 5a2 2 0 1 0 0 4 2 2 0 0 0 0-4M17 15a2 2 0 1 0 0 4 2 2 0 0 0 0-4',inventory:'m3 7 9-4 9 4-9 4-9-4M3 7v10l9 4 9-4V7M12 11v10',manufacturing:'M3 21V9l6 4V7l6 4V3h5v18H3M7 17h2M13 17h2',pos:'M4 4h16v12H4zM9 20h6M12 16v4M8 8h8M8 12h3',assets:'M3 7h18v14H3zM8 7V3h8v4M3 13h18',people:'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M2 21v-3a7 7 0 0 1 14 0v3M17 4a4 4 0 0 1 0 7M18 14a5 5 0 0 1 4 5v2',projects:'M3 5h7l2 3h9v13H3zM7 12h10M7 16h6',finance:'M3 20h18M5 16l5-5 4 3 6-9M15 5h5v5',reports:'M5 20V9h3v11M11 20V4h3v16M17 20v-8h3v8',drive:'M3 6h7l2 3h9v12H3z',apps:'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM17 14v7M14 17h7',assistant:'m12 3 3 6 6 3-6 3-3 6-3-6-6-3 6-3z',settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2',admin:'m12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6zM9 12l2 2 4-5',offline:'M4 8h16M16 4l4 4-4 4M20 16H4M8 12l-4 4 4 4',design:'M4 4h16v16H4zM4 10h16M10 10v10',home:'m3 10 9-7 9 7M5 9v12h14V9M9 21v-7h6v7',search:'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14m5 12 6 6',chevron:'m6 9 6 6 6-6',close:'m6 6 12 12M6 18 18 6',menu:'M4 5h16M4 12h16M4 19h16',theme:'M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11'};
export const icon=name=>{
  const art=supplied[name];
  if(art)return `<svg class="ui-icon" viewBox="${art.viewBox}" fill="currentColor" aria-hidden="true">${art.body}</svg>`;
  return `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name]??paths.design}"/></svg>`;
};
