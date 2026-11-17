/**
 * Metadata formatting for the MovieDetails "About" tab: finance and The
 * Numbers chart, release status, studios, critic scores, vote counts,
 * label text, and localized country names.
 *
 * Strangler step (plan 2026-10-04, 6.6): methods moved verbatim and
 * installed onto MovieDetailsManager.prototype; they read page helpers
 * such as escapeHtml through `this`. The detailed card template itself
 * (createDetailedMovieCard) still lives in movie-details.js.
 *
 * Uses the global `i18n` that src/shared/i18n/I18n.js assigns to window.
 */

class MovieDetailsMetaRendererMethods {
    formatTheNumbersAmount(value) {
        const amount = Number(value);
        if (!Number.isFinite(amount)) return '';
        return `$${String(Math.round(amount)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}`;
    }

    formatTheNumbersUpdatedAt(value) {
        const timestamp = Number(value);
        if (!Number.isFinite(timestamp) || timestamp <= 0) return '';
        try {
            return new Intl.DateTimeFormat('ru-RU', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            }).format(new Date(timestamp));
        } catch {
            return '';
        }
    }

    renderTheNumbersChart(movie, { inline = false } = {}) {
        const points = movie?.boxOffice?.chart?.points;
        if (!Array.isArray(points) || points.length < 2) return '';

        const width = 720;
        const height = 320;
        const padding = { top: 24, right: 18, bottom: 44, left: 120 };
        const plotWidth = width - padding.left - padding.right;
        const plotHeight = height - padding.top - padding.bottom;
        const numericValues = points.flatMap(point => [
            point.cumulative,
            point.band?.bottom10,
            point.band?.median,
            point.band?.top10
        ].filter(value => Number.isFinite(Number(value)) && Number(value) >= 0));
        const maxValue = Math.max(...numericValues, 0);
        if (!Number.isFinite(maxValue) || maxValue <= 0) return '';

        const hasAmount = value => Number.isFinite(Number(value)) && Number(value) >= 0;
        const xAt = index => padding.left + (index / Math.max(points.length - 1, 1)) * plotWidth;
        const yAt = value => padding.top + plotHeight - (Number(value) / maxValue) * plotHeight;
        const pathFor = getter => {
            let path = '';
            let open = false;
            points.forEach((point, index) => {
                const value = getter(point);
                if (!hasAmount(value)) {
                    open = false;
                    return;
                }
                path += `${open ? 'L' : 'M'}${xAt(index).toFixed(2)},${yAt(value).toFixed(2)} `;
                open = true;
            });
            return path.trim();
        };
        const bandPaths = [];
        let bandSegment = [];
        const flushBand = () => {
            if (bandSegment.length >= 2) {
                const upper = bandSegment.map(point => `${xAt(point.index).toFixed(2)},${yAt(point.top).toFixed(2)}`);
                const lower = bandSegment.slice().reverse().map(point => `${xAt(point.index).toFixed(2)},${yAt(point.bottom).toFixed(2)}`);
                bandPaths.push(`M${upper.join(' L')} L${lower.join(' L')} Z`);
            }
            bandSegment = [];
        };
        points.forEach((point, index) => {
            if (hasAmount(point.band?.top10) && hasAmount(point.band?.bottom10)) {
                bandSegment.push({ index, top: point.band.top10, bottom: point.band.bottom10 });
            } else {
                flushBand();
            }
        });
        flushBand();

        const tickCount = 4;
        const yTicks = Array.from({ length: tickCount + 1 }, (_, index) => {
            const value = maxValue * (index / tickCount);
            const y = yAt(value);
            return `
                <line class="the-numbers-chart__gridline" x1="${padding.left}" y1="${y.toFixed(2)}" x2="${(width - padding.right).toFixed(2)}" y2="${y.toFixed(2)}"></line>
                <text class="the-numbers-chart__axis-label" x="${padding.left - 12}" y="${(y + 4.5).toFixed(2)}" text-anchor="end">${this.escapeHtml(this.formatTheNumbersAmount(value))}</text>`;
        }).join('');

        const tickIndexes = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])];
        const xTicks = tickIndexes.map(index => {
            const date = points[index]?.date || '';
            const label = /^\d{4}-\d{2}-\d{2}$/.test(date)
                ? `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}`
                : date;
            return `<text class="the-numbers-chart__axis-label" x="${xAt(index).toFixed(2)}" y="${height - 14}" text-anchor="middle">${this.escapeHtml(label)}</text>`;
        }).join('');

        const pointTooltips = points.map((point, index) => hasAmount(point.cumulative) ? `
            <circle class="the-numbers-chart__point-hit-area" cx="${xAt(index).toFixed(2)}" cy="${yAt(point.cumulative).toFixed(2)}" r="8" tabindex="0"
                data-chart-index="${index}"
                data-chart-date="${this.escapeHtml(point.date)}"
                data-chart-cume="${point.cumulative}"
                data-chart-median="${hasAmount(point.band?.median) ? point.band.median : ''}"
                data-chart-bottom10="${hasAmount(point.band?.bottom10) ? point.band.bottom10 : ''}"
                data-chart-top10="${hasAmount(point.band?.top10) ? point.band.top10 : ''}"
                aria-label="${this.escapeHtml(point.date)} — ${this.escapeHtml(this.formatTheNumbersAmount(point.cumulative))}">
                <title>${this.escapeHtml(point.date)} · ${this.escapeHtml(this.formatTheNumbersAmount(point.cumulative))}</title>
            </circle>
            <circle class="the-numbers-chart__data-point${index === points.length - 1 ? ' the-numbers-chart__data-point--current' : ''}" cx="${xAt(index).toFixed(2)}" cy="${yAt(point.cumulative).toFixed(2)}" r="${index === points.length - 1 ? '4' : '3'}"></circle>` : '').join('');
        const medianPointMarkup = points.map((point, index) => hasAmount(point.band?.median)
            ? `<circle class="the-numbers-chart__median-point" data-chart-index="${index}" cx="${xAt(index).toFixed(2)}" cy="${yAt(point.band.median).toFixed(2)}" r="2.5"></circle>`
            : '').join('');
        const activePointMarkup = `
                            <g class="the-numbers-chart__active-points" aria-hidden="true" style="display:none">
                                <line class="the-numbers-chart__crosshair" x1="0" y1="${padding.top}" x2="0" y2="${padding.top + plotHeight}"></line>
                                <circle class="the-numbers-chart__active-point the-numbers-chart__active-point--cume" cx="0" cy="0" r="5"></circle>
                                <circle class="the-numbers-chart__active-point the-numbers-chart__active-point--median" cx="0" cy="0" r="4"></circle>
                            </g>`;
        const sourceUrl = this.escapeHtml(movie?.boxOffice?.sourceUrl || '');
        const chartClass = inline ? 'the-numbers-chart the-numbers-chart--inline' : 'the-numbers-chart';

        return `
            <details class="${chartClass}">
                <summary class="the-numbers-chart__summary">
                    <span class="the-numbers-chart__title">Динамика сборов</span>
                    <span class="the-numbers-chart__summary-meta">Domestic · накопительный итог</span>
                    <span class="the-numbers-chart__chevron" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg></span>
                </summary>
                <div class="the-numbers-chart__content">
                    <div class="the-numbers-chart__legend" aria-label="Легенда графика">
                        <span><i class="the-numbers-chart__legend-line the-numbers-chart__legend-line--cume"></i>Сборы</span>
                        <span><i class="the-numbers-chart__legend-line the-numbers-chart__legend-line--median"></i>Median</span>
                        <span><i class="the-numbers-chart__legend-band"></i>Bottom 10% — Top 10%</span>
                    </div>
                    <div class="the-numbers-chart__viewport" data-chart-view-width="${width}" data-chart-plot-left="${padding.left}" data-chart-plot-width="${plotWidth}" data-chart-point-count="${points.length}">
                        <svg class="the-numbers-chart__svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="График накопительных domestic-сборов The Numbers">
                            ${yTicks}
                            <path class="the-numbers-chart__band" d="${bandPaths.join(' ')}"></path>
                            <path class="the-numbers-chart__median" d="${pathFor(point => point.band?.median)}"></path>
                            <path class="the-numbers-chart__cume" d="${pathFor(point => point.cumulative)}"></path>
                            ${medianPointMarkup}
                            ${pointTooltips}
                            ${activePointMarkup}
                            ${xTicks}
                            <text class="the-numbers-chart__axis-title" x="16" y="${padding.top + plotHeight / 2}" text-anchor="middle" transform="rotate(-90 16 ${padding.top + plotHeight / 2})">USD</text>
                        </svg>
                        <div class="the-numbers-chart__tooltip" role="tooltip" hidden></div>
                    </div>
                    <div class="the-numbers-chart__footer">
                        <span>${points.length} точек · данные The Numbers</span>
                        ${sourceUrl ? `<a href="${sourceUrl}" target="_blank" rel="noopener noreferrer">Источник</a>` : ''}
                    </div>
                </div>
            </details>`;
    }

    renderFinanceMetaItem(movie, kinopoiskService = null) {
        const service = kinopoiskService || new KinopoiskService();
        const budgetStr = service.formatCurrency(movie?.budget);
        const feesUsaStr = service.formatCurrency(movie?.fees?.usa);
        const feesWorldStr = service.formatCurrency(movie?.fees?.world);
        const feesRussiaStr = service.formatCurrency(movie?.fees?.russia);
        const boxOffice = movie?.boxOffice;
        const theatrical = boxOffice?.theatrical || {};
        const physicalMedia = boxOffice?.physicalMedia || {};
        const hasAmount = amount => amount !== null
            && amount !== undefined
            && Number.isFinite(Number(amount))
            && Number(amount) > 0;
        const boxOfficeRows = [
            ['США:', theatrical.domestic],
            ['Международные:', theatrical.international],
            ['Мировые:', theatrical.worldwide]
        ].filter(([, amount]) => hasAmount(amount))
            .map(([label, amount]) => [label, this.formatTheNumbersAmount(amount)]);
        const physicalRows = [
            ['DVD:', physicalMedia.dvdSales],
            ['Blu-ray:', physicalMedia.bluRaySales],
            ['Всего:', physicalMedia.total]
        ].filter(([, item]) => hasAmount(item?.amount))
            .map(([label, item]) => [
                label,
                `${this.formatTheNumbersAmount(item.amount)}${item.estimated ? ' <span class="meta-finance-estimated">оценка</span>' : ''}`
            ]);
        const chartHtml = this.renderTheNumbersChart(movie, { inline: true });
        const hasTheNumbersBoxOffice = boxOfficeRows.length > 0;
        const hasKinopoiskFinance = Boolean(
            budgetStr
            || feesRussiaStr
            || (!hasAmount(theatrical.domestic) && feesUsaStr)
            || (!hasAmount(theatrical.worldwide) && feesWorldStr)
        );
        const hasTheNumbers = hasTheNumbersBoxOffice || physicalRows.length > 0 || Boolean(chartHtml);
        if (!hasKinopoiskFinance && !hasTheNumbers) return '';

        const sourceUrl = this.escapeHtml(boxOffice?.sourceUrl || '');
        const updatedAt = this.formatTheNumbersUpdatedAt(boxOffice?.fetchedAt);
        const isStale = boxOffice?.status === 'stale';
        const renderRows = rows => rows.map(([label, value]) => `
            <div class="meta-finance-row"><span class="meta-finance-tag">${label}</span><span class="meta-finance-val">${value}</span></div>
        `).join('');

        return `
            <div class="meta-item meta-item--finance">
                <span class="meta-label">${this.metaLabel('movie_details.meta.finance')}</span>
                <div class="meta-value meta-finance-group">
                    ${hasKinopoiskFinance ? `
                    <div class="meta-finance-subgroup">
                        <span class="meta-finance-heading">Kinopoisk</span>
                        ${renderRows([
                            ['Бюджет:', budgetStr],
                            ...(!hasAmount(theatrical.worldwide) ? [['В мире:', feesWorldStr]] : []),
                            ...(!hasAmount(theatrical.domestic) ? [['В США:', feesUsaStr]] : []),
                            ['В России:', feesRussiaStr]
                        ].filter(([, value]) => value))}
                    </div>` : ''}
                    ${boxOfficeRows.length > 0 ? `
                    <div class="meta-finance-subgroup meta-finance-subgroup--the-numbers">
                        <span class="meta-finance-heading">Кассовые сборы · The Numbers</span>
                        ${renderRows(boxOfficeRows)}
                    </div>` : ''}
                    ${physicalRows.length > 0 ? `
                    <div class="meta-finance-subgroup meta-finance-subgroup--physical">
                        <span class="meta-finance-heading">Продажи физических носителей</span>
                        ${renderRows(physicalRows)}
                    </div>` : ''}
                    ${hasTheNumbers ? `
                    <div class="meta-finance-source ${isStale ? 'meta-finance-source--stale' : ''}">
                        ${isStale ? 'Данные устарели' : (updatedAt ? `Обновлено: ${this.escapeHtml(updatedAt)}` : 'Данные загружены')}
                        ${sourceUrl ? ` · <a href="${sourceUrl}" target="_blank" rel="noopener noreferrer">Источник</a>` : ''}
                    </div>` : ''}
                    ${chartHtml}
                </div>
            </div>`;
    }

    translateStatus(status) {
        if (!status || typeof status !== 'string') return null;
        const s = status.trim();
        const map = {
            'released': 'Выпущен',
            'post production': 'Постпродакшн',
            'in production': 'В производстве',
            'planned': 'Запланирован',
            'returning series': 'Онгоинг',
            'ended': 'Завершён',
            'canceled': 'Отменён',
            'cancelled': 'Отменён',
            'pilot': 'Пилот'
        };
        return map[s.toLowerCase()] || s;
    }

    getStatusBadgeClass(status) {
        if (!status || typeof status !== 'string') return 'default';
        const s = status.trim().toLowerCase();
        if (s === 'released') return 'released';
        if (s === 'in production' || s === 'post production' || s === 'planned') return 'upcoming';
        if (s === 'returning series') return 'ongoing';
        if (s === 'ended' || s === 'canceled' || s === 'cancelled') return 'ended';
        return 'default';
    }

    renderProductionCompanies(companies) {
        if (!Array.isArray(companies) || companies.length === 0) return '';
        const valid = companies.filter(c => c && c.name && typeof c.name === 'string' && c.name.trim().length > 0);
        if (valid.length === 0) return '';

        const visible = valid.slice(0, 6);
        const remaining = valid.length - 6;

        return `
            <div class="production-companies-list">
                ${visible.map(c => `
                    <span class="production-company-pill" title="${this.escapeHtml(c.name)}${c.originCountry ? ` (${this.escapeHtml(c.originCountry)})` : ''}">
                        ${c.logoUrl ? `<img src="${this.escapeHtml(c.logoUrl)}" alt="${this.escapeHtml(c.name)}" class="production-company-logo" data-fallback="company-logo" loading="lazy" decoding="async">` : ''}
                        <span class="production-company-name">${this.escapeHtml(c.name)}</span>
                    </span>
                `).join('')}
                ${remaining > 0 ? `<span class="production-company-more">+${remaining}</span>` : ''}
            </div>
        `;
    }

    renderCriticRatings(criticRatings) {
        if (!criticRatings || typeof criticRatings !== 'object') return '';
        const items = [];
        if (criticRatings.international && Number(criticRatings.international.rating) > 0) {
            const r = parseFloat(Number(criticRatings.international.rating).toFixed(1));
            const v = Number(criticRatings.international.votes) || 0;
            items.push(`Мировые: <strong class="critic-score">${r}%</strong>${v > 0 ? ` <span class="critic-votes">(${v})</span>` : ''}`);
        }
        if (criticRatings.russian && Number(criticRatings.russian.rating) > 0) {
            const r = parseFloat(Number(criticRatings.russian.rating).toFixed(1));
            const v = Number(criticRatings.russian.votes) || 0;
            items.push(`Российские: <strong class="critic-score">${r}%</strong>${v > 0 ? ` <span class="critic-votes">(${v})</span>` : ''}`);
        }
        if (items.length === 0) return '';
        return items.join(' • ');
    }

    // Utility Methods
    formatVotes(num) {
        if (!num) return '0';
        return Utils.formatCompactNumber(num, i18n?.currentLocale);
    }

    metaLabel(key) {
        return String(i18n.get(key) || '').replace(/\s*:\s*$/, '');
    }

    // TMDB stores production countries as English names. Resolve them to a
    // region code once, then let Intl provide the page-language name.
    localizeCountryName(name) {
        const englishName = String(name || '').trim();
        if (!englishName || typeof Intl?.DisplayNames !== 'function') return englishName;
        if (!this.countryCodeIndex) {
            const index = new Map();
            try {
                const english = new Intl.DisplayNames(['en'], { type: 'region' });
                for (let first = 65; first <= 90; first += 1) {
                    for (let second = 65; second <= 90; second += 1) {
                        const code = String.fromCharCode(first, second);
                        const regionName = english.of(code);
                        if (regionName && regionName !== code) index.set(regionName.toLowerCase(), code);
                    }
                }
            } catch {
                // Region names are optional; unknown names are shown as-is.
            }
            [
                ['united states of america', 'US'],
                ['czech republic', 'CZ'],
                ['hong kong', 'HK'],
                ['macao', 'MO'],
                ['macedonia', 'MK'],
                ['north macedonia', 'MK'],
                ['korea', 'KR'],
                ['republic of korea', 'KR'],
                ['russian federation', 'RU'],
                ['turkey', 'TR'],
                ['ivory coast', 'CI'],
                ['palestinian territory', 'PS'],
                ['taiwan', 'TW']
            ].forEach(([alias, code]) => index.set(alias, code));
            this.countryCodeIndex = index;
        }
        const code = this.countryCodeIndex.get(englishName.toLowerCase());
        if (!code) return englishName;
        try {
            const locale = i18n?.currentLocale === 'en' ? 'en' : 'ru';
            const localized = new Intl.DisplayNames([locale], { type: 'region' }).of(code);
            if (!localized) return englishName;
            return locale === 'ru' ? localized.charAt(0).toUpperCase() + localized.slice(1) : localized;
        } catch {
            return englishName;
        }
    }

    // The Numbers chart: the hover tooltip that follows the pointer over the chart.
    setupTheNumbersChartTooltip() {
        if (this._theNumbersChartTooltipEventsSetup) return;
        this._theNumbersChartTooltipEventsSetup = true;

        document.addEventListener('mousemove', event => {
            const viewport = event.target?.closest?.('.the-numbers-chart__viewport');
            if (viewport) this.showTheNumbersChartTooltipAtX(viewport, event.clientX);
        }, true);

        document.addEventListener('mouseout', event => {
            const viewport = event.target?.closest?.('.the-numbers-chart__viewport');
            const relatedViewport = event.relatedTarget?.closest?.('.the-numbers-chart__viewport');
            if (viewport && viewport !== relatedViewport) this.hideTheNumbersChartTooltip();
        }, true);

        document.addEventListener('focusin', event => {
            const point = event.target?.closest?.('.the-numbers-chart__point-hit-area');
            const viewport = point?.closest?.('.the-numbers-chart__viewport');
            const index = Number(point?.dataset?.chartIndex);
            if (viewport && Number.isInteger(index)) this.showTheNumbersChartTooltipAtIndex(viewport, index);
        });

        document.addEventListener('focusout', event => {
            if (event.target?.closest?.('.the-numbers-chart__point-hit-area')) {
                this.hideTheNumbersChartTooltip();
            }
        });
    }

    getTheNumbersChartIndexAtX(viewport, clientX) {
        const svg = viewport?.querySelector?.('.the-numbers-chart__svg');
        const svgRect = svg?.getBoundingClientRect?.();
        const metadata = viewport?.dataset || {};
        const viewBoxWidth = Number(metadata.chartViewWidth);
        const plotLeft = Number(metadata.chartPlotLeft);
        const plotWidth = Number(metadata.chartPlotWidth);
        const pointCount = Number(metadata.chartPointCount);
        if (!svgRect?.width || !Number.isFinite(clientX) || !Number.isFinite(viewBoxWidth)
            || !Number.isFinite(plotLeft) || !Number.isFinite(plotWidth) || !Number.isInteger(pointCount)
            || pointCount < 2) return null;

        const viewX = ((clientX - svgRect.left) / svgRect.width) * viewBoxWidth;
        const normalizedX = Math.max(0, Math.min(1, (viewX - plotLeft) / plotWidth));
        return Math.round(normalizedX * (pointCount - 1));
    }

    showTheNumbersChartTooltipAtX(viewport, clientX) {
        const index = this.getTheNumbersChartIndexAtX(viewport, clientX);
        if (index !== null) this.showTheNumbersChartTooltipAtIndex(viewport, index);
    }

    showTheNumbersChartTooltipAtIndex(viewport, index) {
        const point = viewport?.querySelector?.(`.the-numbers-chart__point-hit-area[data-chart-index="${index}"]`);
        const chart = viewport?.closest?.('.the-numbers-chart');
        const tooltip = chart?.querySelector('.the-numbers-chart__tooltip');
        if (!point || !tooltip) return;

        if (this._theNumbersChartTooltipViewport !== viewport) this.hideTheNumbersChartTooltip();
        const samePoint = this._theNumbersChartTooltipPoint === point;
        this.updateTheNumbersChartHover(viewport, index, point);
        this._theNumbersChartTooltipViewport = viewport;
        this._theNumbersChartTooltipPoint = point;
        if (samePoint) {
            this.positionTheNumbersChartTooltip(point);
            return;
        }

        const rows = [
            ['Cume:', point.dataset.chartCume, 'cume'],
            ['Median:', point.dataset.chartMedian, 'median'],
            ['Bottom 10%:', point.dataset.chartBottom10, 'bottom'],
            ['Top 10%:', point.dataset.chartTop10, 'top']
        ].filter(([, value]) => value !== undefined && value !== '');

        tooltip.innerHTML = `
            <div class="the-numbers-chart__tooltip-date">${this.escapeHtml(point.dataset.chartDate || '')}</div>
            ${rows.map(([label, value, tone]) => `
                <div class="the-numbers-chart__tooltip-row">
                    <span class="the-numbers-chart__tooltip-swatch the-numbers-chart__tooltip-swatch--${tone}" aria-hidden="true"></span>
                    <span class="the-numbers-chart__tooltip-label">${label}</span>
                    <strong>${this.escapeHtml(this.formatTheNumbersAmount(value))}</strong>
                </div>
            `).join('')}`;
        tooltip.hidden = false;
        tooltip.classList.add('is-visible');
        this.positionTheNumbersChartTooltip(point);
    }

    updateTheNumbersChartHover(viewport, index, point) {
        const svg = viewport?.querySelector?.('.the-numbers-chart__svg');
        const activeGroup = svg?.querySelector?.('.the-numbers-chart__active-points');
        const activeCume = activeGroup?.querySelector?.('.the-numbers-chart__active-point--cume');
        const activeMedian = activeGroup?.querySelector?.('.the-numbers-chart__active-point--median');
        const crosshair = activeGroup?.querySelector?.('.the-numbers-chart__crosshair');
        if (!svg || !activeGroup || !activeCume || !activeMedian || !crosshair) return;

        const cumeX = point.getAttribute('cx');
        const cumeY = point.getAttribute('cy');
        const medianPoint = svg.querySelector(`.the-numbers-chart__median-point[data-chart-index="${index}"]`);
        const medianX = medianPoint?.getAttribute('cx');
        const medianY = medianPoint?.getAttribute('cy');
        if (!cumeX || !cumeY) return;

        crosshair.setAttribute('x1', cumeX);
        crosshair.setAttribute('x2', cumeX);
        activeCume.setAttribute('cx', cumeX);
        activeCume.setAttribute('cy', cumeY);
        activeCume.style.display = '';
        if (medianX && medianY) {
            activeMedian.setAttribute('cx', medianX);
            activeMedian.setAttribute('cy', medianY);
            activeMedian.style.display = '';
        } else {
            activeMedian.style.display = 'none';
        }
        activeGroup.style.display = '';
    }

    positionTheNumbersChartTooltip(point) {
        const chart = point?.closest?.('.the-numbers-chart');
        const tooltip = chart?.querySelector('.the-numbers-chart__tooltip');
        const viewport = point?.closest?.('.the-numbers-chart__viewport');
        if (!tooltip || !viewport || tooltip.hidden) return;

        const viewportRect = viewport.getBoundingClientRect();
        const pointRect = point.getBoundingClientRect();
        const clientX = pointRect.left + pointRect.width / 2;
        const clientY = pointRect.top + pointRect.height / 2;
        const gap = 12;
        let left = clientX - viewportRect.left + gap;
        let top = clientY - viewportRect.top - tooltip.offsetHeight - gap;

        if (left + tooltip.offsetWidth > viewportRect.width - 8) {
            left = clientX - viewportRect.left - tooltip.offsetWidth - gap;
        }
        if (left < 8) left = 8;
        if (top < 8) top = clientY - viewportRect.top + gap;
        if (top + tooltip.offsetHeight > viewportRect.height - 8) {
            top = Math.max(8, viewportRect.height - tooltip.offsetHeight - 8);
        }

        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${top}px`;
    }

    hideTheNumbersChartTooltip() {
        const point = this._theNumbersChartTooltipPoint;
        const viewport = this._theNumbersChartTooltipViewport || point?.closest?.('.the-numbers-chart__viewport');
        const chart = viewport?.closest?.('.the-numbers-chart');
        const tooltip = chart?.querySelector('.the-numbers-chart__tooltip');
        const activeGroup = viewport?.querySelector?.('.the-numbers-chart__active-points');
        if (tooltip) {
            tooltip.classList.remove('is-visible');
            tooltip.hidden = true;
        }
        if (activeGroup) activeGroup.style.display = 'none';
        this._theNumbersChartTooltipPoint = null;
        this._theNumbersChartTooltipViewport = null;
    }
}

function installMovieDetailsMetaRenderer(targetClass) {
    const source = MovieDetailsMetaRendererMethods.prototype;
    Object.getOwnPropertyNames(source).forEach(name => {
        if (name === 'constructor') return;
        if (Object.prototype.hasOwnProperty.call(targetClass.prototype, name)) {
            throw new Error(`MovieDetails already defines ${name}`);
        }
        Object.defineProperty(targetClass.prototype, name, Object.getOwnPropertyDescriptor(source, name));
    });
    return targetClass;
}

if (typeof window !== 'undefined') {
    window.MovieDetailsMetaRendererMethods = MovieDetailsMetaRendererMethods;
    window.installMovieDetailsMetaRenderer = installMovieDetailsMetaRenderer;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { MovieDetailsMetaRendererMethods, installMovieDetailsMetaRenderer };
}
