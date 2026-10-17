(function (global) {
    'use strict';
    const CHEVRON = '<svg class="player-settings-menu__chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>';
    const BACK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>';
    const CHECK = '<span class="player-settings-menu__option-label"></span><span class="player-settings-menu__check" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></span>';
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
