# Subtitle browser media fixture

`tiny-h264-aac.mp4` is a synthetic two-second H.264/AAC fixture generated with FFmpeg, copied from the local MediaPlayer test fixture. It contains generated test graphics and a sine wave, with no third-party media.

An equivalent fixture can be regenerated with:

```sh
ffmpeg -f lavfi -i testsrc=size=160x90:rate=10 -f lavfi -i sine=frequency=440:sample_rate=44100 -t 2 -c:v libx264 -pix_fmt yuv420p -c:a aac -movflags +faststart tiny-h264-aac.mp4
```

The test serves this file on its own temporary loopback listener so Chromium processes real media metadata before subtitle selection. Its generated WebVTT captions are defined in the test itself.
