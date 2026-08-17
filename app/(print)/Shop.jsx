import { getSetting } from '@/lib/settings';

/** The shop's own details, as they appear at the top of anything printed. */
export function ShopHeader({ title }) {
  const name = getSetting('shop.name', "Master's Technology");
  const phone = getSetting('shop.phone', '');
  const address = getSetting('shop.address', '');

  return (
    <header className="border-b border-stone-400 pb-2 text-center">
      <h1 className="text-base font-bold uppercase tracking-wide">{name}</h1>
      {address && <p className="text-[10px] leading-tight">{address}</p>}
      {phone && <p className="text-[10px] leading-tight">{phone}</p>}
      {title && <p className="mt-1 text-xs font-semibold uppercase tracking-widest">{title}</p>}
    </header>
  );
}

export function Line({ label, value, bold = false }) {
  return (
    <div className={`flex justify-between gap-2 text-[11px] ${bold ? 'font-bold' : ''}`}>
      <span>{label}</span>
      <span className="text-right tabular-nums">{value}</span>
    </div>
  );
}

export function Rule() {
  return <div className="my-1.5 border-t border-dashed border-stone-400" />;
}
