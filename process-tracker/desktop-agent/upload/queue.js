'use strict';

// Exponential backoff schedule in seconds
const BACKOFF_SECONDS = [30, 60, 120, 300];
const MAX_ATTEMPTS_BEFORE_ALERT = 10;

/**
 * UploadQueue — manages retry logic for a single upload task type.
 * Each queue runs its uploadFn on a fixed interval, with backoff on failure.
 */
class UploadQueue {
  constructor(name, uploadFn, onAlert) {
    this.name = name;
    this.uploadFn = uploadFn;
    this.onAlert = onAlert || null;
    this.consecutiveFailures = 0;
    this.nextRetryAt = 0;
    this.timer = null;
    this.running = false;
  }

  start(intervalMs = 30 * 1000) {
    this.intervalMs = intervalMs;
    this.timer = setInterval(() => this.process(), intervalMs);
    // Run immediately on start
    setTimeout(() => this.process(), 2000);
    console.log(`[upload-queue:${this.name}] Started (interval: ${intervalMs / 1000}s)`);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async process() {
    if (this.running) return; // Prevent overlapping runs
    if (Date.now() < this.nextRetryAt) return; // Still in backoff

    this.running = true;
    try {
      await this.uploadFn();
      this.consecutiveFailures = 0;
      this.nextRetryAt = 0;
    } catch (err) {
      this.consecutiveFailures++;
      const backoffIdx = Math.min(this.consecutiveFailures - 1, BACKOFF_SECONDS.length - 1);
      const delaySec = BACKOFF_SECONDS[backoffIdx];
      this.nextRetryAt = Date.now() + delaySec * 1000;

      console.error(
        `[upload-queue:${this.name}] Upload failed (attempt ${this.consecutiveFailures}): ${err.message}. ` +
        `Retrying in ${delaySec}s`
      );

      if (this.consecutiveFailures >= MAX_ATTEMPTS_BEFORE_ALERT && this.onAlert) {
        this.onAlert(`Upload has failed ${this.consecutiveFailures} times: ${err.message}`);
      }
    } finally {
      this.running = false;
    }
  }

  /** Force an immediate upload attempt (ignores backoff). */
  async flush() {
    this.nextRetryAt = 0;
    await this.process();
  }
}

module.exports = { UploadQueue };
