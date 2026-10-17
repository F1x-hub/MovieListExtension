Synthetic six-second HLS VOD fixture. No provider content or user data.
Video: generated testsrc, VP9 320x180 at 24 fps, keyframe every 48 frames.
Audio: generated 440 Hz sine, Opus 48 kHz. Three two-second fMP4 segments.
Generated with FFmpeg 9.0.2 on Windows; ffmpeg is not required to run tests.
SHA256SUMS.txt records SHA-256, byte length and filename of each media asset.

Run from this directory to regenerate (only overwrite these synthetic files):
ffmpeg -f lavfi -i testsrc=size=320x180:rate=24 -f lavfi -i sine=frequency=440:sample_rate=48000 -t 6 -c:v libvpx-vp9 -deadline realtime -cpu-used 8 -g 48 -c:a libopus -f hls -hls_time 2 -hls_playlist_type vod -hls_segment_type fmp4 -hls_fmp4_init_filename init.mp4 index.m3u8

Smoke test: npm run test:player-smoke
Default fixture endpoint: http://127.0.0.1:3000. An occupied port causes failure.
For T0 only, use PLAYER_FIXTURE_PORT=0 for a free loopback port. This does not
test the planned A5 DNR exceptions or the real MediaPlayer backend.
