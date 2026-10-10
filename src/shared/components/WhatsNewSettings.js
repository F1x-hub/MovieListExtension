import { whatsNew } from '../config/whatsNew.js';
import '../services/WhatsNewService.js';

export function bindWhatsNewSettings({ document = globalThis.document, chrome = globalThis.chrome,
    service = new globalThis.WhatsNewService({ entries: whatsNew }), openDialog } = {}) {
    const button = document.getElementById('whatsNewButton');
    const badge = document.getElementById('whatsNewBadge');
    let revision = 0;
    const refresh = async () => {
        const current = ++revision;
        try {
            const unseen = await service.hasUnseenRelease();
            if (current === revision && badge) badge.hidden = !unseen;
        } catch {
            if (current === revision && badge) badge.hidden = true;
        }
    };
    const onStorage = (changes, area) => {
        if (area === 'local' && changes.whatsNewV1) void refresh();
    };
    button?.addEventListener('click', openDialog);
    chrome.storage.onChanged.addListener(onStorage);
    void refresh();
    const dispose = () => {
        revision++;
        button?.removeEventListener('click', openDialog);
        chrome.storage.onChanged.removeListener(onStorage);
        document.defaultView.removeEventListener('pagehide', dispose);
    };
    document.defaultView.addEventListener('pagehide', dispose);
    return dispose;
}
