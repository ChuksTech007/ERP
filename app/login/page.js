import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import LoginForm from './LoginForm';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  // Somebody already signed in has no business on this screen.
  if (await getSession()) redirect('/');

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-xl font-semibold">Master&rsquo;s Technology</h1>
          <p className="mt-1 text-sm text-stone-600">Sign in to the till.</p>
        </div>
        <div className="rounded-lg border border-stone-200 bg-white p-6">
          <LoginForm />
        </div>
      </div>
    </div>
  );
}
