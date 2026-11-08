'use strict';

// Avatare als Vektorgrafik, zusammengesetzt aus Kopfbedeckung, Haut, Anzug, Farbe und Augen.
// Die Datei läuft im Browser (Zeichnen) und auf dem Server (Prüfen, ob ein Avatar gültig ist).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ImposterAvatar = api;
})(typeof self !== 'undefined' ? self : this, () => {
  const COLORS = [
    { name: 'Blutrot', accent: '#ff6a5c', main: '#a32c2c', dark: '#6d1c1f' },
    { name: 'Gold', accent: '#ffd76a', main: '#b98a24', dark: '#7c5a15' },
    { name: 'Smaragd', accent: '#7fe59a', main: '#2f8052', dark: '#1d5436' },
    { name: 'Eisblau', accent: '#86d6ff', main: '#2f709f', dark: '#1e4a6c' },
    { name: 'Violett', accent: '#c6a3ff', main: '#6642a8', dark: '#432b73' },
    { name: 'Schwarz', accent: '#d9d6e2', main: '#37343f', dark: '#22202a' },
  ];
  const SKINS = [
    { name: 'Hell', base: '#f0d6be', shade: '#d6b398' },
    { name: 'Mittel', base: '#d8a981', shade: '#ba8a63' },
    { name: 'Braun', base: '#a9754f', shade: '#8a5c3b' },
    { name: 'Dunkel', base: '#6f4b34', shade: '#553725' },
    { name: 'Untot', base: '#a4b99e', shade: '#83997e' },
  ];

  const DARK = '#17151d';
  const HAIR = '#2b2430';
  const STEEL = '#8a8896';
  const STEEL_DARK = '#615f6d';
  const GOLD = '#ecc44f';
  const GOLD_DARK = '#b58d2c';
  const BONE = '#e2dac9';
  const SHIRT = '#ece9e2';

  const BODY = 'M6 64c1-13 11-20 26-20s25 7 26 20z';

  const OUTFITS = [
    {
      name: 'Robe',
      draw: (c, s) =>
        `<path d="${BODY}" fill="${c.main}"/>` +
        `<path d="M25 44.700 32 54l7-9.300c-4-.9-10-.9-14 0z" fill="${s.shade}"/>` +
        `<path d="M21 46.300 32 60l11-13.700-4-1.600L32 54l-7-9.300z" fill="${c.dark}"/>` +
        `<path d="M31 60h2v4h-2z" fill="${c.dark}"/>`,
    },
    {
      name: 'Rüstung',
      draw: (c, s) =>
        `<path d="${BODY}" fill="${STEEL_DARK}"/>` +
        `<path d="M25 44.700 32 50l7-5.300c-4-.9-10-.9-14 0z" fill="${s.shade}"/>` +
        `<path d="M20 64V48l5-3.300L32 50l7-5.300 5 3.300v16z" fill="${STEEL}"/>` +
        `<path d="M31 50.500h2V64h-2z" fill="${STEEL_DARK}"/>` +
        `<path d="M5 64c0-9 3-15 9-17 5 1 8 5 8 10v7z" fill="${STEEL}"/>` +
        `<path d="M59 64c0-9-3-15-9-17-5 1-8 5-8 10v7z" fill="${STEEL}"/>` +
        `<circle cx="32" cy="57" r="2.800" fill="${c.main}"/>`,
    },
    {
      name: 'Anzug',
      draw: (c) =>
        `<path d="${BODY}" fill="${DARK}"/>` +
        `<path d="M25 44.700 32 62l7-17.300c-4-.9-10-.9-14 0z" fill="${SHIRT}"/>` +
        `<path d="M29.500 46h5L33.700 50l2 10L32 64l-3.700-4 2-10z" fill="${c.main}"/>` +
        `<path d="M25 44.700 20 47l5 6-1.500 2L32 64l-3-7z" fill="#2b2833"/>` +
        `<path d="M39 44.700 44 47l-5 6 1.500 2L32 64l3-7z" fill="#2b2833"/>`,
    },
    {
      name: 'Umhang',
      draw: (c, s) =>
        `<path d="${BODY}" fill="${c.main}"/>` +
        `<path d="M22 64V47c6-2.500 14-2.500 20 0v17z" fill="${DARK}"/>` +
        `<path d="M25 44.700 32 50l7-5.300c-4-.9-10-.9-14 0z" fill="${s.shade}"/>` +
        `<path d="M22 47l10 6 10-6v3l-10 6-10-6z" fill="${c.dark}"/>` +
        `<circle cx="32" cy="54" r="2.600" fill="${GOLD}"/>`,
    },
  ];

  const EYES = [
    {
      name: 'Ruhig',
      draw: () =>
        `<ellipse cx="26.700" cy="31" rx="1.900" ry="2.100" fill="${DARK}"/>` +
        `<ellipse cx="37.300" cy="31" rx="1.900" ry="2.100" fill="${DARK}"/>`,
    },
    {
      name: 'Streng',
      draw: (c, s) =>
        `<ellipse cx="26.700" cy="31.500" rx="1.800" ry="1.700" fill="${DARK}"/>` +
        `<ellipse cx="37.300" cy="31.500" rx="1.800" ry="1.700" fill="${DARK}"/>` +
        `<path d="M23.500 27.500 29.500 29.500M40.500 27.500 34.500 29.500" stroke="${HAIR}" stroke-width="1.600" stroke-linecap="round"/>` +
        `<path d="M24 34.500h4M36 34.500h4" stroke="${s.shade}" stroke-width=".8" stroke-linecap="round"/>`,
    },
    {
      name: 'Leuchtend',
      draw: (c) =>
        `<ellipse cx="26.700" cy="31" rx="3" ry="2.500" fill="${DARK}"/>` +
        `<ellipse cx="37.300" cy="31" rx="3" ry="2.500" fill="${DARK}"/>` +
        `<ellipse cx="26.700" cy="31" rx="1.700" ry="1.400" fill="${c.accent}"/>` +
        `<ellipse cx="37.300" cy="31" rx="1.700" ry="1.400" fill="${c.accent}"/>`,
    },
    {
      name: 'Geschlossen',
      draw: () =>
        `<path d="M24.200 31q2.500 2 5 0M34.800 31q2.500 2 5 0" fill="none" stroke="${DARK}" stroke-width="1.500" stroke-linecap="round"/>`,
    },
  ];

  const shortHair = `<path d="M19 31c-1.500-10 5-16 13-16s14.500 6 13 16c-2-5.500-6-8.500-13-8.500S21 25.500 19 31z" fill="${HAIR}"/>`;

  const HEADWEAR = [
    { name: 'Keine', front: () => shortHair },
    {
      name: 'Kapuze',
      back: (c) => `<path d="M32 6C19 6 11 17 11 31c0 7 3 13 7 18h28c4-5 7-11 7-18C53 17 45 6 32 6z" fill="${c.main}"/>`,
      front: (c) =>
        `<path d="M32 10C21 10 15.500 19 16.500 33 19 26 24 21.500 32 21.500S45 26 47.500 33C48.500 19 43 10 32 10z" fill="${c.main}"/>` +
        `<path d="M16.500 33C19 26 24 21.500 32 21.500S45 26 47.500 33c-3-5.500-8-8.500-15.500-8.500S19.500 27.500 16.500 33z" fill="${c.dark}"/>`,
    },
    {
      name: 'Krone',
      front: (c) => shortHair +
        `<path d="M20.500 24 19 9l7 6 6-9 6 9 7-6-1.500 15c-7-2-16-2-23 0z" fill="${GOLD}"/>` +
        `<path d="M20.500 24c7-2 16-2 23 0l.4-3.500c-7.300-2-16.500-2-23.800 0z" fill="${GOLD_DARK}"/>` +
        `<circle cx="32" cy="16.500" r="2" fill="${c.main}"/>`,
    },
    {
      name: 'Hexenhut',
      back: () => `<path d="M19 31c-2 7-2 13-1 18h28c1-5 1-11-1-18z" fill="${HAIR}"/>`,
      front: (c) =>
        `<ellipse cx="32" cy="24" rx="23" ry="4.500" fill="${c.dark}"/>` +
        `<path d="M20.500 24C22 14 29 4 45 2c-4.500 5-2.500 13-1.500 22-7 2-16 2-23 0z" fill="${c.main}"/>` +
        `<path d="M21 20.500c7 2 15 2 22 0l.5 3.500c-7 2-16 2-23 0z" fill="${c.dark}"/>` +
        `<rect x="29" y="20.800" width="6" height="4" rx=".8" fill="${GOLD}"/>`,
    },
    {
      name: 'Helm',
      front: (c) =>
        `<path d="M32 8c-10.500 0-16 8-16 18v12h5v-8c3-2 7-3.200 11-3.200S40 28 43 30v8h5V26c0-10-5.500-18-16-18z" fill="${STEEL}"/>` +
        `<path d="M32 8c10.500 0 16 8 16 18v12h-5v-8c-1-.7-2-1.200-3-1.700V26c0-8-3-14-8-18z" fill="${STEEL_DARK}"/>` +
        `<path d="M30.300 25h3.400v10.500L32 37.500l-1.700-2z" fill="${STEEL_DARK}"/>` +
        `<path d="M17 18C12 15 10 10 11 4c2 4 5.500 7 10 8zM47 18c5-3 7-8 6-14-2 4-5.500 7-10 8z" fill="${BONE}"/>` +
        `<path d="M29.500 8.300c1.600-.4 3.400-.4 5 0L33.500 14h-3z" fill="${c.main}"/>`,
    },
    {
      name: 'Zylinder',
      front: (c) => shortHair +
        `<path d="M22 5h20l-1 18H23z" fill="${DARK}"/>` +
        `<path d="M23 18h18l-.3 5H23.300z" fill="${c.main}"/>` +
        `<ellipse cx="32" cy="23.500" rx="17" ry="3.300" fill="${DARK}"/>`,
    },
  ];

  const PARTS = {
    head: { label: 'Kopfbedeckung', names: HEADWEAR.map((p) => p.name) },
    skin: { label: 'Haut', names: SKINS.map((p) => p.name) },
    outfit: { label: 'Anzug', names: OUTFITS.map((p) => p.name) },
    color: { label: 'Farbe', names: COLORS.map((p) => p.name) },
    eyes: { label: 'Augen', names: EYES.map((p) => p.name) },
  };

  function isValidAvatar(avatar) {
    if (avatar === null || typeof avatar !== 'object' || Array.isArray(avatar)) return false;
    const keys = Object.keys(PARTS);
    if (Object.keys(avatar).length !== keys.length) return false;
    return keys.every((key) => (
      Number.isInteger(avatar[key]) && avatar[key] >= 0 && avatar[key] < PARTS[key].names.length
    ));
  }

  function randomAvatar() {
    const avatar = {};
    for (const key of Object.keys(PARTS)) {
      avatar[key] = Math.floor(Math.random() * PARTS[key].names.length);
    }
    return avatar;
  }

  // Farbe für die runden Auswahlfelder, oder null, wenn der Teil als Text gewählt wird.
  function swatchColor(key, index) {
    if (key === 'skin') return SKINS[index].base;
    if (key === 'color') return COLORS[index].main;
    return null;
  }

  function drawFace(skin) {
    return (
      `<rect x="27" y="40" width="10" height="9" rx="3" fill="${skin.shade}"/>` +
      `<ellipse cx="19" cy="32" rx="2" ry="3" fill="${skin.shade}"/>` +
      `<ellipse cx="45" cy="32" rx="2" ry="3" fill="${skin.shade}"/>` +
      `<path d="M32 16c-8 0-13 6-13 15 0 10 5 17 13 17s13-7 13-17c0-9-5-15-13-15z" fill="${skin.base}"/>` +
      `<path d="M32 16c8 0 13 6 13 15 0 10-5 17-13 17 5-4 8-9 8-17 0-7-3-12-8-15z" fill="${skin.shade}" opacity=".55"/>` +
      `<path d="M31 36.500q1 .8 2 0" fill="none" stroke="${skin.shade}" stroke-width="1" stroke-linecap="round"/>` +
      `<path d="M28.500 41q3.500 1.400 7 0" fill="none" stroke="${DARK}" stroke-width="1.200" stroke-linecap="round" opacity=".75"/>`
    );
  }

  let nextId = 0;

  function avatarMarkup(avatar) {
    const color = COLORS[avatar.color];
    const skin = SKINS[avatar.skin];
    const headwear = HEADWEAR[avatar.head];
    const id = `avatar-${nextId++}`;
    return (
      `<defs>` +
        `<radialGradient id="${id}-bg" cx="50%" cy="35%" r="72%">` +
          `<stop offset="0" stop-color="#3a3647"/><stop offset="1" stop-color="#191720"/>` +
        `</radialGradient>` +
        `<clipPath id="${id}-clip"><circle cx="32" cy="32" r="32"/></clipPath>` +
      `</defs>` +
      `<g clip-path="url(#${id}-clip)">` +
        `<rect width="64" height="64" fill="url(#${id}-bg)"/>` +
        (headwear.back ? headwear.back(color, skin) : '') +
        OUTFITS[avatar.outfit].draw(color, skin) +
        drawFace(skin) +
        EYES[avatar.eyes].draw(color, skin) +
        headwear.front(color, skin) +
      `</g>`
    );
  }

  return { PARTS, isValidAvatar, randomAvatar, avatarMarkup, swatchColor };
});
