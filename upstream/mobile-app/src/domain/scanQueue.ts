/** Bounded, ordered HID input. A barcode is never dropped because another is saving. */
export class ScanQueue {
  private waiting: {
    value: string;
    resolve: (value: string) => void;
    reject: (error: unknown) => void;
  }[] = [];
  private running = false;
  constructor(
    private scan: (value: string) => Promise<string>,
    private limit = 32,
  ) {}
  get pending() {
    return this.waiting.length + Number(this.running);
  }
  submit(value: string): Promise<string> {
    if (this.pending >= this.limit)
      return Promise.reject(new Error("scannerPaused"));
    const result = new Promise<string>((resolve, reject) =>
      this.waiting.push({ value, resolve, reject }),
    );
    void this.drain();
    return result;
  }
  cancel() {
    for (const entry of this.waiting.splice(0))
      entry.reject(new Error("scannerPaused"));
    // An already-started atomic cart write finishes; never pretend it rolled back.
  }
  private async drain() {
    if (this.running) return;
    this.running = true;
    while (this.waiting.length) {
      const entry = this.waiting.shift()!;
      try {
        entry.resolve(await this.scan(entry.value));
      } catch (error) {
        entry.reject(error);
      }
    }
    this.running = false;
  }
}
