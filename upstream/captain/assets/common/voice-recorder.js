/* Complete recording segments make paused previews playable on Android and iOS. */
(function (win) {
  "use strict";
  const limit = 30000;
  const fail = () =>
    Error(
      win.I18N?.t("Recording failed. Please record again.") ||
        "Recording failed. Please record again.",
    );
  const dataURL = (blob) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(fail());
      reader.readAsDataURL(blob);
    });
  async function join(previous, next) {
    if (!previous) return next;
    const Audio = win.AudioContext || win.webkitAudioContext;
    if (!Audio) throw fail();
    const context = new Audio();
    try {
      const buffers = [];
      for (const blob of [previous, next])
        buffers.push(await context.decodeAudioData(await blob.arrayBuffer()));
      const rate = 16000,
        samples = Math.min(
          rate * 30,
          buffers.reduce((n, b) => n + Math.round(b.duration * rate), 0),
        );
      const bytes = new ArrayBuffer(44 + samples * 2),
        view = new DataView(bytes);
      const text = (at, value) =>
        [...value].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
      text(0, "RIFF");
      view.setUint32(4, 36 + samples * 2, true);
      text(8, "WAVE");
      text(12, "fmt ");
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, rate, true);
      view.setUint32(28, rate * 2, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      text(36, "data");
      view.setUint32(40, samples * 2, true);
      let offset = 0;
      for (const buffer of buffers) {
        const channels = Array.from(
          { length: buffer.numberOfChannels },
          (_, i) => buffer.getChannelData(i),
        );
        const length = Math.min(
          samples - offset,
          Math.round(buffer.duration * rate),
        );
        for (let i = 0; i < length; i++) {
          const at = (i * buffer.sampleRate) / rate,
            left = Math.min(buffer.length - 1, Math.floor(at));
          const right = Math.min(buffer.length - 1, left + 1),
            fraction = at - left;
          const value = Math.max(
            -1,
            Math.min(
              1,
              channels.reduce(
                (n, ch) => n + ch[left] * (1 - fraction) + ch[right] * fraction,
                0,
              ) / channels.length,
            ),
          );
          view.setInt16(
            44 + (offset + i) * 2,
            Math.round(value * (value < 0 ? 32768 : 32767)),
            true,
          );
        }
        offset += length;
      }
      return new Blob([bytes], { type: "audio/wav" });
    } finally {
      await context.close();
    }
  }
  class VoiceRecorder {
    constructor({ saved, changed, error, initial } = {}) {
      this.saved = saved;
      this.changed = changed;
      this.error = error;
      this.duration = initial?.duration || 0;
      this.peaks = initial?.peaks || [];
      this.initial = initial?.data || null;
      this.state = "idle";
      this.generation = 0;
    }
    elapsed() {
      return Math.min(
        limit,
        this.duration +
          (this.state === "recording" ? performance.now() - this.started : 0),
      );
    }
    cleanup() {
      clearInterval(this.timer);
      this.stream?.getTracks().forEach((track) => track.stop());
      this.stream = null;
      this.audio?.close().catch(() => {});
      this.audio = null;
    }
    async start() {
      if (this.state !== "idle" || this.duration >= limit) return;
      const generation = ++this.generation;
      const previousDuration = this.duration,
        previousData = this.initial,
        previousPeaks = this.peaks.slice();
      this.state = "opening";
      this.changed?.();
      try {
        if (!navigator.mediaDevices?.getUserMedia || !win.MediaRecorder)
          throw Object.assign(fail(), { name: "NotAllowedError" });
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false,
        });
        if (generation !== this.generation || document.hidden) {
          stream.getTracks().forEach((t) => t.stop());
          if (generation === this.generation) this.state = "idle";
          return;
        }
        this.stream = stream;
        const chunks = [],
          recorder = (this.recorder = new MediaRecorder(stream, {
            audioBitsPerSecond: 32000,
          }));
        this.done = new Promise((resolve) => {
          this.resolve = resolve;
        });
        recorder.ondataavailable = (event) => {
          if (event.data.size) chunks.push(event.data);
        };
        recorder.onerror = () => {
          this.failed = true;
          this.error?.(fail());
          this.pause();
        };
        recorder.onstop = async () => {
          this.cleanup();
          try {
            if (generation !== this.generation || this.failed) return;
            const part = new Blob(chunks, { type: recorder.mimeType });
            if (!part.size) throw fail();
            const previous = this.initial
              ? await (await fetch(this.initial)).blob()
              : null;
            const blob = await join(previous, part);
            if (blob.size > 1000000) throw fail();
            const data = await dataURL(blob);
            if (generation !== this.generation) return;
            await this.saved?.({
              data,
              duration: this.duration,
              peaks: this.peaks.slice(-48),
            });
            if (generation === this.generation) this.initial = data;
          } catch (error) {
            this.error?.(error);
            this.failed = true;
          } finally {
            if (generation === this.generation && this.failed) {
              this.initial = previousData;
              this.duration = previousDuration;
              this.peaks = previousPeaks;
            }
            this.state = "idle";
            this.recorder = null;
            this.resolve(!this.failed);
            this.changed?.();
          }
        };
        recorder.start();
        this.started = performance.now();
        this.state = "recording";
        this.failed = false;
        try {
          const Audio = win.AudioContext || win.webkitAudioContext;
          this.audio = new Audio();
          this.analyser = this.audio.createAnalyser();
          this.analyser.fftSize = 256;
          this.audio.createMediaStreamSource(stream).connect(this.analyser);
          this.samples = new Uint8Array(this.analyser.fftSize);
        } catch {
          this.analyser = null;
        }
        this.timer = setInterval(() => {
          if (this.analyser) {
            this.analyser.getByteTimeDomainData(this.samples);
            this.peaks.push(
              Math.max(
                0.06,
                Math.sqrt(
                  this.samples.reduce(
                    (sum, v) => sum + ((v - 128) / 128) ** 2,
                    0,
                  ) / this.samples.length,
                ),
              ),
            );
            if (this.peaks.length > 48) this.peaks.shift();
          }
          this.changed?.();
          if (this.elapsed() >= limit) this.pause();
        }, 100);
      } catch (error) {
        if (generation === this.generation) {
          this.cleanup();
          this.state = "idle";
          this.error?.(error);
        }
      } finally {
        this.changed?.();
      }
    }
    pause() {
      if (this.state === "opening") {
        this.generation++;
        this.state = "idle";
        this.changed?.();
        return Promise.resolve(true);
      }
      if (this.state === "saving") return this.done;
      if (this.state !== "recording") return Promise.resolve(true);
      this.duration = this.elapsed();
      this.state = "saving";
      clearInterval(this.timer);
      this.recorder.stop();
      this.changed?.();
      return this.done;
    }
    async discard() {
      this.generation++;
      const done = this.pause();
      this.cleanup();
      await done;
      this.initial = null;
      this.duration = 0;
      this.peaks = [];
      this.state = "idle";
      this.changed?.();
    }
  }
  win.CaptainVoiceRecorder = VoiceRecorder;
})(window);
