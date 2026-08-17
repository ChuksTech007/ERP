import Link from 'next/link';

const NAV = [
  { href: '/pricelist', label: 'Price list' },
];

export default function AppLayout({ children }) {
  return (
    <div className="min-h-full">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-3">
          <Link href="/" className="font-semibold tracking-tight">
            Master&rsquo;s Technology
          </Link>
          <nav className="flex gap-4 text-sm text-stone-600">
            {NAV.map((item) => (
              <Link key={item.href} href={item.href} className="hover:text-stone-900">
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
