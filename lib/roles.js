/* What each role is allowed to see, in the words used to the owner.
 *
 * In its own file with NO database or bcrypt import. The staff screen is a
 * client component and needs these labels; anything it imports travels to the
 * browser with it, and `lib/users.js` pulls in better-sqlite3 and bcryptjs —
 * compiled binaries that cannot be sent to a browser and fail the build with
 * an error pointing at the wrong file entirely.
 */

export const ROLES = {
  owner: 'Owner — sees costs, margins and the books',
  manager: 'Manager — runs the shop, no cost prices',
  staff: 'Staff — quotes and sells',
};

/** Just the role word, for a badge next to someone's name. */
export const ROLE_LABELS = {
  owner: 'Owner',
  manager: 'Manager',
  staff: 'Staff',
};
