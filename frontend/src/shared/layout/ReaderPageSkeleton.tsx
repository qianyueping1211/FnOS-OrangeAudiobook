import React from 'react';

// Shown while a lazily loaded page chunk is still arriving. Switching tabs used
// to drop a small spinner into the content area, which reads as "nothing
// happened yet" and invites a second tap; painting the locked band first (the
// page title and the search field) makes the switch feel immediate even when the
// page data is still loading behind it.
const ReaderPageSkeleton: React.FC = () => (
  <div className="reader-page reader-page-skeleton flex-1 min-h-full" aria-busy="true" aria-live="polite">
    <div className="reader-page-toolbar space-y-3">
      <div className="h-7 w-40 rounded-lg bg-slate-200/70 dark:bg-slate-800/70 animate-pulse" />
      <div className="h-4 w-64 rounded bg-slate-200/50 dark:bg-slate-800/50 animate-pulse" />
      <div className="h-10 w-full rounded-xl bg-slate-200/60 dark:bg-slate-800/60 animate-pulse" />
    </div>
    <div className="reader-page-scroll mt-4 grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={index} className="aspect-[3/4] rounded-xl bg-slate-200/60 dark:bg-slate-800/60 animate-pulse" />
      ))}
    </div>
  </div>
);

export default ReaderPageSkeleton;
