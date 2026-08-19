const _icon = (content) => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${content}</svg>`;
const _path = (d) => `<path d="${d}"/>`;
const _circle = (cx, cy, r) => `<circle cx="${cx}" cy="${cy}" r="${r}"/>`;
const _rect = (x, y, w, h, rx = 2) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}"/>`;
const _ellipse = (cx, cy, rx, ry) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"/>`;

const ICONS = {
  home: _icon(_path('M4.5 10.6 12 4.5l7.5 6.1v8.2a1.7 1.7 0 0 1-1.7 1.7h-3.6v-6.1H9.8v6.1H6.2a1.7 1.7 0 0 1-1.7-1.7v-8.2Z')),
  dashboard: _icon(`${_rect(4, 4.5, 6.4, 6.4, 1.4)}${_rect(13.6, 4.5, 6.4, 4.8, 1.4)}${_rect(13.6, 12.5, 6.4, 7, 1.4)}${_rect(4, 14, 6.4, 5.5, 1.4)}`),
  users: _icon(`${_path('M15.5 19.2c-.4-2.3-2-3.6-4.7-3.6s-4.3 1.3-4.8 3.6')}${_circle(10.8, 9, 3.2)}${_path('M18.8 18.6c-.2-1.8-1.2-3-3-3.6')}${_path('M15.4 6.3a2.8 2.8 0 0 1 0 5.3')}`),
  store: _icon(`${_path('M5 10.4 6.1 5h11.8l1.1 5.4')}${_path('M5 10.4a2.5 2.5 0 0 0 4.2 1.8 2.5 2.5 0 0 0 3.6 0 2.5 2.5 0 0 0 4.2 0 2.5 2.5 0 0 0 2-1.8')}${_path('M6.5 13.2v6.3h11v-6.3')}${_path('M9.2 19.5v-4.3h5.6v4.3')}`),
  plus: _icon(_path('M12 5v14M5 12h14')),
  check: _icon(_path('m5 12.7 4.2 4.1L19 7')),
  coin: _icon(`${_ellipse(12, 7.2, 7, 3.2)}${_path('M5 7.2v5.2c0 1.8 3.1 3.2 7 3.2s7-1.4 7-3.2V7.2')}${_path('M5 12.5v4.3c0 1.8 3.1 3.2 7 3.2s7-1.4 7-3.2v-4.3')}`),
  list: _icon(_path('M8 6.5h11M8 12h11M8 17.5h11M4.8 6.5h.1M4.8 12h.1M4.8 17.5h.1')),
  briefcase: _icon(`${_rect(4, 7.5, 16, 11.5, 2)}${_path('M9.5 7.5V5.8h5v1.7M4 12h16M10.2 12v1.4h3.6V12')}`),
  report: _icon(`${_path('M6 4.5h9.2L18 7.3v12.2H6z')}${_path('M14.8 4.5v3.1H18M9 16v-4M12 16V9.5M15 16v-2.5')}`),
  target: _icon(`${_circle(12, 12, 8)}${_circle(12, 12, 4.5)}${_circle(12, 12, 1.6)}`),
  boost: _icon(`${_path('M4 17.8 9 13l3.3 3.2L20 7.6')}${_path('M15.4 7.4H20v4.6')}${_path('M4 20h16')}`),
  'user-circle': _icon(`${_circle(12, 12, 8.5)}${_circle(12, 9.8, 2.7)}${_path('M7.3 18.1c.9-2.4 2.5-3.6 4.7-3.6s3.8 1.2 4.7 3.6')}`),
  wallet: _icon(`${_rect(4, 6.5, 16, 12, 2)}${_path('M4 9.8h13.5A2.5 2.5 0 0 1 20 12.3v.2h-4.2a2.5 2.5 0 0 0 0 5H20')}${_path('M16.2 14.8h.1')}`),
  sliders: _icon(_path('M5 7h8M17 7h2M5 12h2M11 12h8M5 17h8M17 17h2M13 5v4M7 10v4M13 15v4')),
  alert: _icon(`${_path('M12 4.2 21 19H3L12 4.2Z')}${_path('M12 9.2v4.4M12 16.8h.1')}`),
  history: _icon(`${_path('M7.1 8H4.5V5.4')}${_path('M5.2 12a6.8 6.8 0 1 0 1.9-4.7L4.5 9.9')}${_path('M12 8.6v3.8l3 1.8')}`),
  facebook: _icon(_path('M14.5 8.2h2.3V4.8h-2.6c-2.8 0-4.4 1.7-4.4 4.6v2H7.2v3.4h2.6v5h3.6v-5h2.6l.6-3.4h-3.2V9.5c0-.8.4-1.3 1.1-1.3Z')),
  shield: _icon(`${_path('M12 3.8 19 6.5v5.2c0 4.2-2.6 7.3-7 8.6-4.4-1.3-7-4.4-7-8.6V6.5l7-2.7Z')}${_path('m8.8 12.2 2.2 2.1 4.4-4.5')}`),
  settings: _icon(_path('M4.5 6.5h8M16.5 6.5h3M4.5 12h3M11.5 12h8M4.5 17.5h9M17.5 17.5h2M12.5 4.6v3.8M7.5 10.1v3.8M13.5 15.6v3.8')),
  support: _icon(`${_path('M5 13v-1a7 7 0 0 1 14 0v1')}${_path('M5 13.2a2 2 0 0 0 2 2h1v-4H7a2 2 0 0 0-2 2ZM19 13.2a2 2 0 0 1-2 2h-1v-4h1a2 2 0 0 1 2 2Z')}${_path('M16 17.5c-.8 1.3-2.1 2-4 2h-1.2')}`),
  moon: _icon(_path('M20 15.1A7.7 7.7 0 0 1 8.9 4.5 8.3 8.3 0 1 0 20 15.1Z')),
  sun: _icon(`${_circle(12, 12, 4)}${_path('M12 3.5v2M12 18.5v2M5.6 5.6 7 7M17 17l1.4 1.4M3.5 12h2M18.5 12h2M5.6 18.4 7 17M17 7l1.4-1.4')}`),
  logout: _icon(`${_path('M10 5H6.5A1.5 1.5 0 0 0 5 6.5v11A1.5 1.5 0 0 0 6.5 19H10')}${_path('M14 8l4 4-4 4M18 12H9')}`),
  chevron: _icon(_path('m8 10 4 4 4-4')),
  menu: _icon(_path('M4.5 7h15M4.5 12h15M4.5 17h15')),
  thumb: _icon(`${_path('M7 10.5v9H4.5v-9H7Z')}${_path('M7 10.5 11.4 4h1.2c1.1 0 1.8 1 1.5 2l-.8 3.1H18a2 2 0 0 1 2 2.3l-.9 5.3a3.4 3.4 0 0 1-3.4 2.8H7')}`),
  'user-plus': _icon(`${_circle(9.8, 8.8, 3.2)}${_path('M4.5 19c.5-2.7 2.3-4.2 5.3-4.2 2.2 0 3.8.8 4.6 2.3')}${_path('M18 10v6M15 13h6')}`),
  message: _icon(`${_path('M5 5.5h14v10.2H8.2L5 18.8V5.5Z')}${_path('M8.5 9.4h7M8.5 12.3h4.8')}`),
  heart: _icon(_path('M12 20s-7-4.1-8.5-8.8A4.3 4.3 0 0 1 11 7.4L12 8.5l1-1.1a4.3 4.3 0 0 1 7.5 3.8C19 15.9 12 20 12 20Z')),
  share: _icon(`${_path('M12 15V4.5')}${_path('m8.5 8 3.5-3.5L15.5 8')}${_path('M5 12.5v5.8A1.7 1.7 0 0 0 6.7 20h10.6a1.7 1.7 0 0 0 1.7-1.7v-5.8')}`),
  // Stat / status icons
  'check-circle': _icon(`${_path('m8 12.5 2.8 2.8L16 9')}${_circle(12, 12, 9)}`),
  'x-circle': _icon(`${_path('M9 9l6 6m0-6-6 6')}${_circle(12, 12, 9)}`),
  'x': _icon(_path('M6 6l12 12M18 6 6 18')),
  clock: _icon(`${_circle(12, 12, 9)}${_path('M12 7v5l3.5 2')}`),
  money: _icon(`${_rect(3, 7, 18, 12, 2)}${_path('M3 11h18M7 15h.01M12 15h2')}`),
  calendar: _icon(`${_rect(4, 5, 16, 16, 2)}${_path('M8 4v2M16 4v2M4 10h16')}${_path('M9 14h1M12 14h1M15 14h1M9 17h1M12 17h1')}`),
  'trending-up': _icon(`${_path('M4 17.8 9 13l3.3 3.2L20 7.6')}${_path('M15.4 7.4H20v4.6')}`),
  warning: _icon(`${_path('M12 4.2 21 19H3L12 4.2Z')}${_path('M12 9.2v4.4M12 16.8h.01')}`),
  chart: _icon(_path('M5 19V8h3v11H5Zm5.5 0V5h3v14h-3Zm5.5 0v-6h3v6H16')),
  user: _icon(`${_circle(12, 8, 3.5)}${_path('M5.5 20c.7-3.5 3-5.5 6.5-5.5s5.8 2 6.5 5.5')}`),
  kiosk: _icon(`${_path('M5 10.4 6.1 5h11.8l1.1 5.4')}${_path('M5 10.4a2.5 2.5 0 0 0 4.2 1.8 2.5 2.5 0 0 0 3.6 0 2.5 2.5 0 0 0 4.2 0 2.5 2.5 0 0 0 2-1.8')}${_path('M6.5 13.2v6.3h11v-6.3')}${_path('M9.2 19.5v-4.3h5.6v4.3')}`),
};

export function renderIcon(name) {
  return ICONS[name] || '';
}
