/**
 * The announce run: play the stamp scene and send the stamped poster in
 * SCHEDULE_ANNOUNCE. The scene, the runtime message and the image encoder are
 * passed in, so Node tests can check it.
 */

/**
 * @param {{
 *   movie: { kinopoiskId?: any, name: string, year?: any, posterUrl?: string, description?: string },
 *   date: string, time: string, scheduledAt: number, rawDateStr: string, settings?: object,
 *   playScene: (options: object) => Promise<{ status: string, blob: Blob|null }>,
 *   sendMessage: (message: object) => Promise<any>,
 *   encodeImage: (blob: Blob) => Promise<{ data: string, contentType: string }>,
 *   onHiddenResult?: (result: { ok: boolean, message?: string, error?: string }) => void
 * }} options
 */
export function runAnnounce({ movie, date, time, scheduledAt, rawDateStr, settings, playScene, sendMessage, encodeImage, onHiddenResult = () => {} }) {
    const sceneOptions = { posterUrl: movie.posterUrl || '', title: movie.name, year: movie.year, date, time, settings };

    let sceneOpen = true;
    const onSend = async (blob) => {
        let result;
        try {
            const message = { type: 'SCHEDULE_ANNOUNCE', movie, scheduledAt, rawDateStr };
            // Without a stamped image the bot posts the poster by URL, as before.
            if (blob) message.stampImage = await encodeImage(blob);
            const response = await sendMessage(message);
            result = response?.success
                ? { ok: true, message: `Анонс запланирован на ${rawDateStr}` }
                : { ok: false, error: response?.error || 'Ошибка при планировании' };
        } catch (error) {
            console.error('[MovieDetails] Announce send error:', error);
            result = { ok: false, error: error?.name === 'RangeError' ? 'Картинка со штампом больше 3 МБ' : 'Не удалось отправить задание. Убедитесь, что бот запущен.' };
        }
        // Closed while the send was running: the scene cannot show the outcome.
        if (!sceneOpen) onHiddenResult(result);
        return result;
    };
    return playScene({ ...sceneOptions, onSend }).finally(() => { sceneOpen = false; });
}
