export type RateLimitDecision = { allowed: boolean; retryAfterSeconds: number; remaining: number };

export interface RateLimitService {
  check(scope: string, key: string, limit: number, windowMs: number): RateLimitDecision;
}

type Bucket = { count: number; resetAt: number };

export class InMemoryRateLimitService implements RateLimitService {
  private readonly buckets = new Map<string, Bucket>();

  check(scope: string, key: string, limit: number, windowMs: number): RateLimitDecision {
    const now = Date.now();
    const bucketKey = scope + ":" + key;
    const current = this.buckets.get(bucketKey);
    const bucket = !current || current.resetAt <= now
      ? { count: 0, resetAt: now + windowMs }
      : current;

    bucket.count += 1;
    this.buckets.set(bucketKey, bucket);

    if (this.buckets.size > 5_000) {
      for (const [storedKey, stored] of this.buckets) {
        if (stored.resetAt <= now) this.buckets.delete(storedKey);
      }
    }

    return {
      allowed: bucket.count <= limit,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
      remaining: Math.max(0, limit - bucket.count),
    };
  }
}

export const rateLimitService: RateLimitService = new InMemoryRateLimitService();

export const checkRateLimit = (scope: string, key: string, limit: number, windowMs: number): RateLimitDecision =>
  rateLimitService.check(scope, key, limit, windowMs);
