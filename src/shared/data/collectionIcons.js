/**
 * Franchise icons for collections («Франшизы» in the collection icon picker).
 *
 * Each icon is a small colour tile in the franchise's colours with an object
 * the series is known for (crossed light swords, a sandworm's mouth, a ring in
 * fire), drawn for this extension. Logos and wordmarks are trademarks and are
 * not reproduced: Batman is a bat signal in a night sky, not the emblem.
 *
 * Tiles are drawn on a 48px grid with flat colours and opacity only. They use no
 * gradients, masks or clip paths, because those need ids and the same icon is
 * drawn several times on one page. Shapes that reach the bottom or top edge
 * follow the tile's 11px corner radius instead of being clipped.
 */
(function () {
    // Dark tiles get a hairline edge so they keep their shape on the dark theme.
    const tile = (background, body, { edge = false } = {}) => `<svg viewBox="0 0 48 48"><rect width="48" height="48" rx="11" fill="${background}"/>${body}${edge ? '<rect x=".5" y=".5" width="47" height="47" rx="10.5" fill="none" stroke="#fff" stroke-opacity=".14"/>' : ''}</svg>`;
    // The lower part of the tile below a line that starts at (0, y) and ends at (48, …).
    const bottomRounded = 'V37A11 11 0 0 1 37 48H11A11 11 0 0 1 0 37Z';
    const topRounded = 'M0 11A11 11 0 0 1 11 0H37A11 11 0 0 1 48 11';

    const FRANCHISE_ICONS = [
        {
            id: 'spider',
            label: 'Человек-паук',
            group: 'marvel',
            svg: tile('#d7262e', `<path fill="#1d4fc4" d="M0 33C12 30 36 30 48 33${bottomRounded}"/><g fill="none" stroke="#000" stroke-width="1.1" opacity=".35"><path d="M24 24 51.7 35.5M24 24 35.5 51.7M24 24 12.5 51.7M24 24-3.7 35.5M24 24-3.7 12.5M24 24 12.5-3.7M24 24 35.5-3.7M24 24 51.7 12.5"/><path d="M32.3 27.4Q28.7 28.7 27.4 32.3Q24 30.6 20.6 32.3Q19.3 28.7 15.7 27.4Q17.4 24 15.7 20.6Q19.3 19.3 20.6 15.7Q24 17.4 27.4 15.7Q28.7 19.3 32.3 20.6Q30.6 24 32.3 27.4M38.8 30.1Q32.4 32.4 30.1 38.8Q24 35.8 17.9 38.8Q15.6 32.4 9.2 30.1Q12.2 24 9.2 17.9Q15.6 15.6 17.9 9.2Q24 12.2 30.1 9.2Q32.4 15.6 38.8 17.9Q35.8 24 38.8 30.1"/></g><ellipse cx="24" cy="16.8" rx="2.8" ry="3" fill="#111"/><ellipse cx="24" cy="25" rx="3.9" ry="6.4" fill="#111"/><path fill="none" stroke="#111" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="M22 20 17 15.5 16 9M21.3 22.3 14.5 19.5 10.5 14M21.3 26.2 14.5 28.5 10.5 34M22 29 17 32.5 16 39M26 20 31 15.5 32 9M26.7 22.3 33.5 19.5 37.5 14M26.7 26.2 33.5 28.5 37.5 34M26 29 31 32.5 32 39"/>`)
        },
        {
            id: 'star-shield',
            label: 'Капитан Америка',
            group: 'marvel',
            svg: tile('#14234d', '<circle cx="24" cy="24" r="20" fill="#c8102e"/><circle cx="24" cy="24" r="15.6" fill="#f2f2f2"/><circle cx="24" cy="24" r="11.4" fill="#c8102e"/><circle cx="24" cy="24" r="7.4" fill="#1d3f94"/><path fill="#fff" d="M24 17.4 25.5 21.9 30.3 22 26.4 24.8 27.9 29.3 24 26.6 20.1 29.3 21.6 24.8 17.7 22 22.5 21.9Z"/><path fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity=".4" d="M10.5 15.5A16 16 0 0 1 20 8.6"/>')
        },
        {
            id: 'arc-reactor',
            label: 'Железный человек',
            group: 'marvel',
            svg: tile('#a3161a', `<path fill="#e3a72f" d="M0 31 48 17${bottomRounded}"/><circle cx="24" cy="24" r="16.5" fill="#2a2d33" stroke="#c9ced6" stroke-width="2"/><circle cx="24" cy="24" r="13.5" fill="#5ad1ff" opacity=".22"/><circle cx="24" cy="24" r="11" fill="none" stroke="#8be4ff" stroke-width="4.2" stroke-dasharray="4.6 2.31"/><circle cx="24" cy="24" r="6.6" fill="#bff2ff"/><circle cx="24" cy="24" r="3.8" fill="#fff"/>`)
        },
        {
            id: 'hammer',
            label: 'Тор',
            group: 'marvel',
            svg: tile('#1b2a49', '<path fill="none" stroke="#ffe066" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M14 29l-4 6h4l-4 7M34 29l4 6h-4l4 7M6 8l3 4H6.5l3 4M42 8l-3 4h2.5l-3 4"/><rect x="9" y="11" width="30" height="15" rx="2.5" fill="#9aa4ae"/><rect x="9" y="11" width="30" height="4.5" rx="2.2" fill="#c7cfd6"/><rect x="9" y="11" width="5" height="15" rx="2" fill="#77818b"/><rect x="34" y="11" width="5" height="15" rx="2" fill="#77818b"/><circle cx="24" cy="19.5" r="3.4" fill="none" stroke="#5f6870" stroke-width="1.4"/><rect x="21.5" y="26" width="5" height="14" rx="1" fill="#7b4a26"/><path stroke="#4e2d15" stroke-width="1.2" d="M21.5 29h5M21.5 32h5M21.5 35h5"/><rect x="20.5" y="39.5" width="7" height="3.5" rx="1.2" fill="#9aa4ae"/>')
        },
        {
            id: 'bat-signal',
            label: 'Бэтмен',
            group: 'dc',
            svg: tile('#0f1830', `<path fill="#f6d55c" opacity=".2" d="M2 48 18 12h14L12 48Z"/><circle cx="27" cy="18" r="13" fill="#f6d55c"/><path fill="#0f1830" d="M16 14.5C18.5 15 21 15.5 24 16L25.5 13.5 26.3 15.1H27.7L28.5 13.5 30 16C33 15.5 35.5 15 38 14.5 36 16.3 35.6 18.1 35.8 20.1 34.4 19.1 32.8 19.1 31.6 20.1 30.8 20.4 29.4 21.1 27 24 24.6 21.1 23.2 20.4 22.4 20.1 21.2 19.1 19.6 19.1 18.2 20.1 18.4 18.1 18 16.3 16 14.5Z"/><path fill="#070c1a" d="M0 36H4V30H9V34H13V26H19V32H23V28H28V35H32V29H37V33H41V27H48${bottomRounded}"/><g fill="#f6d55c" opacity=".7"><rect x="15" y="28" width="1.4" height="1.4"/><rect x="34" y="31" width="1.4" height="1.4"/><rect x="43" y="30" width="1.4" height="1.4"/><rect x="6" y="33" width="1.4" height="1.4"/></g>`, { edge: true })
        },
        {
            id: 'light-swords',
            label: 'Звёздные войны',
            group: 'film',
            svg: tile('#060912', '<g fill="#fff"><circle cx="8" cy="9" r=".8"/><circle cx="38" cy="7" r=".6"/><circle cx="42" cy="22" r=".8"/><circle cx="6" cy="27" r=".6"/><circle cx="17" cy="43" r=".6"/><circle cx="31" cy="42" r=".7"/><circle cx="24" cy="5" r=".5"/></g><g stroke-linecap="round"><path stroke="#2f8bff" stroke-width="6.5" opacity=".4" d="M14 34 38.5 9.5"/><path stroke="#ff2e2e" stroke-width="6.5" opacity=".4" d="M34 34 9.5 9.5"/><path stroke="#eaf4ff" stroke-width="2.6" d="M14 34 38.5 9.5"/><path stroke="#ffe6e6" stroke-width="2.6" d="M34 34 9.5 9.5"/><path stroke="#b9c0c9" stroke-width="4.6" d="M8 40l6-6M40 40l-6-6"/><path stroke="#2b2f36" stroke-width="4.8" d="M10.4 37.6l1.2-1.2M37.6 37.6l-1.2-1.2"/></g>', { edge: true })
        },
        {
            id: 'sandworm',
            label: 'Дюна',
            group: 'film',
            svg: tile('#f0a24e', `<circle cx="38.5" cy="9" r="3.4" fill="#fde7c8"/><circle cx="31.5" cy="6.5" r="1.9" fill="#fde7c8" opacity=".85"/><path fill="#d9813a" d="M0 30C10 24 20 27 28 31S42 27 48 25${bottomRounded}"/><path fill="#8a4524" d="M13 30C12 38 15 43 20 46H31C27 42 26 37 29 30Z"/><circle cx="21" cy="23" r="12" fill="#9c5129"/><circle cx="21" cy="23" r="9.6" fill="#5a2a12"/><circle cx="21" cy="23" r="5.4" fill="#1d0b04"/><path fill="#f6e3c4" d="M29.5 21.8 26.6 23 29.5 24.2ZM29.2 25.6 26 25.4 28.2 27.8ZM27.2 28.9 24.5 27.4 25.4 30.4ZM24.1 31 22.2 28.5 21.7 31.6ZM20.3 31.6 19.8 28.5 17.9 31ZM16.6 30.4 17.5 27.4 14.8 28.9ZM13.8 27.8 16 25.4 12.8 25.6ZM12.5 24.2 15.4 23 12.5 21.8ZM12.8 20.4 16 20.6 13.8 18.2ZM14.8 17.1 17.5 18.6 16.6 15.6ZM17.9 15 19.8 17.5 20.3 14.4ZM21.7 14.4 22.2 17.5 24.1 15ZM25.4 15.6 24.5 18.6 27.2 17.1ZM28.2 18.2 26 20.6 29.2 20.4Z"/><path fill="#b8612b" d="M0 38C9 34 18 36 26 40S41 38 48 35${bottomRounded}"/>`)
        },
        {
            id: 'gun-barrel',
            label: 'Джеймс Бонд',
            group: 'film',
            svg: tile('#0a0a0a', `<circle cx="24" cy="25" r="18" fill="#e9e9e9" stroke="#bdbdbd" stroke-width="1.5"/><path fill="none" stroke="#a3a3a3" stroke-width="2.6" stroke-linecap="round" d="M31.5 25Q36.7 27.7 34.9 38M29.3 30.3Q31.1 35.9 22.5 41.9M24 32.5Q21.3 37.7 11 35.9M18.7 30.3Q13.1 32.1 7.1 23.5M16.5 25Q11.3 22.3 13.1 12M18.7 19.7Q16.9 14.1 25.5 8.1M24 17.5Q26.7 12.3 37 14.1M29.3 19.7Q34.9 17.9 40.9 26.5"/><circle cx="24" cy="25" r="7.5" fill="#fafafa"/><g fill="#111"><circle cx="23.6" cy="20.6" r="1.5"/><path d="M22.4 22.4H25l.5 5.2 1.5 5.2h-1.6l-1.5-4.4-1.5 4.4h-1.6l1.4-5.2Z"/><path d="M24.9 22.8l4.6-1v1.2l-4.5.9Z"/></g><path fill="#b0001e" d="${topRounded}V6.5H43v3a1.4 1.4 0 0 1-2.8 0v-3H33.5v8a1.4 1.4 0 0 1-2.8 0v-8H24.5v4.5a1.4 1.4 0 0 1-2.8 0v-4.5H15v10a1.4 1.4 0 0 1-2.8 0v-10H0Z"/>`, { edge: true })
        },
        {
            id: 'wizard',
            label: 'Гарри Поттер',
            group: 'film',
            svg: tile('#6d1424', '<g fill="#f1c24b"><circle cx="9" cy="9" r="1"/><circle cx="39" cy="13" r="1.2"/><circle cx="36" cy="5" r=".7"/><circle cx="12" cy="17" r=".6"/></g><path fill="#f1c24b" d="M28 3 18.5 15.5H24L19 25 31 11H25.5Z"/><g fill="#fff" opacity=".16"><circle cx="14.5" cy="32" r="6"/><circle cx="33.5" cy="32" r="6"/></g><g fill="none" stroke="#f1c24b" stroke-width="2.6" stroke-linecap="round"><circle cx="14.5" cy="32" r="7"/><circle cx="33.5" cy="32" r="7"/><path d="M21.5 31.5c1.4-2 3.6-2 5 0M7.5 31 4 28M40.5 31l3.5-3"/></g>')
        },
        {
            id: 'ring',
            label: 'Властелин колец',
            group: 'film',
            svg: tile('#140d08', '<circle cx="24" cy="25" r="18" fill="#ff7a1a" opacity=".16"/><circle cx="24" cy="25" r="12" fill="#ff9a3c" opacity=".14"/><ellipse cx="24" cy="26" rx="16" ry="10" fill="#c98a16"/><ellipse cx="24" cy="25" rx="16" ry="9.4" fill="#f5c843"/><ellipse cx="24" cy="23.6" rx="11" ry="5.6" fill="#140d08"/><ellipse cx="24" cy="24.4" rx="13.5" ry="7.6" fill="none" stroke="#ff5a00" stroke-width="1.3" stroke-dasharray="2.2 1.4 .8 1.4"/><path fill="none" stroke="#fff6cf" stroke-width="1.4" stroke-linecap="round" opacity=".8" d="M12 19.5c3-2.4 7-3.4 12-3.4"/>', { edge: true })
        },
        {
            id: 'code-rain',
            label: 'Матрица',
            group: 'film',
            svg: tile('#020c05', '<g fill="none" stroke-linecap="round" stroke-width="1.6"><path stroke="#0f7a34" d="M6.5 4h3M8 4v3.4M6.5 12.6h3M6.5 9.2v3.4M13 9l3 3.4M16 9v1.7M19.5 2l3 3.4M22.5 2v1.7M21 7.2v3.4M19.5 8.4h3M19.5 12.4l3 3.4M22.5 12.4v1.7M27.5 12v3.4M26 13.2h3M32.5 5h3v3.4h-3M32.5 13.6h3M32.5 10.2v3.4M34 15.4v3.4M32.5 16.6h3M40.5 10v3.4M39 11.2h3M39 15.2l3 3.4M42 15.2v1.7"/><path stroke="#19d65a" d="M6.5 16.1h3M9.5 14.4v3.4M6.5 21.3h3M9.5 19.6v3.4M13 15.9h3M16 14.2v3.4M14.5 19.4v3.4M13 20.6h3M21 17.6v3.4M19.5 18.8h3M19.5 24.5h3M22.5 22.8v3.4M27.5 17.2v3.4M26 18.4h3M26 22.4h3M27.5 22.4v3.4M32.5 20.6h3M34 20.6v3.4M32.5 25.8l3 3.4M35.5 25.8v1.7M39 20.4l3 3.4M42 20.4v1.7M39 29h3M39 25.6v3.4"/><path stroke="#c9ffd9" d="M8 24.8v3.4M6.5 26h3M14.5 24.6v3.4M13 25.8h3M19.5 28h3v3.4h-3M27.5 27.6v3.4M26 28.8h3M32.5 34.4h3M32.5 31v3.4M39 34.2h3M39 30.8v3.4"/></g>', { edge: true })
        },
        {
            id: 'amber',
            label: 'Парк юрского периода',
            group: 'film',
            svg: tile('#123b22', '<path fill="#1f6a3a" d="M4 46C7 35 12 28 21 23 14 30 11 37 10 46Z"/><path fill="#1f6a3a" d="M44 42C41 32 36 26 28 22 34 29 37 35 37 44Z"/><path fill="#c7690a" d="M24 6C30.5 14 37 20.5 37 29a13 13 0 0 1-26 0C11 20.5 17.5 14 24 6Z"/><path fill="#f3a21b" d="M24 9.5C29.5 16.5 34.5 22 34.5 29a10.5 10.5 0 0 1-21 0C13.5 22 18.5 16.5 24 9.5Z"/><g transform="rotate(-30 24 30)"><ellipse cx="21.5" cy="27" rx="5.5" ry="1.9" fill="#fff3d0" opacity=".6"/><ellipse cx="21.5" cy="33" rx="5.5" ry="1.9" fill="#fff3d0" opacity=".6"/><ellipse cx="22.5" cy="30" rx="6" ry="1.6" fill="#3b1d06"/><ellipse cx="28.5" cy="30" rx="2.2" ry="1.9" fill="#3b1d06"/><circle cx="31.6" cy="30" r="1.4" fill="#3b1d06"/><path fill="none" stroke="#3b1d06" stroke-width=".9" stroke-linecap="round" d="M32.8 30h4.2M27 31.5l-2 4.5M28.5 31.8l.2 4.6M30 31.5l2 4M27 28.5l-2-4.5M28.5 28.2l.2-4.6M30 28.5l2-4"/></g><path fill="#fff" opacity=".35" d="M17 24c1.5-4 3.5-7 5-9-1 3-2 6-2.5 9.5Z"/>')
        },
        {
            id: 'jolly-roger',
            label: 'Пираты Карибского моря',
            group: 'film',
            svg: tile('#0e2c36', '<g stroke-linecap="round"><path stroke="#d8dee3" stroke-width="3" d="M9 41 36 12M39 41 12 12"/><path stroke="#d4a017" stroke-width="3.6" d="M6.5 43.5l3-3M41.5 43.5l-3-3"/><path stroke="#d4a017" stroke-width="2" d="M8 37.5l5 5M40 37.5l-5 5"/></g><path fill="#f2ecdc" d="M24 9c-7.2 0-12 4.8-12 11.4 0 4 1.8 6.8 4.4 8.4V33h15.2v-4.2c2.6-1.6 4.4-4.4 4.4-8.4C36 13.8 31.2 9 24 9Z"/><path fill="#b3202a" d="M12.2 18.5C13 12.6 17.8 9 24 9s11 3.6 11.8 9.5C31.5 16 16.5 16 12.2 18.5Z"/><path fill="#b3202a" d="M35 15.5l5.5 2-4.8 2Z"/><g fill="#0e2c36"><ellipse cx="19.2" cy="22.5" rx="2.9" ry="3.1"/><ellipse cx="28.8" cy="22.5" rx="2.9" ry="3.1"/><path d="M24 25.5 22.3 28.5H25.7Z"/></g><path stroke="#0e2c36" stroke-width="1.1" d="M20 30v3M24 30v3M28 30v3"/>')
        },
        {
            id: 'street-racer',
            label: 'Форсаж',
            group: 'film',
            svg: tile('#1d1238', `<path fill="#ff8a3d" opacity=".25" d="M0 34H48${bottomRounded}"/><path stroke="#7fe3ff" stroke-width="1.6" stroke-linecap="round" d="M4 14h10M3 19h8"/><path fill="#3aa8ff" d="M9 26.5 2.5 25 4 26.5 1.5 28 9 28.5Z"/><path fill="#ffd166" d="M9 27 5 26.6 6 27.5 4.4 28.4 9 28.6Z"/><path fill="#ff5a1f" d="M9 31v-4.5c0-1 .7-1.9 1.7-2.1l7.3-1.6 6-5.3c.7-.6 1.6-1 2.6-1h6.6c1 0 1.9.4 2.6 1.1l4.7 4.9 3.5.9c1 .3 1.9 1.2 1.9 2.3V31Z"/><path fill="#1b1b24" d="M25.5 18.6h5.6l4 4.2H20.8Z"/><path fill="#c43d0c" d="M9 29h36.9v2H9Z"/><circle cx="16" cy="31" r="4.2" fill="#121212"/><circle cx="16" cy="31" r="2" fill="#c9ced6"/><circle cx="37" cy="31" r="4.2" fill="#121212"/><circle cx="37" cy="31" r="2" fill="#c9ced6"/>`)
        },
        {
            id: 'burning-fuse',
            label: 'Миссия невыполнима',
            group: 'film',
            svg: tile('#0b0b0b', '<path fill="none" stroke="#d9c9a3" stroke-width="3" stroke-linecap="round" d="M5 43C13 41 11 31 19 30s8 3 12-2"/><circle cx="32" cy="27" r="9" fill="#ff7b00" opacity=".25"/><circle cx="32" cy="27" r="5" fill="#ffb000" opacity=".55"/><path fill="none" stroke="#ffcf3f" stroke-width="1.4" stroke-linecap="round" d="M32 17v4M32 33v4M22 27h4M38 27h4M25 20l2.8 2.8M36.2 31.2 39 34M39 20l-2.8 2.8M27.8 31.2 25 34"/><circle cx="32" cy="27" r="2.2" fill="#fff"/><g fill="#ffcf3f"><circle cx="41" cy="16" r=".9"/><circle cx="23" cy="17" r=".7"/><circle cx="42" cy="36" r=".7"/></g>', { edge: true })
        },
        {
            id: 'fedora',
            label: 'Индиана Джонс',
            group: 'film',
            svg: tile('#c99a5b', '<circle cx="37" cy="11" r="5" fill="#f3d38c"/><path fill="#6e4825" d="M12.5 32 14.5 18c.4-2.7 3.4-4.6 6.3-3.6L24 15.5l3.2-1.1c2.9-1 5.9.9 6.3 3.6l2 14Z"/><path fill="#2b1a0c" d="M13.2 27h21.6l.7 5H12.5Z"/><path fill="none" stroke="#4a2f16" stroke-width="1.2" stroke-linecap="round" d="M24 15.5v6"/><path fill="#5a3a1c" d="M2.5 31C7 35.6 15 37.6 24 37.6S41 35.6 45.5 31C40 32.6 32.5 33.2 24 33.2S8 32.6 2.5 31Z"/><path fill="none" stroke="#3a2412" stroke-width="2" stroke-linecap="round" d="M9 43c2.5-2.2 7-2.2 8.8 0s-1.2 3.2-3.8 2.4M17.8 43c4 1 10 .2 14-1.4s7.5-1.8 9.5-.4"/>')
        },
        {
            id: 'endoskeleton',
            label: 'Терминатор',
            group: 'film',
            svg: tile('#121216', '<path fill="#b0b7bf" d="M13 22C13 12 18 7 24 7s11 5 11 15v5l-3 3v6H16v-6l-3-3Z"/><path fill="#848b94" opacity=".55" d="M24 7c6 0 11 5 11 15v5l-3 3v6h-8Z"/><ellipse cx="19" cy="21" rx="3.8" ry="3.2" fill="#1a1a1f"/><ellipse cx="29" cy="21" rx="3.8" ry="3.2" fill="#1a1a1f"/><circle cx="29" cy="21" r="6.5" fill="#ff1f1f" opacity=".3"/><circle cx="29" cy="21" r="2.3" fill="#ff3030"/><circle cx="29.6" cy="20.4" r=".7" fill="#ffd0d0"/><path fill="#1a1a1f" d="M24 23.5 22 27.5H26Z"/><rect x="17.5" y="29.5" width="13" height="5" rx="1" fill="#2a2a30"/><path stroke="#c7cdd4" stroke-width="1" d="M20 29.5v5M22.5 29.5v5M25 29.5v5M27.5 29.5v5"/><path stroke="#6c737c" stroke-width="1.4" stroke-linecap="round" d="M14.5 27.5 16.5 37M33.5 27.5 31.5 37"/><rect x="16" y="36" width="16" height="3" rx="1" fill="#5a6068"/>', { edge: true })
        },
        {
            id: 'ghost',
            label: 'Охотники за привидениями',
            group: 'film',
            svg: tile('#2a1846', '<path fill="#86d957" d="M14 38V20a11 11 0 0 1 22 0v18l-3.67-2.6-3.67 2.6-3.66-2.6-3.67 2.6-3.66-2.6Z"/><g fill="#86d957"><circle cx="17" cy="41.5" r="1.3"/><circle cx="30" cy="42.5" r="1.1"/></g><ellipse cx="20.5" cy="19.5" rx="3" ry="3.6" fill="#fff"/><ellipse cx="29.5" cy="19.5" rx="3" ry="3.6" fill="#fff"/><circle cx="21.2" cy="20.4" r="1.5" fill="#1d1033"/><circle cx="30.2" cy="20.4" r="1.5" fill="#1d1033"/><ellipse cx="25" cy="29" rx="4.5" ry="3.2" fill="#3c6e24"/><path fill="none" stroke="#ff9d2e" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" d="M3 45l5-4-1.5-3 5-2.5-1-3 4-2.5"/><path fill="none" stroke="#bfe9ff" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" d="M3 45l5-4-1.5-3 5-2.5-1-3 4-2.5"/>')
        },
        {
            id: 'fire-tracks',
            label: 'Назад в будущее',
            group: 'film',
            svg: tile('#0d0b1a', `<path fill="#1c1830" d="M0 26H48${bottomRounded}"/><path fill="#ff6a00" d="M11 48 22 26h1.6L17 48ZM31 48 24.4 26H26L37 48Z"/><path fill="#ffd23f" d="M13.3 48 22.6 26h.5L15 48ZM33 48 25 26h.5L34.7 48Z"/><path fill="#ff8c1a" d="M12 46c-1-2 0-4 1.5-5 0 1.5.8 2.2 1.5 2.4-.2-1.6.4-3 1.8-4-.3 2 .4 3 1 4-.6 1.4-2 2.6-5.8 2.6ZM36 46c1-2 0-4-1.5-5 0 1.5-.8 2.2-1.5 2.4.2-1.6-.4-3-1.8-4 .3 2-.4 3-1 4 .6 1.4 2 2.6 5.8 2.6Z"/><path fill="#bfe6ff" d="M30 2 23 13H28L22 23 35 9H29.5L33 2Z"/><circle cx="28.5" cy="12" r="9" fill="#bfe6ff" opacity=".12"/>`, { edge: true })
        },
        {
            id: 'marionette',
            label: 'Крёстный отец',
            group: 'film',
            svg: tile('#0a0a0a', '<g fill="none" stroke="#e8e8e8" stroke-linecap="round"><path stroke-width="2.6" d="M10 9h28M24 5v12"/><path stroke-width="2" d="M15 12.5h18"/><path stroke-width=".9" opacity=".85" d="M10 9v24M38 9v21M24 17v8M15 12.5v25M33 12.5v23"/></g><path fill="none" stroke="#2f7d32" stroke-width="1.6" stroke-linecap="round" d="M25 34c0 4-1 7.5-3 10.5"/><path fill="#2f7d32" d="M23.6 39.5c-3-.5-5 .5-6 2.5 3 .5 5-.5 6-2.5Z"/><circle cx="25" cy="30" r="5.4" fill="#c1121f"/><path fill="none" stroke="#7a0a12" stroke-width="1.1" stroke-linecap="round" d="M25 27.4c-1.8 0-2.8 1.3-2.8 2.7s1.2 2.6 2.8 2.6 2.5-1 2.5-2.3-1-1.9-2-1.9"/>', { edge: true })
        },
        {
            id: 'boxing-glove',
            label: 'Рокки',
            group: 'film',
            svg: tile('#14264d', '<path fill="#fff" opacity=".9" d="M38 6l1 2.1 2.3.3-1.7 1.6.4 2.3-2-1.1-2 1.1.4-2.3-1.7-1.6 2.3-.3Z"/><path fill="#b51d1d" d="M15 19h-2.5a4 4 0 0 0 0 8H15Z"/><path fill="#d62828" d="M17 36v-3l-2-2V17a9 9 0 0 1 9-9h3a10 10 0 0 1 10 10v8a9 9 0 0 1-4 7.5V36Z"/><path fill="none" stroke="#ff8f8f" stroke-width="1.6" stroke-linecap="round" opacity=".6" d="M19.5 13c1.5-1.6 3.4-2.4 5.5-2.4"/><path fill="none" stroke="#9e1b1b" stroke-width="1.2" stroke-linecap="round" d="M15 22.5c3 0 6-1 7.5-3.5"/><rect x="16" y="36" width="18" height="7" rx="1.6" fill="#f4f4f4"/><path stroke="#c9c9c9" stroke-width="1" d="M16 39.5h18"/>')
        },
        {
            id: 'agent-suit',
            label: 'Люди в чёрном',
            group: 'film',
            svg: tile('#111', `<path fill="#d9dde2" d="${topRounded}V40C44 34 38 31 31 30H17C10 31 4 34 0 40Z"/><path fill="#fff" d="M18 30H30L24 42Z"/><path fill="#111" d="M22.9 31.5H25.1L25.8 38 24 40.5 22.2 38Z"/><path fill="#111" d="M22.6 30H25.4L24.9 32H23.1Z"/><path fill="#111" d="M6.5 15.5H41.5V17H6.5Z"/><path fill="#111" d="M8 16H22V19a4.5 4.5 0 0 1-4.5 4.5h-5A4.5 4.5 0 0 1 8 19ZM26 16H40V19a4.5 4.5 0 0 1-4.5 4.5h-5A4.5 4.5 0 0 1 26 19Z"/><path fill="#fff" opacity=".3" d="M10 17.5h4l-2.5 4H10ZM28 17.5h4l-2.5 4H28Z"/>`, { edge: true })
        },
        {
            id: 'bow-fire',
            label: 'Голодные игры',
            group: 'film',
            svg: tile('#1a0d08', `<path fill="#f26b0f" d="M0 30C4 28 6 24 5 19 9 22 11 26 11 29 13 25 13 21 11 16 17 20 19 26 18 30 20 28 21 24 21 21 25 24 27 28 26 32 28 30 30 27 30 23 34 27 35 31 34 34 36 33 38 30 38 27 42 30 44 33 48 32${bottomRounded}"/><path fill="#ffb703" d="M0 38C5 36 8 33 8 30 11 33 12 36 11 39 14 37 16 34 16 31 20 34 21 38 20 41 23 39 25 36 25 33 29 36 30 40 29 42 32 41 34 38 34 35 38 38 40 40 48 39${bottomRounded}"/><g fill="none" stroke="#ffd166" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M24 5C37 11 37 37 24 43"/><path stroke-width="1.1" d="M24 5 17 24 24 43"/><path stroke-width="2" d="M17 24H43M39 20.5 43.5 24 39 27.5M17 24l-3-3M17 24l-3 3M20 24l-3-3M20 24l-3 3"/></g>`, { edge: true })
        },
        {
            id: 'hockey-mask',
            label: 'Пятница 13-е',
            group: 'horror',
            svg: tile('#1b1b1b', '<path fill="#efe8d6" d="M24 6C15 6 11 12 11 22c0 10 5 19 13 20 8-1 13-10 13-20 0-10-4-16-13-16Z"/><path fill="#c8bfa8" opacity=".5" d="M24 6c9 0 13 6 13 16 0 10-5 19-13 20Z"/><g fill="#1b1b1b"><ellipse cx="18.8" cy="20" rx="3.3" ry="2.4"/><ellipse cx="29.2" cy="20" rx="3.3" ry="2.4"/><circle cx="24" cy="13" r=".9"/><circle cx="20.5" cy="14.5" r=".9"/><circle cx="27.5" cy="14.5" r=".9"/><circle cx="24" cy="27" r=".9"/><circle cx="21" cy="31" r=".9"/><circle cx="24" cy="31" r=".9"/><circle cx="27" cy="31" r=".9"/><circle cx="22.5" cy="35" r=".9"/><circle cx="25.5" cy="35" r=".9"/><circle cx="15.5" cy="27" r=".9"/><circle cx="32.5" cy="27" r=".9"/></g><g fill="#c1121f"><path d="M21.5 8.6H26.5L24 11.8Z"/><path d="M14 23.5 17.6 24.8 14.6 27Z"/><path d="M34 23.5 30.4 24.8 33.4 27Z"/></g>', { edge: true })
        },
        {
            id: 'kaiju-spines',
            label: 'Годзилла',
            group: 'film',
            svg: tile('#0b1a26', `<circle cx="37" cy="10" r="4" fill="#dfe8ee" opacity=".85"/><path fill="none" stroke="#5fd8ff" stroke-width="5" stroke-linejoin="round" opacity=".25" d="M5 40C6 35 8 31 10 29L11 31 13 24 15 31 16 29C17 32 17.5 36 17.5 40ZM14 40C15 30 18 24 21 20L22 23 24.5 11 27 23 28.5 20C31 24 33 30 34 40ZM30.5 40C30.5 36 31 32 32 29L33 31 35 24 37 31 38 29C40 31 42 35 43 40Z"/><path fill="#1d3527" stroke="#7fe4ff" stroke-width="1.4" stroke-linejoin="round" d="M5 40C6 35 8 31 10 29L11 31 13 24 15 31 16 29C17 32 17.5 36 17.5 40ZM14 40C15 30 18 24 21 20L22 23 24.5 11 27 23 28.5 20C31 24 33 30 34 40ZM30.5 40C30.5 36 31 32 32 29L33 31 35 24 37 31 38 29C40 31 42 35 43 40Z"/><path fill="#12466b" d="M0 36C4 34 8 38 12 36S20 34 24 36 32 38 36 36 44 34 48 36${bottomRounded}"/><path fill="none" stroke="#5fb3e0" stroke-width="1.2" stroke-linecap="round" opacity=".6" d="M6 41c2-1 4-1 6 0M28 43c2-1 4-1 6 0"/>`, { edge: true })
        },
        {
            id: 'infinity-gauntlet',
            label: 'Мстители',
            group: 'marvel',
            svg: tile('#2a1640', '<circle cx="24" cy="22" r="17" fill="#7c3aed" opacity=".18"/><path fill="#c98e1c" d="M14 34h20v9.5a1.5 1.5 0 0 1-1.5 1.5h-17a1.5 1.5 0 0 1-1.5-1.5Z"/><path fill="#e0a526" d="M13 17h22v13a6 6 0 0 1-6 6H19a6 6 0 0 1-6-6Z"/><g fill="#e8b23a"><rect x="13" y="8" width="5" height="11" rx="2.5"/><rect x="18.6" y="6.5" width="5" height="12" rx="2.5"/><rect x="24.2" y="7" width="5" height="12" rx="2.5"/><rect x="29.8" y="9" width="5" height="10" rx="2.5"/></g><path fill="#e0a526" d="M13 21c-3-1-6 0-6.5 2.5S8 28 11 28.5l2 .5Z"/><path fill="none" stroke="#8a5d0a" stroke-width=".8" d="M18.3 9v9M23.9 8v10M29.5 9v9M14 34h20M15 38.5h18"/><circle cx="24" cy="25" r="3.4" fill="#ffd400"/><circle cx="15.5" cy="13" r="1.5" fill="#a64dff"/><circle cx="21.1" cy="11.5" r="1.5" fill="#2f7bff"/><circle cx="26.7" cy="12" r="1.5" fill="#ff2a2a"/><circle cx="32.3" cy="13.5" r="1.5" fill="#ff8c1a"/><circle cx="9.5" cy="24.5" r="1.5" fill="#22c55e"/><circle cx="23" cy="24" r=".9" fill="#fff" opacity=".7"/>', { edge: true })
        },
        {
            id: 'hulk-fist',
            label: 'Халк',
            group: 'marvel',
            svg: tile('#4b2a6b', `<path fill="#5b5560" d="M0 34H48${bottomRounded}"/><path fill="none" stroke="#2f2b33" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" d="M24 35 19 40 15 39 10 44M24 35 29 41 34 40 38 45M24 35 23 42 26 47M24 35 14 36 6 35M24 35 34 36 43 35"/><path fill="#3f8f3a" d="M17 0H31V12H17Z"/><path fill="#43a047" d="M12 18c-3 0-4 2-4 4s2 4 5 3Z"/><path fill="#4caf50" d="M12 14a4 4 0 0 1 4-4h16a4 4 0 0 1 4 4v14a7 7 0 0 1-7 7H19a7 7 0 0 1-7-7Z"/><path fill="none" stroke="#2e7d32" stroke-width="1.3" stroke-linecap="round" d="M18 24v9M24 24v10M30 24v9M14 22h20"/><path fill="none" stroke="#fff" stroke-width="1.4" stroke-linecap="round" opacity=".8" d="M8 30 4 32M40 30l4 2M9 26H4M39 26h5"/>`)
        },
        {
            id: 'mystic-portal',
            label: 'Доктор Стрэндж',
            group: 'marvel',
            svg: tile('#1b1030', '<circle cx="24" cy="24" r="17" fill="#ff8a00" opacity=".12"/><path fill="none" stroke="#ffb000" stroke-width="1.6" stroke-linecap="round" d="M39.5 24 42.9 25.3M39.7 28.2 41.3 30M37.4 31.8 38.5 33.8M35.5 35.5 36.9 38.9M31.8 37.4 31.7 39.7M28.2 39.7 27.5 42M24 39.5 22.7 42.9M19.8 39.7 18 41.3M16.3 37.4 14.2 38.5M12.5 35.5 9.1 36.9M10.6 31.8 8.3 31.7M8.3 28.2 6 27.5M8.5 24 5.1 22.7M8.3 19.8 6.7 18M10.6 16.3 9.5 14.2M12.5 12.5 11.1 9.1M16.2 10.6 16.3 8.3M19.8 8.3 20.5 6M24 8.5 25.3 5.1M28.2 8.3 30 6.7M31.8 10.6 33.8 9.5M35.5 12.5 38.9 11.1M37.4 16.2 39.7 16.3M39.7 19.8 42 20.5"/><circle cx="24" cy="24" r="14" fill="none" stroke="#ff9f1c" stroke-width="2.8"/><circle cx="24" cy="24" r="11.2" fill="none" stroke="#ffd166" stroke-width="1" stroke-dasharray="2 1.6"/><g fill="none" stroke="#ffb347" stroke-width="1.1"><rect x="17" y="17" width="14" height="14"/><rect x="17" y="17" width="14" height="14" transform="rotate(45 24 24)"/><circle cx="24" cy="24" r="4.5"/></g><circle cx="24" cy="24" r="1.6" fill="#fff3c4"/>', { edge: true })
        },
        {
            id: 'panther-claws',
            label: 'Чёрная пантера',
            group: 'marvel',
            svg: tile('#1a0f2e', '<g fill="none" stroke-linecap="round"><path stroke="#a855f7" stroke-width="6" opacity=".22" d="M6 8 14 20M42 8 34 20M5 30 12 34M43 30 36 34"/><path stroke="#c084fc" stroke-width="1.6" d="M6 8 14 20M42 8 34 20M5 30 12 34M43 30 36 34"/></g><path fill="#050307" stroke="#a855f7" stroke-width="1.4" stroke-linejoin="round" d="M14 20 12 8 20 14C22.5 13 25.5 13 28 14L36 8 34 20C36 27 33 33 27.5 36 26 37 22 37 20.5 36 15 33 12 27 14 20Z"/><g fill="#c084fc"><path d="M16.5 22.5 22 24.5 21 26.5 17 25Z"/><path d="M31.5 22.5 26 24.5 27 26.5 31 25Z"/></g><path fill="#3b2a52" d="M22 30H26L24 32.5Z"/><path fill="none" stroke="#cfd3da" stroke-width="1.4" d="M15 39.5Q24 45 33 39.5"/><path fill="#e6e9ee" d="M18 41.2 18.6 44.4 20 41.9ZM22.6 42.4 24 45.6 25.4 42.4ZM28 41.9 29.4 44.4 30 41.2Z"/>', { edge: true })
        },
        {
            id: 'cassette',
            label: 'Стражи Галактики',
            group: 'marvel',
            svg: tile('#1c1442', '<g fill="#fff"><circle cx="8" cy="8" r=".7"/><circle cx="41" cy="9" r=".6"/><circle cx="38" cy="42" r=".7"/><circle cx="10" cy="41" r=".5"/><circle cx="24" cy="6" r=".5"/></g><rect x="6" y="13" width="36" height="23" rx="2.5" fill="#e8e2d0"/><rect x="9" y="16" width="30" height="13.5" rx="1.5" fill="#f28c28"/><path stroke="#7a3b0c" stroke-width="1" stroke-linecap="round" d="M11.5 18.6h13"/><rect x="12" y="20.5" width="24" height="9" rx="4.5" fill="#2b2b2b"/><circle cx="17" cy="25" r="3.4" fill="#f5f5f5"/><circle cx="31" cy="25" r="3.4" fill="#f5f5f5"/><path stroke="#2b2b2b" stroke-width=".9" d="M18.4 25H20M17.7 26.2 18.5 27.6M16.3 26.2 15.5 27.6M15.6 25H14M16.3 23.8 15.5 22.4M17.7 23.8 18.5 22.4M32.4 25H34M31.7 26.2 32.5 27.6M30.3 26.2 29.5 27.6M29.6 25H28M30.3 23.8 29.5 22.4M31.7 23.8 32.5 22.4"/><path fill="#cfc7b0" d="M13 36 15 31.5H33L35 36Z"/>')
        },
        {
            id: 'ant',
            label: 'Человек-муравей',
            group: 'marvel',
            svg: tile('#b0141c', `<path fill="#c9ced6" opacity=".9" d="M0 36 48 30${bottomRounded}"/><ellipse cx="24" cy="12.5" rx="4" ry="3.6" fill="#111"/><ellipse cx="24" cy="21" rx="3" ry="4" fill="#111"/><ellipse cx="24" cy="32" rx="5.5" ry="7.5" fill="#111"/><path fill="none" stroke="#111" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" d="M22.5 9.5 18 4.5 15 5M25.5 9.5 30 4.5 33 5M21.5 19 15 15.5 12 18M26.5 19 33 15.5 36 18M21.5 22 14 24 11 29M26.5 22 34 24 37 29M22 24.5 17 30 16 37M26 24.5 31 30 32 37"/><ellipse cx="22" cy="29.5" rx="1.4" ry="3" fill="#fff" opacity=".3"/>`)
        },
        {
            id: 'adamantium-claws',
            label: 'Люди Икс',
            group: 'marvel',
            svg: tile('#1f3a93', `<path fill="#f5c518" d="M0 30 48 22${bottomRounded}"/><path fill="#d7dde4" d="M14.2 34 16.5 6.5 18.8 34ZM21.7 34 24 4 26.3 34ZM29.2 34 31.5 6.5 33.8 34Z"/><path fill="#9aa3ad" d="M16.5 6.5 18.8 34H16.8ZM24 4 26.3 34H24.3ZM31.5 6.5 33.8 34H31.8Z"/><path fill="#1a1a1a" d="M12 33h24a3 3 0 0 1 3 3v6H9v-6a3 3 0 0 1 3-3Z"/><path fill="none" stroke="#3a3a3a" stroke-width="1" d="M16.5 33v9M24 33v9M31.5 33v9"/>`)
        },
        {
            id: 'katanas',
            label: 'Дэдпул',
            group: 'marvel',
            svg: tile('#b3121b', `<path fill="#1a1a1a" opacity=".35" d="M0 26 48 18${bottomRounded}"/><g stroke-linecap="round"><path stroke="#dfe4ea" stroke-width="2.6" d="M12 36 38 8M36 36 10 8"/><path stroke="#9aa3ad" stroke-width=".8" d="M14 34 38 8M34 34 10 8"/><path stroke="#1a1a1a" stroke-width="3.8" d="M8 40l5-5M40 40l-5-5"/><path stroke="#1a1a1a" stroke-width="2" d="M10.5 32.5l4 4M37.5 32.5l-4 4"/></g><g fill="#1a1a1a"><circle cx="24" cy="40" r="1.4"/><circle cx="20" cy="43" r="1"/><circle cx="28.5" cy="42.5" r="1"/></g>`)
        },
        {
            id: 'joker-card',
            label: 'Джокер',
            group: 'dc',
            svg: tile('#3b1e5a', '<g transform="rotate(-10 24 24)"><rect x="12" y="7" width="24" height="34" rx="3" fill="#f7f4ec" stroke="#2e7d32" stroke-width="1.2"/><path fill="#2e7d32" d="M15 21 17.5 12 21 19 24 10.5 27 19 30.5 12 33 21Z"/><path fill="#7b2cbf" d="M24 10.5 27 19 30.5 12 33 21H24Z"/><g fill="#ffd400"><circle cx="17.5" cy="12" r="1.3"/><circle cx="24" cy="10.5" r="1.3"/><circle cx="30.5" cy="12" r="1.3"/></g><path fill="#d7263d" d="M16 27c3 5 13 5 16 0-3 2-13 2-16 0Z"/><path fill="none" stroke="#1a1a1a" stroke-width=".8" stroke-linecap="round" d="M17.3 28.4 18.4 29.3M30.7 28.4 29.6 29.3"/></g>')
        },
        {
            id: 'golden-lasso',
            label: 'Чудо-женщина',
            group: 'dc',
            svg: tile('#b3121b', `<path fill="#1d3f94" d="M0 31C14 27 34 27 48 31${bottomRounded}"/><g fill="#fff"><circle cx="9" cy="39" r=".9"/><circle cx="15" cy="44" r=".8"/><circle cx="39" cy="40" r=".9"/><circle cx="33" cy="45" r=".7"/><circle cx="24" cy="43" r=".7"/></g><circle cx="24" cy="24" r="17" fill="none" stroke="#ffd34d" stroke-width="6" opacity=".22"/><circle cx="24" cy="24" r="17" fill="none" stroke="#ffd34d" stroke-width="2" stroke-dasharray="3 1.2"/><path fill="#e3a72f" d="M7 22C13 17 35 17 41 22L38.5 27C33 23.5 15 23.5 9.5 27Z"/><path fill="#f5c84b" d="M18 21.2 24 31 30 21.2C26 20.4 22 20.4 18 21.2Z"/><path fill="#d62828" d="M24 14 26 18.5 30.8 19 27.2 22.2 28.2 27 24 24.6 19.8 27 20.8 22.2 17.2 19 22 18.5Z"/>`)
        },
        {
            id: 'trident',
            label: 'Аквамен',
            group: 'dc',
            svg: tile('#0b4f6c', `<path fill="#1f8fb5" d="M0 36C8 33 16 39 24 36S40 33 48 36${bottomRounded}"/><path fill="none" stroke="#5fd0ef" stroke-width="1.2" stroke-linecap="round" opacity=".7" d="M6 42c3-1.5 6-1.5 9 0M30 43c3-1.5 6-1.5 9 0"/><g fill="#f2c14e"><rect x="22.6" y="16" width="2.8" height="30" rx="1"/><path d="M14 16H34V18.5H14Z"/><path d="M14 18.5V9L12.4 10.6 15.3 4 18 10.6 16.4 9V18.5Z"/><path d="M22.6 16V6.5L21 8.1 24 1.5 27 8.1 25.4 6.5V16Z"/><path d="M31.6 18.5V9L30 10.6 32.7 4 35.6 10.6 34 9V18.5Z"/></g><g fill="#bfeaf7" opacity=".7"><circle cx="10" cy="28" r="1.2"/><circle cx="38" cy="24" r="1"/><circle cx="36" cy="30" r=".7"/></g>`)
        },
        {
            id: 'roaring-rex',
            label: 'Мир Юрского периода',
            group: 'film',
            svg: tile('#e8572a', `<circle cx="34" cy="18" r="11" fill="#ffb347" opacity=".6"/><path fill="#2b140c" d="M2 29C8 27 12 25 17 23 21 21 25 19 28 16L31 12C33 10 37 10 40 11L44 13 44 15 39 16 43 18 42 20 36 20 33 22C31 25 30 28 30 31L32 33 31 34 29 33C27 35 25 36 23 36L24 41 27 43 20 43 19 37C16 37 13 36 11 33L12 40 14 42 8 42 9 34C6 32 4 31 2 30Z"/><circle cx="35" cy="13" r=".8" fill="#ffb347"/><path fill="#2b140c" d="M0 41C6 39 10 42 16 40S30 42 36 41 44 39 48 40${bottomRounded}"/><path fill="none" stroke="#2b140c" stroke-width="1.4" stroke-linecap="round" d="M41 41 42 29M42 29C39 28 37 29 36 31M42 29C45 27 47 28 48 30M42 29C41 26 42 24 44 23"/>`)
        },
        {
            id: 'continental-coin',
            label: 'Джон Уик',
            group: 'film',
            svg: tile('#0e0e0e', '<circle cx="21" cy="26" r="13" fill="#b8860b"/><circle cx="21" cy="26" r="11.6" fill="#e0b13c"/><circle cx="21" cy="26" r="8" fill="none" stroke="#a87a12" stroke-width="1"/><g fill="#a87a12"><circle cx="31.6" cy="26" r=".6"/><circle cx="31" cy="29.6" r=".6"/><circle cx="29.1" cy="32.8" r=".6"/><circle cx="26.3" cy="35.2" r=".6"/><circle cx="22.8" cy="36.4" r=".6"/><circle cx="19.2" cy="36.4" r=".6"/><circle cx="15.7" cy="35.2" r=".6"/><circle cx="12.9" cy="32.8" r=".6"/><circle cx="11" cy="29.6" r=".6"/><circle cx="10.4" cy="26" r=".6"/><circle cx="11" cy="22.4" r=".6"/><circle cx="12.9" cy="19.2" r=".6"/><circle cx="15.7" cy="16.8" r=".6"/><circle cx="19.2" cy="15.6" r=".6"/><circle cx="22.8" cy="15.6" r=".6"/><circle cx="26.3" cy="16.8" r=".6"/><circle cx="29.1" cy="19.2" r=".6"/><circle cx="31" cy="22.4" r=".6"/><path d="M21 20.5 22.6 23.8 26.2 24.3 23.6 26.8 24.2 30.4 21 28.7 17.8 30.4 18.4 26.8 15.8 24.3 19.4 23.8Z"/></g><path stroke="#f2c14e" stroke-width="5" d="M33.5 35.5 42 17"/><path stroke="#bfc5cc" stroke-width="5" d="M42 17 42.6 15.7"/><path stroke="#d98aa0" stroke-width="5" d="M42.6 15.7 43.4 14"/><path fill="#e8b98a" d="M35.8 36.5 31.2 34.4 31.4 40.1Z"/><circle cx="31.6" cy="38.9" r=".9" fill="#333"/>', { edge: true })
        },
        {
            id: 'alien-egg',
            label: 'Чужой',
            group: 'horror',
            svg: tile('#0d1410', '<ellipse cx="24" cy="42" rx="18" ry="5" fill="#7cfc00" opacity=".12"/><path fill="#6b6a52" d="M24 9C32 9 36.5 18 36.5 27 36.5 36 31 42 24 42S11.5 36 11.5 27C11.5 18 16 9 24 9Z"/><path fill="none" stroke="#4a4936" stroke-width="1.2" stroke-linecap="round" d="M15 30c3-2 5-6 4-10M33 30c-3-2-5-6-4-10M20 38c1-3 4-4 4-7M28 38c-1-3-4-4-4-7"/><path fill="#2a2a1c" d="M24 9.5 26 15 31.5 16 26 17.5 24 23 22 17.5 16.5 16 22 15Z"/><path fill="#9cff3a" opacity=".55" d="M24 12 25.2 15.6 28.5 16 25.2 16.6 24 20 22.8 16.6 19.5 16 22.8 15.6Z"/><path fill="#fff" opacity=".15" d="M15 22c1-6 4-10 7-11-2 3-4 7-4.5 12Z"/>', { edge: true })
        },
        {
            id: 'laser-sight',
            label: 'Хищник',
            group: 'horror',
            svg: tile('#0e1a12', '<g fill="#1f4128"><path d="M0 20C8 18 14 22 16 30 8 30 3 26 0 24Z"/><path d="M48 14C40 13 34 17 32 24 40 25 45 21 48 18Z"/><path d="M14 48C16 40 22 36 30 36 28 43 23 47 18 48Z"/></g><g fill="#ff1a1a" opacity=".35"><circle cx="24" cy="16" r="3.6"/><circle cx="19" cy="25" r="3.6"/><circle cx="29" cy="25" r="3.6"/></g><g fill="#ff4d4d"><circle cx="24" cy="16" r="1.6"/><circle cx="19" cy="25" r="1.6"/><circle cx="29" cy="25" r="1.6"/></g><g fill="#fff"><circle cx="24" cy="16" r=".5"/><circle cx="19" cy="25" r=".5"/><circle cx="29" cy="25" r=".5"/></g>', { edge: true })
        },
        {
            id: 'red-balloon',
            label: 'Оно',
            group: 'horror',
            svg: tile('#1c2228', `<path fill="none" stroke="#8fa3b5" stroke-width=".8" stroke-linecap="round" opacity=".5" d="M14 5 12 11M40 14 38 20M9 20 7 26M36 28 34 34M42 30 40 36"/><path fill="#2c343c" d="M0 38H48${bottomRounded}"/><rect x="13" y="39" width="22" height="5" rx="1.5" fill="#0a0d10"/><path fill="none" stroke="#e8e8e8" stroke-width=".9" d="M24 28c-1 4 2 7 0 11.5"/><path fill="#d0161f" d="M24 5C30 5 34 9.5 34 15.5 34 22 29 27 24 27S14 22 14 15.5C14 9.5 18 5 24 5Z"/><path fill="#d0161f" d="M22.5 26.5H25.5L24 28.5Z"/><path fill="#fff" opacity=".45" d="M18.5 12c1-3 3-4.5 5-5-1.5 2-2.5 4-3 7Z"/>`, { edge: true })
        },
        {
            id: 'jack-o-lantern',
            label: 'Хэллоуин',
            group: 'horror',
            svg: tile('#1a0f1e', '<circle cx="39" cy="10" r="4" fill="#f1e9c6" opacity=".8"/><path fill="#3f6b2a" d="M23 12c0-3 1-5 3-6l1 1c-1.5 1.5-2 3-2 5Z"/><path fill="#f57c00" d="M24 12C14 12 8 18 8 26s6 14 16 14 16-6 16-14-6-14-16-14Z"/><path fill="none" stroke="#c45a00" stroke-width="1.2" d="M24 12c-4 4-4 24 0 28M24 12c4 4 4 24 0 28M16 14c-3 5-3 20 0 25M32 14c3 5 3 20 0 25"/><g fill="#ffd54f"><path d="M14 22 19 20 18.5 25Z"/><path d="M34 22 29 20 29.5 25Z"/><path d="M14 29c3 5 17 5 20 0l-3 1.5-1.5-1.5-2.5 2-2-1.8-2 1.8-2.5-2-1.5 1.5Z"/></g>', { edge: true })
        },
        {
            id: 'bladed-glove',
            label: 'Кошмар на улице Вязов',
            group: 'horror',
            svg: tile('#8b1a1a', '<path fill="#1f5f2e" d="M0 12H48V17H0ZM0 22H48V27H0ZM0 32H48V37H0Z"/><path fill="#d7dde4" d="M16.8 25 14.8 5 19 24.5ZM21.8 24.5 20.8 3.5 24 24.5ZM26.8 24.5 27.2 3.5 29 24.5ZM31.8 24.5 34 5.5 33.8 25Z"/><g fill="#9aa3ad"><rect x="15.5" y="23" width="4" height="5" rx="1"/><rect x="20.5" y="22.5" width="4" height="5" rx="1"/><rect x="25.5" y="22.5" width="4" height="5" rx="1"/><rect x="30.5" y="23" width="4" height="5" rx="1"/></g><path fill="#6b4423" d="M14 44V30c0-2 1.5-3.5 3.5-3.5h13c2 0 3.5 1.5 3.5 3.5v14Z"/><path fill="#6b4423" d="M14 33c-3-1-5 1-5 3s2 3 5 3Z"/><path fill="none" stroke="#4a2c14" stroke-width="1" d="M15 35h18"/>')
        },
        {
            id: 'iron-throne',
            label: 'Игра престолов',
            group: 'series',
            svg: tile('#1e2329', '<path fill="none" stroke="#aeb6bf" stroke-width="1.3" stroke-linecap="round" d="M16.2 28.5 11 25.5M17.1 27.2 9.4 20.8M18.2 26.1 13.1 20M19.5 25.2 13.5 14.8M20.9 24.5 17.8 16.1M22.4 24.1 20 10.3M24 24V13M25.6 24.1 28 10.3M27.1 24.5 30.2 16.1M28.5 25.2 34.5 14.8M29.8 26.1 34.9 20M30.9 27.2 38.6 20.8M31.8 28.5 37 25.5"/><path fill="none" stroke="#6b737c" stroke-width="1.2" stroke-linecap="round" d="M15.7 26.4 14.1 29.2M17 25.1 15 27.5M18.5 24 16.1 26M20.2 23.1 17.4 24.7M21.9 22.6 18.9 23.6M23.8 22.4 20.6 23M25.6 22.5H22.4M27.4 23 24.2 22.4M29.1 23.6 26.1 22.6M30.7 24.7 27.9 23.1M31.9 26 29.5 24M33 27.5 31 25.1M33.9 29.2 32.3 26.4"/><path fill="#4a515b" d="M17 23H31V34H17Z"/><path fill="#5d646e" d="M11 27h6v6h-6ZM31 27h6v6h-6ZM13 33H35V36.5H13Z"/><path fill="#3a4049" d="M14 36.5H34V44H14Z"/><path fill="#2a2f36" d="M9 44H39V46.5H9Z"/>', { edge: true })
        },
        {
            id: 'christmas-lights',
            label: 'Очень странные дела',
            group: 'series',
            svg: tile('#5a4231', '<g fill="#6b4f3b"><circle cx="10" cy="24" r="1.2"/><circle cx="38" cy="22" r="1.2"/><circle cx="24" cy="42" r="1.2"/><circle cx="14" cy="42" r="1"/><circle cx="34" cy="42" r="1"/></g><path fill="none" stroke="#1a1a1a" stroke-width="1.2" d="M3 14C12 20 20 20 26 15S40 10 45 16M3 30C10 36 20 37 27 32S40 27 45 33"/><g opacity=".35"><circle cx="8" cy="20" r="3.6" fill="#ff3b30"/><circle cx="15" cy="22" r="3.6" fill="#ffcc00"/><circle cx="22" cy="20.5" r="3.6" fill="#34c759"/><circle cx="29" cy="16" r="3.6" fill="#0a84ff"/><circle cx="36" cy="14.3" r="3.6" fill="#ff9500"/><circle cx="42" cy="16.3" r="3.6" fill="#bf5af2"/><circle cx="8" cy="36" r="3.6" fill="#0a84ff"/><circle cx="15" cy="38.3" r="3.6" fill="#ff9500"/><circle cx="22" cy="37.5" r="3.6" fill="#ff3b30"/><circle cx="30" cy="33" r="3.6" fill="#ffcc00"/><circle cx="37" cy="32" r="3.6" fill="#34c759"/><circle cx="43" cy="34" r="3.6" fill="#bf5af2"/></g><g><ellipse cx="8" cy="20" rx="1.7" ry="2.5" fill="#ff3b30"/><ellipse cx="15" cy="22" rx="1.7" ry="2.5" fill="#ffcc00"/><ellipse cx="22" cy="20.5" rx="1.7" ry="2.5" fill="#34c759"/><ellipse cx="29" cy="16" rx="1.7" ry="2.5" fill="#0a84ff"/><ellipse cx="36" cy="14.3" rx="1.7" ry="2.5" fill="#ff9500"/><ellipse cx="42" cy="16.3" rx="1.7" ry="2.5" fill="#bf5af2"/><ellipse cx="8" cy="36" rx="1.7" ry="2.5" fill="#0a84ff"/><ellipse cx="15" cy="38.3" rx="1.7" ry="2.5" fill="#ff9500"/><ellipse cx="22" cy="37.5" rx="1.7" ry="2.5" fill="#ff3b30"/><ellipse cx="30" cy="33" rx="1.7" ry="2.5" fill="#ffcc00"/><ellipse cx="37" cy="32" rx="1.7" ry="2.5" fill="#34c759"/><ellipse cx="43" cy="34" rx="1.7" ry="2.5" fill="#bf5af2"/></g>')
        },
        {
            id: 'porkpie-crystals',
            label: 'Во все тяжкие',
            group: 'series',
            svg: tile('#4f6b2a', `<path fill="#6f8f3a" d="M0 30C12 27 34 27 48 30${bottomRounded}"/><path fill="#141414" d="M15 18c0-4 4-6 9-6s9 2 9 6v4H15Z"/><path fill="#141414" d="M8 22.5C10 20.5 16 20 24 20s14 .5 16 2.5c-2 2-8 3-16 3s-14-1-16-3Z"/><path fill="#2e2e2e" d="M15 18.6H33V20.8H15Z"/><g fill="#5ec8f2"><path d="M12 41 15 31 18 41Z"/><path d="M17 42 21 29 25 42Z"/><path d="M24 42 27 33 30 42Z"/><path d="M29 41 33 30 36 41Z"/></g><g fill="#c3ecfb" opacity=".8"><path d="M21 29 23 42H21.5Z"/><path d="M33 30 34.5 41H33.3Z"/></g>`)
        },
        {
            id: 'magnifier-pipe',
            label: 'Шерлок',
            group: 'series',
            svg: tile('#4a3426', '<circle cx="21" cy="19" r="10" fill="#cfe8f3" opacity=".25"/><path stroke="#3b2414" stroke-width="4.2" stroke-linecap="round" d="M28.5 26.5 38 36"/><circle cx="21" cy="19" r="10" fill="none" stroke="#d4a017" stroke-width="2.6"/><path stroke="#d4a017" stroke-width="2.6" stroke-linecap="round" d="M28.3 26.3 30 28"/><path fill="none" stroke="#fff" stroke-width="1.2" stroke-linecap="round" opacity=".5" d="M15 15a7 7 0 0 1 4-3.5"/><path fill="#2b1a10" d="M7 32H13.5V37A3.25 3.25 0 0 1 7 37Z"/><path fill="none" stroke="#2b1a10" stroke-width="1.8" stroke-linecap="round" d="M13.5 35c3 2 7 4 11 4"/><path fill="none" stroke="#cbbfae" stroke-width="1" stroke-linecap="round" opacity=".6" d="M10 29c-1-2 1-3 0-5"/>')
        },
        {
            id: 'circle-triangle-square',
            label: 'Игра в кальмара',
            group: 'series',
            svg: tile('#ed1b76', '<g fill="none" stroke="#fff" stroke-width="3" stroke-linejoin="round"><circle cx="11" cy="24" r="5"/><path d="M24 18.5 29.5 29H18.5Z"/><rect x="32.5" y="18.5" width="10.5" height="10.5"/></g>')
        },
        {
            id: 'rising-hand',
            label: 'Ходячие мертвецы',
            group: 'series',
            svg: tile('#3b4a3a', `<circle cx="38" cy="10" r="3.5" fill="#d9e2c8" opacity=".6"/><g fill="none" stroke="#8fa37a" stroke-linecap="round"><path stroke-width="8" d="M24 46V31"/><path stroke-width="3.2" d="M21 29 18 17M23.5 28 23 13M26 28 28.5 14.5M28 30 32.5 19.5M20 32 14 27"/></g><circle cx="24" cy="30" r="5.2" fill="#8fa37a"/><path fill="none" stroke="#5d6e4f" stroke-width="1" stroke-linecap="round" d="M22 36l3 2M23 40l2-1"/><path fill="#3a2a1a" d="M0 40C8 37 16 41 24 39S40 37 48 40${bottomRounded}"/><g fill="#4a3624"><circle cx="15" cy="39" r="1.6"/><circle cx="33" cy="38.5" r="1.3"/><circle cx="29" cy="37" r=".9"/></g>`)
        },
        {
            id: 'acorn',
            label: 'Ледниковый период',
            group: 'animation',
            svg: tile('#bfe6f5', `<path fill="#e8f7fd" d="M0 34C10 31 20 35 30 32S44 31 48 33${bottomRounded}"/><path fill="none" stroke="#fff" stroke-width="1.4" stroke-linecap="round" d="M9 9v6M6 12h6M7 10l4 4M11 10l-4 4M39 30v5M36.5 32.5h5"/><path fill="#c98a4b" d="M15 21c0 9 4 17 9 19 5-2 9-10 9-19-3 1-6 1.5-9 1.5s-6-.5-9-1.5Z"/><path fill="#fff" opacity=".3" d="M18 24c0 5 1.5 9 3.5 11-3-1-4.5-5-4.5-10Z"/><path fill="#5a3418" d="M23 11.5c0-2 .5-3.5 2-4.5l1 1c-1 1-1.4 2-1.4 3.5Z"/><path fill="#7a4a24" d="M13 20c0-6 5-9 11-9s11 3 11 9c-3 1.5-7 2-11 2s-8-.5-11-2Z"/><path fill="none" stroke="#5a3418" stroke-width=".9" d="M15 18c3-1.5 6-2 9-2s6 .5 9 2M17 14.5c2-1 4.5-1.5 7-1.5s5 .5 7 1.5"/>`)
        },
        {
            id: 'straw-hat',
            label: 'Ван-Пис',
            group: 'animation',
            svg: tile('#1e88e5', `<path fill="#1565c0" d="M0 34C8 31 16 37 24 34S40 31 48 34${bottomRounded}"/><ellipse cx="24" cy="27" rx="18" ry="6" fill="#f2c14e"/><path fill="#f5d06f" d="M14 26c0-7 4.5-11 10-11s10 4 10 11c-3 1.3-6.5 2-10 2s-7-.7-10-2Z"/><path fill="#d32f2f" d="M14.2 23c3 1.4 6.5 2 9.8 2s6.8-.6 9.8-2l.2 3c-3 1.3-6.5 2-10 2s-7-.7-10-2Z"/><path fill="none" stroke="#c9952c" stroke-width=".7" d="M10 29c4 1.5 9 2.2 14 2.2s10-.7 14-2.2M17 19c2 .8 4.5 1.2 7 1.2s5-.4 7-1.2"/>`)
        }
    ];

    // Picker sections, in this order. Inside a section icons follow ORDER, so a
    // series' main entry comes first (Мстители before single heroes).
    const GROUPS = [
        { id: 'marvel', label: 'Marvel' },
        { id: 'dc', label: 'DC' },
        { id: 'film', label: 'Кино' },
        { id: 'horror', label: 'Ужасы' },
        { id: 'series', label: 'Сериалы' },
        { id: 'animation', label: 'Мультфильмы и аниме' }
    ];
    const ORDER = [
        'infinity-gauntlet', 'arc-reactor', 'star-shield', 'hammer', 'hulk-fist', 'spider', 'mystic-portal',
        'panther-claws', 'cassette', 'ant', 'adamantium-claws', 'katanas',
        'bat-signal', 'joker-card', 'golden-lasso', 'trident',
        'light-swords', 'sandworm', 'gun-barrel', 'wizard', 'ring', 'code-rain', 'amber', 'roaring-rex',
        'jolly-roger', 'street-racer', 'burning-fuse', 'continental-coin', 'fedora', 'endoskeleton',
        'ghost', 'fire-tracks', 'marionette', 'boxing-glove', 'agent-suit', 'bow-fire', 'kaiju-spines'
    ];
    const rank = icon => {
        const group = GROUPS.findIndex(entry => entry.id === icon.group);
        const position = ORDER.indexOf(icon.id);
        return group * 1000 + (position >= 0 ? position : 500 + FRANCHISE_ICONS.indexOf(icon));
    };
    const ranks = new Map(FRANCHISE_ICONS.map(icon => [icon, rank(icon)]));
    FRANCHISE_ICONS.sort((a, b) => ranks.get(a) - ranks.get(b));

    const api = { FRANCHISE_ICONS, GROUPS };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (typeof window !== 'undefined') window.CollectionIcons = api;
})();
