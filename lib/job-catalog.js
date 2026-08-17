/* Job vocabulary, with no database import, so client components can use it. */

export const STAGES = {
  not_started: 'Not started',
  awaiting_material: 'Waiting on material',
  cut_moulding: 'Cutting moulding',
  join: 'Joining',
  cut_glass: 'Cutting glass',
  cut_mount: 'Cutting mount',
  fit: 'Fitting',
  wrap: 'Wrapping',
  done: 'Finished',
};

export const STATUSES = {
  quote: 'Quote',
  accepted: 'Accepted',
  in_progress: 'In progress',
  ready: 'Ready for collection',
  collected: 'Collected',
  cancelled: 'Cancelled',
};

/** The order the bench actually works in, for the "next stage" button. */
export const STAGE_ORDER = [
  'not_started', 'cut_moulding', 'join', 'cut_glass', 'cut_mount', 'fit', 'wrap', 'done',
];

export function nextStage(current) {
  // Waiting on material is a detour, not a step — coming back from it resumes
  // at the beginning of the cutting work rather than skipping ahead.
  if (current === 'awaiting_material') return 'cut_moulding';
  const index = STAGE_ORDER.indexOf(current);
  return index >= 0 && index < STAGE_ORDER.length - 1 ? STAGE_ORDER[index + 1] : null;
}
