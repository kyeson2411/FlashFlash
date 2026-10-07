// In-process limiter for auth forms. Supabase also rate-limits the Auth API.
// This is an extra, early stop so a shared school computer cannot hammer sign-in.

type Bucket = { times: number[] };

const buckets = new Map<string, Bucket>();

export function tooManyAttempts(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key) ?? { times: [] };
  bucket.times = bucket.times.filter((time) => now - time < windowMs);

  if (bucket.times.length >= limit) {
    buckets.set(key, bucket);
    return true;
  }

  bucket.times.push(now);
  buckets.set(key, bucket);
  return false;
}

export async function clientKey(prefix: string): Promise<string> {
  const { headers } = await import("next/headers");
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || h.get("x-real-ip") || "local";
  return `${prefix}:${ip}`;
}
