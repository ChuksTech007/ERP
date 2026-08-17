import './globals.css';

export const metadata = {
  title: "Master's Technology",
  description: 'Point of sale, jobs and books for a framing and portrait shop.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="min-h-full bg-stone-50 text-stone-900 antialiased">{children}</body>
    </html>
  );
}
