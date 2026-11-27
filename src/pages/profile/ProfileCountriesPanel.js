import { ProfileTastePanel } from './ProfileTastePanel.js';
import { countryName, historicalName } from '../../shared/data/countries.js';
import { WORLD_MAP } from '../../shared/data/worldMap.js';

// The list shows this many countries; «Все N стран» unfolds the rest.
const ROWS_SHOWN = 6;
// A country too small for the map's scale is a square this many map units wide: the only
// circle in the interface is a user's avatar.
const SMALL_SIZE = 8;
const SVG_NS = 'http://www.w3.org/2000/svg';

/** Shade of a country by its count: 1 film, 2–9, 10–49, 50 and more. */
export function countryTier(count) {
    return count >= 50 ? 4 : count >= 10 ? 3 : count >= 2 ? 2 : count >= 1 ? 1 : 0;
}

/**
 * «Страны» of «Статистика»: a world map shaded by how many rated titles came from each
 * country, the countries listed like the genres, and the same films panel a genre opens.
 * The map answers the mouse only; the list is the way for the keyboard and screen readers,
 * and the country chosen there is lit on the map. Counting is `computeCountries`.
 */
export class ProfileCountriesPanel extends ProfileTastePanel {
    get locale() { return this.view.i18n?.currentLocale || 'ru'; }

    /** @param {{countries: Array<{code: string, count: number, average: number}>, elsewhere: Array<{name: string, count: number}>}} result */
    render(body, result) {
        const { countries, elsewhere } = result;
        this.rows = countries;
        this.byCode = new Map(countries.map(row => [row.code, row]));
        if (!countries.length) {
            body.innerHTML = `<p class="taste-empty">${this.escape(this.t('countries_empty'))}</p>`;
            return;
        }
        const legend = [['none', 0], ['one', 1], ['few', 2], ['many', 3], ['most', 4]];
        body.innerHTML = `
            <div class="insight-countries">
                <div class="insight-countries__map">
                    <div class="insight-map">
                        <svg class="insight-map__svg" viewBox="${WORLD_MAP.viewBox}" aria-hidden="true" focusable="false"></svg>
                        <div class="tooltip-surface insight-map__tip" hidden></div>
                    </div>
                    <ul class="insight-map__legend" aria-hidden="true">${legend.map(([key, tier]) => `
                        <li><i data-tier="${tier}"></i>${this.escape(this.t(`countries_legend_${key}`))}</li>`).join('')}
                    </ul>
                    ${elsewhere.length ? `<p class="insight-map__elsewhere">${this.escape(this.t('countries_elsewhere', {
                        list: elsewhere.map(item => `${historicalName(item.name)} — ${this.tn('films_count', item.count)}`).join(', ')
                    }))}</p>` : ''}
                </div>
                <div class="insight-countries__list">
                    <h3 class="insight-subtitle">${this.escape(this.t('countries_most'))}</h3>
                    ${this.renderRows(countries)}
                    ${countries.length > ROWS_SHOWN ? `<button type="button" class="insight-countries__all" aria-expanded="false"></button>` : ''}
                </div>
                <div class="insight-films" id="insightCountryFilms"></div>
            </div>`;
        this.drawMap(body.querySelector('.insight-map__svg'));
        this.tip = body.querySelector('.insight-map__tip');
        this.allButton = body.querySelector('.insight-countries__all');
        this.showAll(false);
        this.bind(body);
        this.allButton?.addEventListener('click', () => this.showAll(this.allButton.getAttribute('aria-expanded') !== 'true'));
    }

    renderRows(countries) {
        const max = countries[0].count;
        return `<ul class="insight-genres insight-countries__rows">${countries.map((row, index) => `
            <li${index < ROWS_SHOWN ? '' : ' data-extra'}>
                <button type="button" class="insight-genres__row${index ? '' : ' is-top'}" data-taste="country" data-value="${this.escape(row.code)}" aria-expanded="false" aria-controls="insightCountryFilms">
                    <span class="insight-genres__name">${this.escape(countryName(row.code, this.locale))}</span>
                    <span class="insight-genres__bar" aria-hidden="true"><i style="width: ${Math.max(2, (row.count / max) * 100)}%"></i></span>
                    <span class="insight-genres__count">${this.escape(row.count)}</span>
                    <span class="insight-genres__average">${this.escape(this.t('genre_average', { n: this.view.formatScore(row.average) }))}</span>
                </button>
            </li>`).join('')}</ul>`;
    }

