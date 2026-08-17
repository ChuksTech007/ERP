import Link from 'next/link';
import { requireUser, canSeeCosts } from '@/lib/auth';
import { listUsers } from '@/lib/users';
import { ROLE_LABELS } from '@/lib/roles';
import { AddStaffForm, PasswordForm, RemoveStaffForm } from './StaffForms';

export const dynamic = 'force-dynamic';

export default async function StaffPage() {
  const user = await requireUser();

  /* Only the owner: anyone who can add staff can make themselves an owner and
   * read the books.
   *
   * Said plainly rather than thrown. requireOwner() raises, and a raised error
   * in a page renders "a server error occurred" — which teaches the shop that
   * the software is broken when it is in fact working exactly as intended. */
  if (!canSeeCosts(user)) {
    return (
      <div className="rounded-lg border border-stone-200 bg-white p-6">
        <h1 className="text-lg font-semibold">Staff is the owner&rsquo;s screen</h1>
        <p className="mt-2 text-sm text-stone-600">
          Adding people and changing passwords is kept to the owner. Nothing has gone wrong.
        </p>
        <Link href="/" className="mt-4 inline-block text-sm underline">Back to today</Link>
      </div>
    );
  }

  const staff = listUsers();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Staff</h1>
        <p className="mt-1 text-sm text-stone-600">
          Who can sign in, and what they can see. Everyone gets their own login — a shared one
          means nobody&rsquo;s name is on anything.
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-stone-200 bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
            <tr>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Username</th>
              <th className="px-4 py-2 font-medium">Role</th>
              <th className="px-4 py-2 font-medium">Password</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {staff.map((person) => (
              <tr key={person.id} className="align-top">
                <td className="px-4 py-3 font-medium text-stone-800">
                  {person.name}
                  {person.id === user.id && <span className="ml-2 text-xs text-stone-500">(you)</span>}
                </td>
                <td className="px-4 py-3 text-stone-600">{person.username}</td>
                <td className="px-4 py-3">
                  <span className="rounded bg-stone-100 px-1.5 py-0.5 text-xs text-stone-700">
                    {ROLE_LABELS[person.role] || person.role}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <PasswordForm user={person} self={person.id === user.id} />
                </td>
                <td className="px-4 py-3 text-right">
                  {person.id !== user.id && <RemoveStaffForm user={person} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <AddStaffForm />

      <p className="text-sm text-stone-500">
        Removing someone stops them signing in. It does not erase them — their name is on every
        sale they ever rang up, and those records have to keep pointing at a real person.
      </p>
    </div>
  );
}
