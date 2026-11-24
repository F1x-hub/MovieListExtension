(function (global) {
    'use strict';
    const CHEVRON = '<svg data-icon="CHEVRON_RIGHT" class="player-settings-menu__chevron" aria-hidden="true" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7.5 5L12.5 10L7.5 15"/></svg>';
    const BACK = '<svg data-icon="CHEVRON_LEFT" aria-hidden="true" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12.5 5L7.5 10L12.5 15"/></svg>';
    const CHECK = '<span class="player-settings-menu__option-label"></span><span class="player-settings-menu__check" aria-hidden="true"><svg data-icon="CHECK" aria-hidden="true" width="16" height="16" viewBox="0 0 20 20" fill="none"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 10.6L8 14.6L16 5.4"/></svg></span>';
    function createItem(doc, label, value) {
        const item = doc.createElement('button');
        item.type = 'button'; item.className = 'player-settings-menu__item'; item.setAttribute('role', 'menuitem');
        const title = doc.createElement('span'); title.className = 'player-settings-menu__label'; title.textContent = label;
        const detail = doc.createElement('span'); detail.className = 'player-settings-menu__value'; detail.textContent = value ?? '';
        item.append(title, detail); item.insertAdjacentHTML('beforeend', CHEVRON);
        return item;
    }
    function renderSubmenu({ menu, title, items, onBack, backLabel }) {
        const doc = menu.ownerDocument;
        menu.replaceChildren();
        const header = doc.createElement('button'); header.type = 'button'; header.className = 'player-settings-menu__back';
        header.innerHTML = BACK;
        const text = doc.createElement('span'); text.textContent = title; header.appendChild(text);
        header.setAttribute('aria-label', backLabel);
        header.onclick = event => { event.stopPropagation(); onBack(); menu.querySelector('button')?.focus(); };
        menu.appendChild(header);
        const list = doc.createElement('div'); list.className = 'player-settings-menu__list'; list.setAttribute('role', 'menu');
        for (const item of items) {
            const option = doc.createElement('button'); option.type = 'button'; option.className = 'player-settings-menu__option';
            option.setAttribute('role', 'menuitemradio'); option.setAttribute('aria-checked', String(!!item.isActive));
            option.innerHTML = CHECK; option.querySelector('.player-settings-menu__option-label').textContent = item.label;
            if (item.isActive) option.classList.add('is-active');
            option.onclick = event => { event.stopPropagation(); item.action(); if (item.refreshFn) item.refreshFn(); };
            list.appendChild(option);
        }
        menu.appendChild(list);
        (list.querySelector('[aria-checked="true"]') || header).focus();
    }
    function appendDiagnostics(menu, { label, onOpen }) {
        menu.querySelector('[data-action="diagnostics"]')?.remove();
        const item = createItem(menu.ownerDocument, label, '');
        item.dataset.action = 'diagnostics';
        item.classList.add('player-settings-menu__diagnostics');
        item.querySelector('svg')?.remove();
        item.onclick = event => {
            event.stopPropagation();
            menu.style.display = 'none';
            // Restore focus to the gear before the dialog captures its opener.
            menu.parentElement?.querySelector('.player-settings-button')?.focus();
            onOpen();
        };
        menu.appendChild(item);
    }
    global.PlayerSettingsMenu = Object.freeze({ createItem, renderSubmenu, appendDiagnostics });
})(typeof window === 'undefined' ? globalThis : window);
