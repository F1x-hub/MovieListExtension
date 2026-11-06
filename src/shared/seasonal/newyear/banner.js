/**
 * New Year season: the Home sign.
 *
 * An Art Deco cinema front with a neon title, a countdown to midnight on 1 January,
 * a decorated tree that breaks through its top edge and a pile of gifts. Any gift
 * opens: there is a New Year film inside, fetched only when the first one is opened.
 *
 * HomeSeasonalBanner owns whether the sign is shown; this module owns what is inside.
 */
(function (g) {
    'use strict';

    const A = g.NyArt, Gifts = g.NyGifts, Tree = g.NyTree;
    const SVG_ICONS = {
        close: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>',
        arrow: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>'
    };
    const CHRISTMAS_KEYWORD = 207317;

    /* Three sizes of the sign: the content column decides, not the window. */
    const LAYOUTS = {
        wide: { h: 330, treeW: 380, treeH: 476, treeRight: 320, k: 1, gap: 24 },
        compact: { h: 300, treeW: 304, treeH: 381, treeRight: 244, k: 0.8, gap: 24 },
        stacked: { h: 676, treeW: 266, treeH: 333, treeRight: 0, k: 0.6, gap: 22 }
    };
    const layoutFor = width => (width >= 1240 ? 'wide' : width >= 1040 ? 'compact' : 'stacked');

    const pad2 = n => String(n).padStart(2, '0');

    function dialTicks() {
        let d = '';
        for (let i = 0; i < 60; i++) {
            const a = i * Math.PI / 30, major = i % 5 === 0;
            const r0 = major ? 49 : 52.5, r1 = 56;
            d += 'M' + (58 + Math.sin(a) * r0).toFixed(1) + ' ' + (58 - Math.cos(a) * r0).toFixed(1)
                + 'L' + (58 + Math.sin(a) * r1).toFixed(1) + ' ' + (58 - Math.cos(a) * r1).toFixed(1);
        }
        return d;
    }

    class NewYearBanner {
        /**
         * @param {HTMLElement} host - empty, hidden element reserved in home.html
         * @param {{season: object, translate: (key: string) => string, onDismiss: () => void}} options
         */
        constructor(host, options) {
            this.host = host;
            this.season = options.season;
            this.translate = options.translate;
            this.onDismiss = options.onDismiss;
            this.locale = () => g.i18n?.currentLocale || 'ru';
            this.faces = {};
            this.shownLeft = null;
            this.openGift = null;
            this.films = null;
            this.filmsRequest = null;
            this.offs = [];
            this.timer = 0;
            this.layoutName = '';
            this.build();
            this.update();
            this.fitLayout();
            this.resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.fitLayout()) : null;
            this.resizeObserver?.observe(host);
            this.offReady = g.NewYearDecor?.onReady(fx => this.attach(fx)) || null;
            this.arm();
        }

        listen(target, type, handler, options) {
            target.addEventListener(type, handler, options);
            this.offs.push(() => target.removeEventListener(type, handler, options));
        }

        /* ---------- Markup ---------- */

        build() {
            const flip = key => `<span class="ny-flip" data-face="${key}">`
                + '<span class="ny-flip__half ny-flip__half--top"><span class="ny-flip__num"></span></span>'
                + '<span class="ny-flip__half ny-flip__half--bottom"><span class="ny-flip__num"></span></span>'
                + '<span class="ny-flip__flap ny-flip__flap--top"><span class="ny-flip__num"></span></span>'
                + '<span class="ny-flip__flap ny-flip__flap--bottom"><span class="ny-flip__num"></span></span>'
                + '</span>';
            const unit = (name, keys) => `<div class="ny-clock__unit"><div class="ny-clock__digits">${keys.map(flip).join('')}</div>`
                + `<span class="ny-clock__label" data-unit="${name}"></span></div>`;
            const gifts = Gifts.GIFTS.map((_, i) => '<button type="button" class="ny-gift" aria-expanded="false">'
                + `<img class="ny-gift__body" alt="" draggable="false" src="${A.assetUrl(Gifts.pictureName(i, 'body'))}">`
                + '<span class="ny-gift__light"></span>'
                + `<img class="ny-gift__lid" alt="" draggable="false" src="${A.assetUrl(Gifts.pictureName(i, 'lid'))}">`
                + '<span class="ny-gift__hit"></span></button>').join('');

            this.host.innerHTML = '<section class="ny-marquee" aria-labelledby="ny-marquee-title">'
                + '<div class="ny-marquee__panel"><div class="ny-marquee__burst"></div><canvas class="ny-marquee__aurora"></canvas><canvas class="ny-marquee__floor"></canvas></div>'
                + '<svg class="ny-marquee__frame" aria-hidden="true" focusable="false"><defs>'
                + '<linearGradient id="nyFrameFill" x1="0" y1="0" x2="1" y2="0.3"><stop offset="0" class="season-stop--frame-a"></stop><stop offset="0.5" class="season-stop--frame-b"></stop><stop offset="1" class="season-stop--frame-c"></stop></linearGradient>'
                + '<linearGradient id="nyFrameLine" x1="0" y1="0" x2="1" y2="1"><stop offset="0" class="season-stop--line-a"></stop><stop offset="0.35" class="season-stop--line-b"></stop><stop offset="0.65" class="season-stop--line-c"></stop><stop offset="1" class="season-stop--line-d"></stop></linearGradient>'
                + '</defs><path class="ny-frame__ring" fill-rule="evenodd"></path><path class="ny-frame__line ny-frame__line--out"></path><path class="ny-frame__line ny-frame__line--in"></path></svg>'
                + '<canvas class="ny-marquee__bulbs"></canvas><canvas class="ny-marquee__glow"></canvas>'
                + `<div class="ny-tree" aria-hidden="true"><div class="ny-tree__halo"></div><img class="ny-tree__body" alt="" draggable="false" src="${A.assetUrl('tree-body.webp')}"><canvas class="ny-tree__live"></canvas></div>`
                + gifts
                + '<div class="ny-marquee__content"><h2 id="ny-marquee-title" class="ny-marquee__title"></h2><p class="ny-marquee__message"></p>'
                + '<div class="ny-marquee__row"><div class="ny-count" role="timer">'
                + `<div class="ny-leader" aria-hidden="true"><div class="ny-leader__sweep"></div><svg class="ny-leader__dial" viewBox="0 0 116 116" focusable="false"><circle class="ny-leader__ring" cx="58" cy="58" r="56"></circle><circle class="ny-leader__ring ny-leader__ring--thin" cx="58" cy="58" r="49"></circle><path class="ny-leader__ticks" d="${dialTicks()}"></path><path class="ny-leader__cross" d="M58 9V107M9 58H107"></path></svg><div class="ny-leader__value"><span class="ny-leader__num"></span><span class="ny-leader__unit"></span></div></div>`
                + `<div class="ny-clock" aria-hidden="true">${unit('hours', ['h0', 'h1'])}${unit('minutes', ['m0', 'm1'])}${unit('seconds', ['s0', 's1'])}</div>`
                + `</div><a class="ny-marquee__cta"><span class="ny-marquee__cta-label"></span>${SVG_ICONS.arrow}</a></div></div>`
                + `<button type="button" class="ny-marquee__close">${SVG_ICONS.close}</button>`
                + '<div class="ny-reveal"><a class="ny-reveal__card"><img class="ny-reveal__poster" alt=""><span class="ny-reveal__tag"></span><span class="ny-reveal__info"><span class="ny-reveal__title"></span><span class="ny-reveal__meta"></span></span></a>'
                + `<button type="button" class="ny-reveal__close">${SVG_ICONS.close}</button></div>`
                + '</section>';

            const q = s => this.host.querySelector(s);
            this.sign = q('.ny-marquee');
            this.title = q('.ny-marquee__title');
            this.message = q('.ny-marquee__message');
            this.count = q('.ny-count');
            this.daysNum = q('.ny-leader__num');
            this.daysUnit = q('.ny-leader__unit');
            this.cta = q('.ny-marquee__cta');
            this.ctaLabel = q('.ny-marquee__cta-label');
            this.closeBtn = q('.ny-marquee__close');
            this.reveal = q('.ny-reveal');
            this.revealLink = q('.ny-reveal__card');
            this.revealPoster = q('.ny-reveal__poster');
            this.revealTag = q('.ny-reveal__tag');
            this.revealTitle = q('.ny-reveal__title');
            this.revealMeta = q('.ny-reveal__meta');
            this.revealClose = q('.ny-reveal__close');
            this.treeBody = q('.ny-tree__body');
            this.treeLiveEl = q('.ny-tree__live');
            this.bulbsEl = q('.ny-marquee__bulbs');
            this.glowEl = q('.ny-marquee__glow');
            this.floorEl = q('.ny-marquee__floor');
            this.auroraEl = q('.ny-marquee__aurora');
            this.giftEls = Array.from(this.host.querySelectorAll('.ny-gift'));
            this.sprigs = new Image();
            this.sprigs.src = A.assetUrl('tree-sprigs.webp');

            /* A slot per digit keeps the flip's four faces in reach. */
            this.flipEls = {};
            this.host.querySelectorAll('.ny-flip').forEach(el => {
                this.flipEls[el.dataset.face] = {
                    el,
                    halfTop: el.querySelector('.ny-flip__half--top .ny-flip__num'),
                    halfBottom: el.querySelector('.ny-flip__half--bottom .ny-flip__num'),
                    flapTop: el.querySelector('.ny-flip__flap--top .ny-flip__num'),
                    flapBottom: el.querySelector('.ny-flip__flap--bottom .ny-flip__num')
                };
            });

            this.listen(this.closeBtn, 'click', () => this.onDismiss());
            this.listen(this.revealClose, 'click', () => this.closeGift(true));
            this.giftEls.forEach((el, i) => {
                this.listen(el, 'click', () => this.toggleGift(i));
                this.listen(el.querySelector('.ny-gift__hit'), 'pointerenter', () => this.wiggle(el));
            });
            this.listen(document, 'pointerdown', event => {
                if (!this.openGift) return;
                const node = event.target;
                if (node?.closest?.('.ny-reveal') || node?.closest?.('.ny-gift')) return;
                this.closeGift(false);
            });
        }

        /* ---------- Copy that depends on the language and the date ---------- */

        plural(key, n) {
            let form = 'other';
            try {
                form = new Intl.PluralRules(this.locale()).select(n);
            } catch {
                // Falls back to the generic form.
            }
            return this.translate(`${key}.${form}`) || this.translate(`${key}.other`);
        }

        update() {
            const days = g.SeasonalThemeService.getDaysUntilPeak(this.season);
            const before = this.secondsLeft() > 0;
            this.isToday = !before && days === 0;
            this.title.textContent = this.translate(before ? 'title' : (days === 0 ? 'title_today' : 'title'));
            this.message.textContent = this.translate(before ? 'message' : (days === 0 ? 'today' : 'after'));
            this.count.hidden = !before;
            this.count.style.display = before ? '' : 'none';
            this.ctaLabel.textContent = this.translate('cta');
            this.cta.setAttribute('href', this.season.ctaHref || '');
            const dismiss = this.translate('dismiss');
            this.closeBtn.setAttribute('aria-label', dismiss);
            this.closeBtn.title = dismiss;
            this.revealClose.setAttribute('aria-label', this.translate('gift_close'));
            this.revealTag.textContent = this.translate('gift_tag');
            const giftLabel = this.translate('gift_open');
            this.giftEls.forEach(el => el.setAttribute('aria-label', giftLabel));
            this.host.querySelectorAll('[data-unit]').forEach(el => {
                if (el.dataset.unit !== 'hours') el.textContent = this.translate(`unit_${el.dataset.unit}`);
            });
            this.shownLeft = null;
            this.renderCountdown();
            this.fx?.setFireworks(this.isToday);
        }

        secondsLeft() {
            return Math.floor((this.season.peak.getTime() - g.SeasonalThemeService.now()) / 1000);
        }

        /* ---------- The countdown: one face change per displayed second ---------- */

        arm() {
            const wait = ((this.season.peak.getTime() - g.SeasonalThemeService.now()) % 1000 + 1000) % 1000;
            this.timer = setTimeout(() => {
                this.tick();
                this.arm();
            }, wait + 12);
        }

        tick() {
            if (this.secondsLeft() <= 0 && !this.count.hidden) this.update();
            this.renderCountdown();
        }

        renderCountdown() {
            const left = this.secondsLeft();
            if (left <= 0 || this.shownLeft === left) return;
            this.shownLeft = left;
            const days = Math.floor(left / 86400), hours = Math.floor(left / 3600) % 24;
            const mins = Math.floor(left / 60) % 60, secs = left % 60;
            const h = pad2(hours), m = pad2(mins), s = pad2(secs);
            const values = { h0: h[0], h1: h[1], m0: m[0], m1: m[1], s0: s[0], s1: s[1] };
            Object.keys(values).forEach(key => {
                const value = values[key], face = this.faces[key], slot = this.flipEls[key];
                if (!face) {
                    this.faces[key] = { cur: value, run: '' };
                    slot.halfTop.textContent = slot.halfBottom.textContent = slot.flapTop.textContent = slot.flapBottom.textContent = value;
                    return;
                }
                if (face.cur === value) return;
                const prev = face.cur;
                face.cur = value;
                face.run = face.run === 'a' ? 'b' : 'a';
                slot.halfTop.textContent = value;
                slot.halfBottom.textContent = prev;
                slot.flapTop.textContent = prev;
                slot.flapBottom.textContent = value;
                slot.el.classList.remove('ny-run-a', 'ny-run-b');
                slot.el.classList.add(`ny-run-${face.run}`);
            });
            if (this.daysNum.textContent !== String(days)) this.daysNum.textContent = String(days);
            const daysLabel = this.plural('days', days);
            if (this.daysUnit.textContent !== daysLabel) this.daysUnit.textContent = daysLabel;
            const hoursLabel = this.host.querySelector('[data-unit="hours"]');
            const hoursText = this.plural('hours', hours);
            if (hoursLabel.textContent !== hoursText) hoursLabel.textContent = hoursText;
            /* Spoken once a minute at most: a screen reader should not read every second. */
            if (secs === 59 || !this.count.getAttribute('aria-label')) {
                this.count.setAttribute('aria-label', this.translate('timer').replace('{days}', `${days} ${daysLabel}`).replace('{hours}', String(hours)).replace('{minutes}', String(mins)));
            }
        }

        /* ---------- Geometry ---------- */

        fitLayout() {
            const width = Math.round(this.host.clientWidth);
            if (!width || width === this.lastWidth) return;
            this.lastWidth = width;
            const name = layoutFor(width), L = LAYOUTS[name];
            const changed = name !== this.layoutName;
            this.layoutName = name;
            const sign = this.sign;
            sign.dataset.layout = name;
            sign.style.height = L.h + 'px';
            const treeX = name === 'stacked' ? Math.round(width / 2) : width - L.treeRight;
            this.treeX = treeX;
            sign.style.setProperty('--ny-tree-x', treeX + 'px');
            sign.style.setProperty('--ny-tree-w', L.treeW + 'px');
            sign.style.setProperty('--ny-tree-h', L.treeH + 'px');

            const geo = A.marqueeGeometry(width, L.h);
            this.host.querySelector('.ny-marquee__panel').style.clipPath = geo.clip;
            const frame = this.host.querySelector('.ny-marquee__frame');
            frame.setAttribute('viewBox', `0 0 ${width} ${L.h}`);
            this.host.querySelector('.ny-frame__ring').setAttribute('d', geo.ring);
            this.host.querySelector('.ny-frame__line--out').setAttribute('d', geo.outer);
            this.host.querySelector('.ny-frame__line--in').setAttribute('d', geo.band);

            const P = A.palette(document.documentElement);
            this.bulbs = A.paintBulbs(this.bulbsEl, P, 10.6, 13, L.gap);
            A.paintSignFloor(this.floorEl, P, treeX);
            this.glowDpr = Math.min(g.devicePixelRatio || 1, 1.5);
            this.glowW = this.glowEl.clientWidth;
            this.glowH = this.glowEl.clientHeight;
            this.glowEl.width = Math.round(this.glowW * this.glowDpr);
            this.glowEl.height = Math.round(this.glowH * this.glowDpr);
            this.glowCtx = this.glowEl.getContext('2d');

            /* Gifts around the tree. */
            this.giftLayout = Gifts.layoutGifts({ cx: treeX, floor: L.h - 34, k: L.k });
            this.giftEls.forEach((el, i) => {
                const m = this.giftLayout[i];
                el.style.left = m.x + 'px';
                el.style.top = m.y + 'px';
                el.style.width = m.w + 'px';
                el.style.height = m.h + 'px';
                el.style.zIndex = String(m.z);
                el.style.setProperty('--ox', m.ox + 'px');
                el.style.setProperty('--oy', m.oy + 'px');
                el.querySelector('.ny-gift__hit').style.clipPath = m.clip;
            });
            this.closeGift(false, true);

            /* The sign's top edge holds snow, except where the tree stands in front of it. */
            const treeLayout = Tree.treeLayout(L.treeW);
            const treeTop = L.h - 10 - L.treeH;
            const half = treeLayout.widthAt(A.clamp((-treeTop - treeLayout.top) / treeLayout.TH, 0, 1)) + 22;
            sign.dataset.snowSurface = '46';
            sign.dataset.snowCarveX = String(treeX);
            sign.dataset.snowCarveHalf = String(Math.round(half));

            if (changed) {
                this.buildTree();
                this.fx?.redraw();
            }
        }

        buildTree() {
            if (!this.fx) return;
            this.tree = Tree.TreeLive(this.treeLiveEl, {
                /* It lights up once per page view, not again after a resize or a theme switch. */
                lit: this.fx.reduced || this.wasLit,
                body: this.treeBody,
                sprigs: this.sprigs,
                onStar: (x, y) => {
                    /* The star lights last and throws a handful of sparks. */
                    const r = this.treeLiveEl.getBoundingClientRect();
                    for (let i = 0; i < 46; i++) {
                        const a = Math.random() * Math.PI * 2, v = 70 + Math.random() * 280;
                        this.fx.emit(r.left + x, r.top + y, Math.cos(a) * v, Math.sin(a) * v - 40, 0.4 + Math.random() * 0.8, 1, 1);
                    }
                }
            });
        }

        /* ---------- Live part: runs on the page's one animation loop ---------- */

        attach(fx) {
            this.offTicker?.();
            this.offAurora?.();
            this.fx = fx;
            this.buildTree();
            fx.setSparklerZone(this.sign);
            fx.setFireworks(this.isToday);
            this.offAurora = fx.addAurora(this.auroraEl);
            this.offTicker = fx.addTicker((t, dt, pointer) => this.draw(t, dt, pointer));
            fx.later(() => {
                this.sign.classList.add('is-lit');
                this.wasLit = true;
            }, 60);
        }

        draw(t, dt, pointer) {
            const rect = this.sign.getBoundingClientRect();
            if (rect.bottom < -160 || rect.top > g.innerHeight + 160) return;

            if (this.tree) {
                const tr = this.treeLiveEl.getBoundingClientRect();
                this.tree.draw(t, dt, { x: pointer.x - tr.left, y: pointer.y - tr.top, vx: pointer.vx, vy: pointer.vy, seen: pointer.seen });
            }

            /* Lamps of the sign: a warm wave runs around the frame. */
            const c = this.glowCtx;
            if (c && this.bulbs) {
                c.setTransform(this.glowDpr, 0, 0, this.glowDpr, 0, 0);
                c.clearRect(0, 0, this.glowW, this.glowH);
                c.globalCompositeOperation = 'lighter';
                if (!this.glowSprite) {
                    this.glowSprite = A.sprites.glow('255,190,104');
                    this.coreSprite = A.sprites.core('255,240,205');
                }
                for (let i = 0; i < this.bulbs.length; i++) {
                    const b = this.bulbs[i];
                    const v = 0.5 + 0.5 * Math.cos(Math.PI * 2 * (b.i / 15 - t * 0.5));
                    const on = 0.16 + 0.84 * v * v * v;
                    const x = 34 + b.x, y = 34 + b.y;
                    c.globalAlpha = on * 0.68;
                    const gs = 24 + on * 26;
                    c.drawImage(this.glowSprite, x - gs / 2, y - gs / 2, gs, gs);
                    c.globalAlpha = 0.25 + on * 0.75;
                    c.drawImage(this.coreSprite, x - 4.5, y - 4.5, 9, 9);
                }
            }
        }

        /* ---------- Gifts ---------- */

        /* Fetched on the first opening only: a page view that opens nothing costs nothing. */
        loadFilms() {
            if (this.filmsRequest) return this.filmsRequest;
            const Service = g.TMDBService;
            const request = Service
                ? new Service().getCatalogPage({ category: 'films', keyword: CHRISTMAS_KEYWORD, pageSize: 30 })
                    .then(page => page?.items || [])
                    .catch(error => {
                        console.warn('NewYearBanner: could not load the gift films', error);
                        return [];
                    })
                : Promise.resolve([]);
            this.filmsRequest = request.then(items => {
                const pool = items.filter(item => item?.tmdbId && item.posterUrl);
                /* Every gift gets its own film, in an order that differs per page view. */
                for (let i = pool.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [pool[i], pool[j]] = [pool[j], pool[i]];
                }
                this.films = pool;
                return pool;
            });
            return this.filmsRequest;
        }

        filmUrl(film) {
            const params = new URLSearchParams({
                resolveTmdbId: String(film.tmdbId),
                source: 'home-tmdb-only',
                title: String(film.name || ''),
                originalTitle: String(film.alternativeName || ''),
                year: String(film.year || ''),
                mediaType: 'movie'
            });
            return `../movie-details/movie-details.html?${params.toString()}`;
        }

        async fillReveal(i) {
            this.revealTitle.textContent = '';
            this.revealMeta.textContent = '';
            this.revealPoster.hidden = true;
            this.revealLink.removeAttribute('href');
            const pool = await this.loadFilms();
            if (this.openGift?.index !== i) return;
            const film = pool.length ? pool[i % pool.length] : null;
            if (!film) {
                /* No connection or nothing found: the gift still leads to a film. */
                this.revealTitle.textContent = this.translate('gift_fallback');
                this.revealLink.setAttribute('href', '../random/random.html');
                return;
            }
            this.revealTitle.textContent = film.name || film.alternativeName || '';
            const rating = Number(film.ratingTmdb);
            this.revealMeta.textContent = [film.year, rating ? `TMDB ${rating.toFixed(1)}` : ''].filter(Boolean).join(' · ');
            this.revealPoster.src = film.posterUrl;
            this.revealPoster.hidden = false;
            this.revealLink.setAttribute('href', this.filmUrl(film));
        }

        placeReveal(i) {
            const m = this.giftLayout[i];
            const width = this.host.clientWidth;
            const cardW = 172, cardH = 258;
            const L = LAYOUTS[this.layoutName];
            const x = A.clamp(Math.round(m.baseX - cardW / 2), 14, width - cardW - 14);
            const y = A.clamp(Math.round(m.topY - cardH + 22 * L.k), this.layoutName === 'stacked' ? 110 : 18, 2000);
            this.reveal.style.left = x + 'px';
            this.reveal.style.top = y + 'px';
        }

        toggleGift(i) {
            if (this.openGift?.index === i) {
                this.closeGift(true);
                return;
            }
            this.closeGift(false);
            this.openTheGift(i);
        }

        openTheGift(i) {
            const el = this.giftEls[i];
            const body = el.querySelector('.ny-gift__body'), lid = el.querySelector('.ny-gift__lid'), light = el.querySelector('.ny-gift__light');
            el.setAttribute('aria-expanded', 'true');
            this.placeReveal(i);
            this.reveal.classList.add('is-shown');
            this.openGift = { index: i, el, anims: [], cardAnim: null };
            this.fillReveal(i);
            if (this.fx?.reduced !== false) {
                lid.style.opacity = '0';
                return;
            }
            const side = i % 2 ? -1 : 1;
            const W = el.offsetWidth;
            const lidAnim = lid.animate([
                { transform: 'translate(0,0) rotate(0deg)', offset: 0, easing: 'cubic-bezier(.2,.8,.3,1)' },
                { transform: 'translate(0,3px) rotate(0deg)', offset: 0.12, easing: 'cubic-bezier(.16,.9,.4,1)' },
                { transform: `translate(${side * W * 0.14}px,-74px) rotate(${side * 22}deg)`, offset: 0.48, easing: 'cubic-bezier(.5,0,.9,.6)' },
                { transform: `translate(${side * W * 0.52}px,6px) rotate(${side * 58}deg)`, offset: 0.82, easing: 'cubic-bezier(.2,.8,.4,1)' },
                { transform: `translate(${side * W * 0.56}px,-5px) rotate(${side * 50}deg)`, offset: 0.91, easing: 'ease-in' },
                { transform: `translate(${side * W * 0.58}px,6px) rotate(${side * 54}deg)`, offset: 1 }
            ], { duration: 980, fill: 'both' });
            const bodyAnim = body.animate([
                { transform: 'scale(1,1)' },
                { transform: 'scale(1.1,0.86)', offset: 0.14 },
                { transform: 'scale(0.94,1.1)', offset: 0.34 },
                { transform: 'scale(1.03,0.97)', offset: 0.56 },
                { transform: 'scale(1,1)' }
            ], { duration: 560, easing: 'ease-out', fill: 'both' });
            const lightAnim = light.animate([
                { opacity: 0, transform: 'translateX(-50%) scaleY(0.2)' },
                { opacity: 1, transform: 'translateX(-50%) scaleY(1)', offset: 0.55 },
                { opacity: 0.8, transform: 'translateX(-50%) scaleY(1)' }
            ], { duration: 720, delay: 150, easing: 'ease-out', fill: 'both' });
            const cardAnim = this.reveal.animate([
                { opacity: 0, transform: 'translateY(120px) scale(0.28) rotate(-5deg)' },
                { opacity: 1, transform: 'translateY(-10px) scale(1.04) rotate(1.4deg)', offset: 0.62 },
                { opacity: 1, transform: 'translateY(2px) scale(0.99) rotate(-0.4deg)', offset: 0.84 },
                { opacity: 1, transform: 'translateY(0) scale(1) rotate(0deg)' }
            ], { duration: 820, delay: 190, easing: 'cubic-bezier(.2,.75,.3,1)', fill: 'both' });
            this.openGift.anims = [lidAnim, bodyAnim, lightAnim, cardAnim];
            this.openGift.cardAnim = cardAnim;
            this.fx.later(() => this.burstFrom(el), 190);
        }

        burstFrom(el) {
            if (!this.fx) return;
            const r = el.getBoundingClientRect();
            const x = r.left + (parseFloat(el.style.getPropertyValue('--ox')) || r.width / 2);
            const y = r.top + (parseFloat(el.style.getPropertyValue('--oy')) || r.height) - el.offsetHeight * 0.34;
            for (let i = 0; i < 70; i++) {
                const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.9, v = 90 + Math.random() * 360;
                this.fx.emit(x + (Math.random() - 0.5) * 22, y, Math.cos(a) * v, Math.sin(a) * v, 0.45 + Math.random() * 0.8, 1, 1);
            }
        }

        closeGift(focusBack, instant) {
            const o = this.openGift;
            if (!o) return;
            this.openGift = null;
            o.el.setAttribute('aria-expanded', 'false');
            const finish = () => {
                this.reveal.classList.remove('is-shown');
                o.el.querySelector('.ny-gift__lid').style.opacity = '';
                o.anims.forEach(an => an.cancel());
            };
            if (instant || !o.cardAnim) {
                finish();
            } else {
                o.anims.forEach(an => an.reverse());
                o.cardAnim.onfinish = finish;
            }
            if (focusBack) o.el.focus({ preventScroll: true });
        }

        wiggle(el) {
            if (this.fx?.reduced !== false || this.openGift?.el === el) return;
            const frames = [
                { transform: 'rotate(0deg) translateY(0)' },
                { transform: 'rotate(-2.6deg) translateY(-3px)', offset: 0.2 },
                { transform: 'rotate(2.2deg) translateY(-3px)', offset: 0.46 },
                { transform: 'rotate(-1.2deg) translateY(-1px)', offset: 0.7 },
                { transform: 'rotate(0deg) translateY(0)' }
            ];
            el.querySelector('.ny-gift__body').animate(frames, { duration: 520, easing: 'ease-out' });
            el.querySelector('.ny-gift__lid').animate(frames, { duration: 520, easing: 'ease-out' });
        }

        /* ---------- Teardown ---------- */

        destroy() {
            clearTimeout(this.timer);
            this.resizeObserver?.disconnect();
            this.offReady?.();
            this.offTicker?.();
            this.offAurora?.();
            this.fx?.setSparklerZone(null);
            this.fx?.setFireworks(false);
            this.offs.forEach(off => off());
            this.offs = [];
            this.host.innerHTML = '';
        }
    }

    g.NewYearBanner = NewYearBanner;
})(window);
