'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { parseAmount } from '@/lib/money';
import { createQuote, acceptQuote, moveStage, collectJob, cancelJob } from '@/lib/jobs';

const money = (formData, field) => {
  const raw = formData.get(field);
  if (raw == null || String(raw).trim() === '') return 0;
  return parseAmount(raw);
};

export async function saveQuote(_previous, formData) {
  const user = await requireUser();

  let items;
  try {
    items = JSON.parse(String(formData.get('items') || '[]'));
  } catch {
    return { ok: false, errors: ['The pieces on this quote could not be read.'] };
  }

  const result = createQuote(
    {
      customerId: String(formData.get('customerId') || '') || null,
      customer: {
        name: String(formData.get('customerName') || ''),
        phone: String(formData.get('customerPhone') || ''),
      },
      items,
      notes: String(formData.get('notes') || '') || null,
      promisedAt: String(formData.get('promisedAt') || '') || null,
      userId: user.id,
    },
    {}
  );

  if (!result.ok) return result;
  revalidatePath('/jobs');
  redirect(`/jobs/${result.id}`);
}

export async function accept(_previous, formData) {
  const user = await requireUser();
  const jobId = String(formData.get('jobId'));

  let custody = [];
  try {
    custody = JSON.parse(String(formData.get('custody') || '[]'));
  } catch {
    return { ok: false, errors: ['The intake list could not be read.'] };
  }

  let result;
  try {
    result = acceptQuote(
      {
        jobId,
        depositKobo: money(formData, 'deposit'),
        method: String(formData.get('method') || 'cash'),
        custody,
        userId: user.id,
      },
      {}
    );
  } catch (error) {
    return { ok: false, errors: [error.message] };
  }

  if (result.ok) revalidatePath(`/jobs/${jobId}`);
  return result;
}

export async function stage(formData) {
  const user = await requireUser();
  const jobId = String(formData.get('jobId'));

  moveStage(
    { jobId, stage: String(formData.get('stage')), note: String(formData.get('note') || '') || null, userId: user.id },
    {}
  );

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath('/jobs');
}

export async function collect(_previous, formData) {
  const user = await requireUser();
  const jobId = String(formData.get('jobId'));

  let result;
  try {
    result = collectJob(
      {
        jobId,
        paymentKobo: money(formData, 'payment'),
        method: String(formData.get('method') || 'cash'),
        releasedTo: String(formData.get('releasedTo') || ''),
        releaseNote: String(formData.get('releaseNote') || '') || null,
        userId: user.id,
      },
      {}
    );
  } catch (error) {
    return { ok: false, errors: [error.message] };
  }

  if (result.ok) {
    revalidatePath(`/jobs/${jobId}`);
    revalidatePath('/jobs');
  }
  return result;
}

export async function cancel(formData) {
  const user = await requireUser();
  const jobId = String(formData.get('jobId'));

  cancelJob({ jobId, reason: String(formData.get('reason') || ''), userId: user.id }, {});
  revalidatePath(`/jobs/${jobId}`);
}
