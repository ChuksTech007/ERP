/* Who is using the till, and what they are allowed to see.
 *
 * The split that matters here is owner from staff. Staff quote and sell, so
 * they need prices. They do not need to know what the shop pays for a length
 * of oak, and in a small shop that figure travelling is how a supplier's
 * margin ends up common knowledge on the street.
 *
 * So costs and margins are owner-only, and that is enforced on the SERVER —
 * never by hiding a column in the browser. A hidden column is still in the
 * page source.
 */

import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

const COOKIE = 'mt_session';

/* Long enough that staff are not logged out mid-shift, short enough that a
 * till left unlocked overnight is not still logged in the next morning. */
const SESSION_HOURS = 12;

function secret() {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 32) {
    throw new Error(
      'AUTH_SECRET is missing or too short. Run `npm run seed` — it generates one into .env.local.'
    );
  }
  return new TextEncoder().encode(value);
}

/**
 * What travels in the cookie.
 *
 * The role is included so that a page can be rendered without a database
 * lookup on every request — but it is deliberately re-checked against the
 * database for anything that matters. A role in a token is a role as it was
 * at login; someone demoted this morning would otherwise keep owner access
 * until their session expired.
 */
export async function createSession(user) {
  const token = await new SignJWT({ name: user.name, username: user.username, role: user.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_HOURS}h`)
    .sign(secret());

  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,       // JavaScript in the page cannot read it
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_HOURS * 3600,
    // Not `secure`: the shop runs over plain http on its own router, and a
    // secure cookie would simply never be sent, locking everyone out.
    secure: false,
  });
}

export async function destroySession() {
  const jar = await cookies();
  jar.delete(COOKIE);
}

/** The signed-in user, or null. Never throws — callers decide what to do. */
export async function getSession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, secret());
    return { id: payload.sub, name: payload.name, username: payload.username, role: payload.role };
  } catch {
    // Expired or tampered with. Either way there is no session.
    return null;
  }
}

/**
 * Demand a signed-in user.
 *
 * Called at the top of every server action, not only in layouts. A layout
 * guard protects the PAGE; it does nothing for a server action, which is a
 * POST endpoint that anyone can call directly once they know its id. Relying
 * on the layout alone leaves every write in the system open.
 */
export async function requireUser() {
  const user = await getSession();
  if (!user) redirect('/login');
  return user;
}

/** Demand the owner. Used for costs, margins and anything financial. */
export async function requireOwner() {
  const user = await requireUser();
  if (user.role !== 'owner') {
    throw new Error('Only the owner can do that.');
  }
  return user;
}

/** Whether this user may see cost prices and margins. */
export function canSeeCosts(user) {
  return user?.role === 'owner';
}

/** Whether this user may change prices, staff or settings. */
export function canManage(user) {
  return user?.role === 'owner' || user?.role === 'manager';
}
