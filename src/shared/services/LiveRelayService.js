/**
 * LiveRelayService - fallback «Эфир» relay from the admin's browser (WebRTC mesh).
 *
 * For viewers whose country or network blocks every video source, the admin can
 * share their own tab: each viewer gets a direct peer-to-peer stream from the
 * admin. No media server is involved, so it is free but sized for a handful of
 * viewers (the admin's upload is split between them).
 *
 * Signaling lives in Firestore and is kept tiny:
 *   liveRelay/current                   { active, sessionId, startedAt, updatedBy }  (admin)
 *   liveRelay/current/peers/{viewerUid} { sessionId, state, offer?, answer?, updatedAt }
 * Non-trickle ICE (complete SDP per side) means ~3 writes per viewer join. Peer
 * docs are deleted when a viewer leaves and swept when the admin starts or stops.
 */
(function () {
    const ROOT = 'liveRelay';
    const CURRENT = 'current';
    const PEERS = 'peers';
    const ICE_SERVERS = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
    const MAX_BITRATE = 2_500_000; // ~720p; keeps 3-4 viewers within a home upload
    const GATHER_TIMEOUT_MS = 4000;

    function randomId() {
        const bytes = new Uint8Array(12);
        crypto.getRandomValues(bytes);
        return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    }

    /** Resolves once ICE gathering is done (or after a timeout with what we have). */
    function waitForIce(pc) {
        if (pc.iceGatheringState === 'complete') return Promise.resolve();
        return new Promise(resolve => {
            const timer = setTimeout(done, GATHER_TIMEOUT_MS);
            function done() {
                clearTimeout(timer);
                pc.removeEventListener('icegatheringstatechange', check);
                resolve();
            }
            function check() { if (pc.iceGatheringState === 'complete') done(); }
            pc.addEventListener('icegatheringstatechange', check);
        });
    }

    function plainSdp(description) {
        return description ? { type: description.type, sdp: description.sdp } : null;
    }

    function isValidSdp(value, type) {
        return Boolean(value && value.type === type && typeof value.sdp === 'string' && value.sdp.length < 200_000);
    }

    class LiveRelayService {
        constructor(firebaseManager) {
            this.firebaseManager = firebaseManager;
        }

        get db() { return this.firebaseManager.db; }
        get currentRef() { return this.db.collection(ROOT).doc(CURRENT); }
        get peersRef() { return this.currentRef.collection(PEERS); }
        get serverTime() { return firebase.firestore.FieldValue.serverTimestamp(); }
        uid() { return this.firebaseManager.getCurrentUser?.()?.uid || ''; }

        /** Everyone: is a relay on, and which session. */
        subscribeStatus(onStatus, onError) {
            return this.currentRef.onSnapshot(snapshot => {
                const data = snapshot.exists ? snapshot.data() : null;
                onStatus(data?.active === true && /^[0-9a-f]{24}$/.test(String(data.sessionId || ''))
                    ? { active: true, sessionId: data.sessionId }
                    : { active: false, sessionId: '' });
            }, error => { if (typeof onError === 'function') onError(error); });
        }

        async sweepPeers() {
            const snapshot = await this.peersRef.get();
            await Promise.all(snapshot.docs.map(doc => doc.ref.delete().catch(() => {})));
        }

        // ---- Admin side -----------------------------------------------------------

        /**
         * Starts sharing `stream` with every viewer who asks for it.
         * @returns {Promise<{ stop: () => Promise<void>, viewerCount: () => number }>}
         */
        async startHosting(stream, { onViewersChange } = {}) {
            const sessionId = randomId();
            await this.sweepPeers();
            await this.currentRef.set({ active: true, sessionId, startedAt: this.serverTime, updatedBy: this.uid() });

            const peers = new Map(); // viewerUid -> RTCPeerConnection
            const notify = () => { if (typeof onViewersChange === 'function') onViewersChange(peers.size); };

            const closePeer = (viewerUid) => {
                const pc = peers.get(viewerUid);
                if (!pc) return;
                peers.delete(viewerUid);
                try { pc.close(); } catch { /* already closed */ }
                notify();
            };

            const answerViewer = async (doc) => {
                const viewerUid = doc.id;
                closePeer(viewerUid);
                const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
                peers.set(viewerUid, pc);
                notify();
                stream.getTracks().forEach(track => pc.addTrack(track, stream));
                pc.getSenders().forEach(sender => {
                    if (sender.track?.kind !== 'video') return;
                    const params = sender.getParameters();
                    params.encodings = params.encodings?.length ? params.encodings : [{}];
                    params.encodings[0].maxBitrate = MAX_BITRATE;
                    sender.setParameters(params).catch(() => {});
                });
                pc.addEventListener('connectionstatechange', () => {
                    if (['failed', 'closed'].includes(pc.connectionState)) closePeer(viewerUid);
                });
                await pc.setLocalDescription(await pc.createOffer());
                await waitForIce(pc);
                await doc.ref.set({ sessionId, state: 'offered', offer: plainSdp(pc.localDescription), updatedAt: this.serverTime }, { merge: true });
            };

            const unsubscribe = this.peersRef.onSnapshot(snapshot => {
                snapshot.docChanges().forEach(change => {
                    const data = change.doc.data() || {};
                    if (change.type === 'removed' || data.sessionId !== sessionId) {
                        if (change.type === 'removed') closePeer(change.doc.id);
                        return;
                    }
                    if (data.state === 'request') {
                        answerViewer(change.doc).catch(error => {
                            console.warn('[LiveRelay] Could not offer to a viewer:', error);
                            closePeer(change.doc.id);
                        });
                    } else if (data.state === 'answered' && isValidSdp(data.answer, 'answer')) {
                        const pc = peers.get(change.doc.id);
                        if (pc && pc.signalingState === 'have-local-offer') {
                            pc.setRemoteDescription(data.answer).catch(error => console.warn('[LiveRelay] Bad answer:', error));
                        }
                    }
                });
            });

            // Sharing stopped from the browser's own «Stop sharing» bar ends the relay too.
            let stopped = false;
            const stop = async () => {
                if (stopped) return;
                stopped = true;
                unsubscribe();
                [...peers.keys()].forEach(closePeer);
                stream.getTracks().forEach(track => track.stop());
                await this.currentRef.set({ active: false, sessionId: '', startedAt: this.serverTime, updatedBy: this.uid() }).catch(() => {});
                await this.sweepPeers().catch(() => {});
            };
            stream.getVideoTracks().forEach(track => track.addEventListener('ended', () => { stop(); }));

            return { stop, viewerCount: () => peers.size };
        }

        // ---- Viewer side ----------------------------------------------------------

        /**
         * Joins the admin's relay and calls `onStream(mediaStream)` when video arrives.
         * @returns {Promise<{ leave: () => Promise<void> }>}
         */
        async join(sessionId, { onStream, onState } = {}) {
            const viewerUid = this.uid();
            if (!viewerUid) throw new Error('Войдите в аккаунт, чтобы смотреть трансляцию ведущего');
            const ref = this.peersRef.doc(viewerUid);
            const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
            const report = state => { if (typeof onState === 'function') onState(state); };

            pc.addEventListener('track', event => {
                const [stream] = event.streams;
                if (stream && typeof onStream === 'function') onStream(stream);
            });
            pc.addEventListener('connectionstatechange', () => report(pc.connectionState));

            let answered = false;
            const unsubscribe = ref.onSnapshot(async snapshot => {
                const data = snapshot.exists ? snapshot.data() : null;
                if (!data || data.sessionId !== sessionId || answered) return;
                if (data.state !== 'offered' || !isValidSdp(data.offer, 'offer')) return;
                answered = true;
                try {
                    await pc.setRemoteDescription(data.offer);
                    await pc.setLocalDescription(await pc.createAnswer());
                    await waitForIce(pc);
                    await ref.set({ sessionId, state: 'answered', answer: plainSdp(pc.localDescription), updatedAt: this.serverTime }, { merge: true });
                } catch (error) {
                    console.warn('[LiveRelay] Could not answer the relay offer:', error);
                    report('failed');
                }
            });

            report('connecting');
            await ref.set({ sessionId, state: 'request', offer: null, answer: null, updatedAt: this.serverTime });

            let left = false;
            const leave = async () => {
                if (left) return;
                left = true;
                unsubscribe();
                try { pc.close(); } catch { /* already closed */ }
                await ref.delete().catch(() => {});
            };
            window.addEventListener('pagehide', () => { leave(); }, { once: true });
            return { leave };
        }
    }

    const api = { LiveRelayService, isValidSdp };
    if (typeof window !== 'undefined') Object.assign(window, { LiveRelayService });
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
