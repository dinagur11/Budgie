// An in-memory sliding-window limiter: at most `limit` hits per key within the last `windowMs`.
// It lives in the process, so it resets on every deploy and counts per instance (fine while the API runs as one instance).
export class SlidingWindowLimiter {
  private hits = new Map<number, number[]>();

  constructor(private limit: number, private windowMs: number) {}

  // records a hit and returns true, or returns false (recording nothing) when the key is over the limit
  tryHit(key: number, now = Date.now()): boolean {
    const since = now - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((t) => t > since);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) this.sweep(since);
    return true;
  }

  // drops keys with no hits left in the window, so the map doesn't grow with every user ever seen
  private sweep(since: number) {
    for (const [key, times] of this.hits) if (!times.some((t) => t > since)) this.hits.delete(key);
  }
}
