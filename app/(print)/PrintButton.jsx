'use client';

export default function PrintButton() {
  return (
    <div className="mb-4 flex gap-2 print:hidden">
      <button
        onClick={() => window.print()}
        className="rounded bg-stone-900 px-4 py-2 text-sm font-medium text-white"
      >
        Print
      </button>
      <button
        onClick={() => window.history.back()}
        className="rounded border border-stone-300 px-4 py-2 text-sm"
      >
        Back
      </button>
    </div>
  );
}
