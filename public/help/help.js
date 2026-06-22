// pyr3 help-page link behavior (#406 follow-up).
// Outbound links on a help/reference page open in a NEW TAB so the help page
// the user deliberately opened stays put. Two exceptions stay in-place:
//   • in-page #anchor jumps (a new tab to an anchor is wrong)
//   • the header brand / back-home link (its whole job is to LEAVE the page)
// Degrades gracefully: with JS off, links just open in the same tab.
// Standing preference — prefer new-tab outbound links on static pages going forward.
for (const a of document.querySelectorAll('a[href]')) {
  const href = a.getAttribute('href');
  if (!href || href.startsWith('#')) continue;     // in-page anchor
  if (a.classList.contains('help-brand')) continue; // back-home affordance
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
}
