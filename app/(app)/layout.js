import Link from 'next/link';
import { requireUser, canSeeCosts } from '@/lib/auth';
import { signOut } from '../login/actions';

/* Guards every page inside this group.
 *
 * Note what this does NOT do: it does not protect server actions. Those are
 * POST endpoints reachable directly once their id is known, and a layout
 * never runs for them. Each action calls requireUser() for itself. */
export default async function AppLayout({ children }) {
  const user = await requireUser();

  const nav = [
    { href: '/', label: 'Today' },
    { href: '/jobs', label: 'Jobs' },
    { href: '/customers', label: 'Customers' },
    { href: '/stock', label: 'Stock' },
    { href: '/pricelist', label: 'Price list' },
    { href: '/money', label: 'Money' },
  ];

  return (
    <div className="min-h-full">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-3">
          <Link href="/" className="font-semibold tracking-tight">
            Master&rsquo;s Technology
          </Link>

          <nav className="flex flex-1 gap-4 text-sm text-stone-600">
            {nav.map((item) => (
              <Link key={item.href} href={item.href} className="hover:text-stone-900">
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-3 text-sm">
            <span className="text-stone-600">
              {user.name}
              {canSeeCosts(user) && (
                <span className="ml-2 rounded bg-stone-100 px-1.5 py-0.5 text-xs text-stone-600">
                  owner
                </span>
              )}
            </span>
            <form action={signOut}>
              <button className="text-stone-500 hover:text-stone-900">Sign out</button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
