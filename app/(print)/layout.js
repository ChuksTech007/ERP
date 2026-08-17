import '../globals.css';
import { requireUser } from '@/lib/auth';
import PrintButton from './PrintButton';

/* Documents that go on paper.
 *
 * Their own layout, with none of the app's navigation: a claim slip with a
 * menu bar printed across the top is a claim slip that looks like a mistake.
 * The screen-only bits are hidden at print time by `print:hidden`.
 *
 * Still behind the same guard as everything else — these carry customer names
 * and phone numbers.
 */
export default async function PrintLayout({ children }) {
  await requireUser();

  return (
    <div className="mx-auto max-w-[80mm] p-4 text-stone-900 print:max-w-none print:p-0">
      <PrintButton />
      {children}
    </div>
  );
}