    showAll(open) {
        if (!this.allButton) return;
        const list = this.allButton.parentElement;
        list.querySelectorAll('[data-extra]').forEach(item => { item.hidden = !open; });
        this.allButton.setAttribute('aria-expanded', String(open));
        this.allButton.textContent = open ? this.t('countries_fewer') : this.tn('countries_all', this.rows.length);
    }

    drawMap(svg) {
        const shape = (tag, attributes) => {
            const element = document.createElementNS(SVG_NS, tag);
            Object.entries(attributes).forEach(([name, value]) => element.setAttribute(name, value));
            return element;
        };
        const countries = shape('g', {});
        const small = shape('g', {});
        this.shapes = new Map();
        for (const { code, d } of WORLD_MAP.countries) {
            const row = code ? this.byCode.get(code) : null;
            const element = shape('path', { class: 'insight-map__country', d, 'data-tier': countryTier(row?.count || 0) });
            if (row) { element.dataset.code = code; this.shapes.set(code, element); }
            countries.appendChild(element);
        }
        for (const row of this.rows) {
            const point = WORLD_MAP.small[row.code];
            if (!point) continue;
            const element = shape('rect', {
                class: 'insight-map__small', x: point[0] - SMALL_SIZE / 2, y: point[1] - SMALL_SIZE / 2,
                width: SMALL_SIZE, height: SMALL_SIZE, rx: 2, 'data-tier': countryTier(row.count), 'data-code': row.code
            });
            this.shapes.set(row.code, element);
            small.appendChild(element);
        }
        // Above every country: drawn on the country itself, its neighbours would cover half the line.
        this.outline = shape('path', { class: 'insight-map__outline' });
        svg.append(countries, small, this.outline);
        svg.addEventListener('mousemove', event => this.hover(event));
        svg.addEventListener('mouseleave', () => this.unhover());
        svg.addEventListener('click', event => {
            const code = event.target.closest?.('[data-code]')?.dataset.code;
            if (code) this.toggleCountry(code);
        });
    }

    hover(event) {
        const element = event.target.closest?.('[data-code]');
        if (!element) { this.unhover(); return; }
        if (this.hovered !== element) {
            this.unhover();
            this.hovered = element;
            element.classList.add('is-hover');
            this.outline.classList.toggle('on-chosen', element.classList.contains('is-chosen'));
            this.outline.setAttribute('d', element.tagName === 'rect' ? this.squareOutline(element) : element.getAttribute('d'));
        }
        const row = this.byCode.get(element.dataset.code);
        this.tip.innerHTML = `<b>${this.escape(countryName(row.code, this.locale))}</b><span>${this.escape(`${this.tn('films_count', row.count)} · ${this.t('genre_average', { n: this.view.formatScore(row.average) })}`)}</span>`;
        this.tip.hidden = false;
        const box = this.tip.parentElement.getBoundingClientRect();
        this.tip.style.left = `${Math.min(Math.max(6, event.clientX - box.left + 12), box.width - this.tip.offsetWidth - 6)}px`;
        this.tip.style.top = `${Math.max(6, event.clientY - box.top - 64)}px`;
    }

    unhover() {
        this.hovered?.classList.remove('is-hover');
        this.hovered = null;
        this.outline?.removeAttribute('d');
        if (this.tip) this.tip.hidden = true;
    }

    squareOutline(element) {
        const r = 3.5;
        const x = Number(element.getAttribute('x')) - 2.5;
        const y = Number(element.getAttribute('y')) - 2.5;
        const side = SMALL_SIZE + 5 - 2 * r;
        return `M${x + r},${y}h${side}a${r},${r} 0 0 1 ${r},${r}v${side}a${r},${r} 0 0 1 -${r},${r}h-${side}a${r},${r} 0 0 1 -${r},-${r}v-${side}a${r},${r} 0 0 1 ${r},-${r}z`;
    }

    /** A press on the map does what a press on the country's row does. */
    toggleCountry(code) {
        const opener = this.openers.find(button => button.dataset.value === code);
        if (!opener) return;
        if (opener.closest('[data-extra]')?.hidden) this.showAll(true);
        if (opener.getAttribute('aria-expanded') === 'true') this.close();
        else this.open(opener);
    }

    open(opener) {
        super.open(opener);
        this.light(opener.dataset.value);
    }

    close() {
        super.close();
        this.light(null);
    }

    light(code) {
        for (const [key, element] of this.shapes || []) element.classList.toggle('is-chosen', key === code);
    }
}
