// Original, simple emblems for each empire: white shapes on a colored disc.
// Drawn on a 64 x 64 grid. Not based on any copyrighted artwork.
const W = '#fff';

const shapes = {
  // Ottoman: crescent and star
  crescent: `
    <mask id="em-crescent-cut"><rect width="64" height="64" fill="#fff"/><circle cx="37" cy="29" r="13.5" fill="#000"/></mask>
    <circle cx="30" cy="32" r="17" fill="${W}" mask="url(#em-crescent-cut)"/>
    <path d="M46.0 22.5 L47.6 26.8 L52.2 27.0 L48.6 29.8 L49.8 34.3 L46.0 31.7 L42.2 34.3 L43.4 29.8 L39.8 27.0 L44.4 26.8Z" fill="${W}"/>`,
  // Mughal: domed tomb with two minarets
  dome: `
    <rect x="14" y="46" width="36" height="5" rx="1" fill="${W}"/>
    <rect x="22" y="36" width="20" height="10" fill="${W}"/>
    <path d="M32 37 c-1.5-1.9-3-2.6-3-5 h6 c0 2.4-1.5 3.1-3 5z" fill="currentColor" opacity=".35"/>
    <path d="M21 36 C21 26 27 23 32 16 C37 23 43 26 43 36 Z" fill="${W}"/>
    <rect x="31.2" y="9" width="1.6" height="8" fill="${W}"/>
    <circle cx="32" cy="9" r="1.8" fill="${W}"/>
    <rect x="13" y="27" width="4" height="19" fill="${W}"/>
    <rect x="47" y="27" width="4" height="19" fill="${W}"/>
    <circle cx="15" cy="26" r="2.6" fill="${W}"/>
    <circle cx="49" cy="26" r="2.6" fill="${W}"/>`,
  // Ming & Qing: palace hall with upturned roof
  roof: `
    <rect x="25" y="17" width="14" height="3" rx="1" fill="${W}"/>
    <path d="M9 31 Q19 31 23 20 L41 20 Q45 31 55 31 L51 34 L13 34 Z" fill="${W}"/>
    <rect x="18" y="34" width="4" height="11" fill="${W}"/>
    <rect x="30" y="34" width="4" height="11" fill="${W}"/>
    <rect x="42" y="34" width="4" height="11" fill="${W}"/>
    <rect x="12" y="45" width="40" height="5" rx="1" fill="${W}"/>`,
  // Tokugawa: mountain and rising sun
  fuji: `
    <circle cx="45" cy="20" r="7" fill="${W}" opacity=".9"/>
    <path d="M7 50 L26 21 Q32 17 38 21 L57 50 Z" fill="${W}" opacity=".55"/>
    <path d="M20.5 29.5 L26 21 Q32 17 38 21 L43.5 29.5 L39 27.5 L35.5 31 L32 27.5 L28.5 31 L25 27.5 Z" fill="${W}"/>`,
  // Russia: onion dome with an Orthodox cross
  onion: `
    <rect x="31" y="5" width="2" height="11" fill="${W}"/>
    <rect x="27" y="8" width="10" height="2" fill="${W}"/>
    <rect x="28.5" y="12" width="7" height="1.6" fill="${W}"/>
    <path d="M32 16 C24 22 19 28 23 34 Q27 38.5 32 38.5 Q37 38.5 41 34 C45 28 40 22 32 16 Z" fill="${W}"/>
    <rect x="28" y="38" width="8" height="3" fill="${W}"/>
    <rect x="24" y="41" width="16" height="11" fill="${W}"/>
    <path d="M30 52 v-5 a2 2 0 0 1 4 0 v5 z" fill="currentColor" opacity=".45"/>
    <rect x="18" y="52" width="28" height="4" rx="1" fill="${W}"/>`,
  // Spain: treasure galleon
  galleon: `
    <rect x="31" y="11" width="2" height="29" fill="${W}"/>
    <rect x="20" y="18" width="2" height="22" fill="${W}"/>
    <path d="M33 11 L41 8.5 L33 6.5 Z" fill="${W}"/>
    <path d="M34 14 L46 16 Q43.5 25 46 35 L34 35 Z" fill="${W}" opacity=".9"/>
    <path d="M23 20 L30 22 Q28.5 28 30 34 L23 34 Z" fill="${W}" opacity=".9"/>
    <path d="M10 39 L54 39 L47 50 L17 50 Z" fill="${W}"/>
    <path d="M8 55 Q14 52 20 55 T32 55 T44 55 T56 55" stroke="${W}" stroke-width="2" fill="none" stroke-linecap="round"/>`,
  // Safavid: radiant sun
  sun: `
    <path d="M29.8 18.2 L32.0 7.0 L34.2 18.2Z M37.0 18.9 L44.5 10.3 L40.8 21.1Z M42.9 23.2 L53.7 19.5 L45.1 27.0Z M45.8 29.8 L57.0 32.0 L45.8 34.2Z M45.1 37.0 L53.7 44.5 L42.9 40.8Z M40.8 42.9 L44.5 53.7 L37.0 45.1Z M34.2 45.8 L32.0 57.0 L29.8 45.8Z M27.0 45.1 L19.5 53.7 L23.2 42.9Z M21.1 40.8 L10.3 44.5 L18.9 37.0Z M18.2 34.2 L7.0 32.0 L18.2 29.8Z M18.9 27.0 L10.3 19.5 L21.1 23.2Z M23.2 21.1 L19.5 10.3 L27.0 18.9Z" fill="${W}"/>
    <circle cx="32" cy="32" r="11" fill="${W}"/>
    <circle cx="32" cy="32" r="6" fill="currentColor" opacity=".3"/>`,
  // Songhai: Sahel mud-brick tower with wooden beams
  mosque: `
    <rect x="11" y="38" width="13" height="15" fill="${W}" opacity=".7"/>
    <rect x="40" y="38" width="13" height="15" fill="${W}" opacity=".7"/>
    <path d="M24 53 L28 14 L36 14 L40 53 Z" fill="${W}"/>
    <rect x="27" y="9" width="10" height="6" rx="2.5" fill="${W}"/>
    <g fill="${W}">
      <rect x="22.5" y="21" width="4" height="1.8"/><rect x="37.5" y="21" width="4" height="1.8"/>
      <rect x="21.7" y="29" width="4" height="1.8"/><rect x="38.3" y="29" width="4" height="1.8"/>
      <rect x="20.9" y="37" width="4" height="1.8"/><rect x="39.1" y="37" width="4" height="1.8"/>
      <rect x="20.1" y="45" width="4" height="1.8"/><rect x="39.9" y="45" width="4" height="1.8"/>
    </g>
    <path d="M30 53 v-6 a2 2 0 0 1 4 0 v6 z" fill="currentColor" opacity=".45"/>`,
};

export function emblem(name, color, size = 56, label = '') {
  const body = shapes[name] || '';
  const a11y = label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"';
  return `<svg class="emblem" viewBox="0 0 64 64" width="${size}" height="${size}" ${a11y} style="color:${color}">
    <circle cx="32" cy="32" r="31" fill="${color}"/>${body}</svg>`;
}
