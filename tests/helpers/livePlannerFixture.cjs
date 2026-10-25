// Offline adapter shared by DOM regression tests and the local visual fixture.
// The real planner/controller/service helpers run unchanged; no production DB is used.
function installLivePlannerFixture() {
    const hour = 3600_000;
    const day = new Date(); day.setHours(0, 0, 0, 0);
    const clock = day.getTime() + 16 * hour;
    window.Date.now = () => clock;
    window.CinemaChannel.now = () => clock;
    const normalize = (id, data) => window.CinemaChannel.normalizeChannel(data, { id, docPath: `cinemaSchedule/${id}`, scheduled: true });
    const source = (id, title, from, to, durationMin) => normalize(id, {
        mode: 'movie', title, movie: { kinopoiskId: id === 'first' ? 258687 : 447301, durationSec: durationMin * 60, posterUrl: '' },
        startedAt: new Date(day.getTime() + from * hour), endsAt: new Date(day.getTime() + to * hour), updatedAt: new Date(clock)
    });
    const state = window.liveFixture = {
        items: [source('first', 'Интерстеллар', 18, 20, 120), source('second', 'Начало', 21, 23, 120)],
        writes: [], subscribers: [], sequence: 0
    };
    const notify = () => state.subscribers.forEach(callback => callback([...state.items]));
    window.firebaseManager = { db: {}, getCurrentUser: () => ({ uid: 'offline-admin' }) };
    window.ConfirmDialog = { confirm: async () => true };
    window.PlayerConfig = {};
    window.KinopoiskService = class {
        async searchMovies() { return { docs: [{ id: 258687, name: 'Интерстеллар', year: 2014, duration: 169, posterUrl: '/src/shared/assets/live/standby-pattern.png' }, { id: 447301, name: 'Начало', year: 2010, duration: 148, posterUrl: '/src/shared/assets/live/standby-pattern.png' }] }; }
        async getMovieById(id) { return { id, name: 'Интерстеллар', year: 2014, duration: 169, posterUrl: '/src/shared/assets/live/standby-pattern.png' }; }
    };
    window.CinemaChannelService = class {
        subscribe(callback) { callback(window.CinemaChannel.normalizeChannel(null)); return () => {}; }
        subscribeSchedule(callback) { state.subscribers.push(callback); callback([...state.items]); return () => {}; }
        async sweepFinished() { return 0; }
        async setYoutubeDuration() { return false; }
        async schedule(input, start, end) {
            state.writes.push({ action: 'create', input, start, end });
            const item = normalize(`created-${++state.sequence}`, { ...window.CinemaChannel.buildChannelPayload(input), startedAt: start, endsAt: end, updatedAt: new Date(clock + state.sequence) });
            state.items.push(item); notify(); return item;
        }
        async updateSchedule(item, start, end) {
            state.writes.push({ action: 'update', item, start, end });
            const saved = { ...item, startedAtMs: start.getTime(), endsAtMs: end.getTime(), updatedAtMs: clock + ++state.sequence, updatedAtVersion: `${state.sequence}` };
            state.items = state.items.map(entry => entry.id === item.id ? saved : entry); notify(); return saved;
        }
        async unschedule(id) { state.writes.push({ action: 'delete', id }); state.items = state.items.filter(item => item.id !== id); notify(); }
        async save(input) { state.writes.push({ action: 'manual', input }); }
    };
}
module.exports = { installLivePlannerFixture };
