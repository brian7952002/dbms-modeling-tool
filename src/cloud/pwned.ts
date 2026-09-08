/**
 * Checks a password against the Have I Been Pwned breach corpus.
 *
 * Supabase does this server-side, but only on the Pro plan. This is the same
 * check done from the browser so a free project still catches the case that
 * matters: somebody on the team reusing a password that is already in a
 * breach dump.
 *
 * It is advisory, not enforcement. Someone determined could call the auth API
 * directly and bypass it — real enforcement has to live on the server. That is
 * an honest trade for catching accidental reuse at no cost, and the interface
 * says as much rather than implying a guarantee it cannot make.
 *
 * The password never leaves the browser. Only the first five characters of its
 * SHA-1 are sent, and the response covers every hash sharing that prefix —
 * hundreds of candidates — so the service cannot tell which was asked about.
 */

const RANGE_URL = 'https://api.pwnedpasswords.com/range/';

async function sha1Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-1', bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

export type PwnedResult =
  | { status: 'safe' }
  | { status: 'breached'; count: number }
  /** The service could not be reached; do not block on it. */
  | { status: 'unknown' };

export async function checkPwned(password: string): Promise<PwnedResult> {
  if (!password) return { status: 'unknown' };
  if (typeof crypto === 'undefined' || !crypto.subtle) return { status: 'unknown' };

  try {
    const hash = await sha1Hex(password);
    const prefix = hash.slice(0, 5);
    const suffix = hash.slice(5);

    const response = await fetch(`${RANGE_URL}${prefix}`, {
      // Pads the response with random entries so its size reveals nothing.
      headers: { 'Add-Padding': 'true' },
    });
    if (!response.ok) return { status: 'unknown' };

    const body = await response.text();
    for (const line of body.split('\n')) {
      const [candidate, countText] = line.trim().split(':');
      if (candidate !== suffix) continue;
      const count = Number.parseInt(countText ?? '0', 10);
      // Padded entries are returned with a count of zero.
      return count > 0 ? { status: 'breached', count } : { status: 'safe' };
    }
    return { status: 'safe' };
  } catch {
    return { status: 'unknown' };
  }
}

export function describePwned(result: PwnedResult): string | null {
  if (result.status !== 'breached') return null;
  const times =
    result.count >= 1_000_000
      ? `${Math.round(result.count / 1_000_000)} million times`
      : result.count >= 1000
        ? `${Math.round(result.count / 1000)},000 times`
        : `${result.count} times`;
  return `That password appears in known data breaches ${times}. Pick a different one.`;
}
