import { ref, watch, nextTick, onBeforeUnmount } from 'vue';

/******************************************************************/
/*                                                                */
/*  Follows a running job's output down as it comes in, as a      */
/*  terminal's `tail -f` : on the form's page after a submit, and */
/*  on the job's page for who follows it there.                   */
/*                                                                */
/*  It follows while the reader is at the output's end : a scroll */
/*  up to read pauses it, a scroll back down to the end resumes   */
/*  it. A new run starts followed.                                */
/*                                                                */
/******************************************************************/

// how near the output's end counts as at its end (px) : a wheel notch short of it still follows
const NEAR_END = 120;

/**
 * The element that scrolls the page around an element : its nearest scrolling ancestor, else
 * the document's.
 *
 * Args:
 *   el (HTMLElement): the element.
 *
 * Returns:
 *   HTMLElement: what scrolls.
 */
function scrollerOf(el) {
  for (let p = el?.parentElement; p; p = p.parentElement) {
    const { overflowY } = getComputedStyle(p);
    if ((overflowY === 'auto' || overflowY === 'scroll') && p.scrollHeight > p.clientHeight) return p;
  }
  return document.scrollingElement || document.documentElement;
}

/**
 * The bottom of what a scroller shows, in the window's coordinates.
 *
 * Args:
 *   scroller (HTMLElement): what scrolls.
 *
 * Returns:
 *   number: its visible bottom.
 */
function viewBottom(scroller) {
  const isPage = scroller === document.scrollingElement || scroller === document.documentElement;
  return isPage ? window.innerHeight : scroller.getBoundingClientRect().bottom;
}

/**
 * Follows an output down while its job runs.
 *
 * Args:
 *   target (Ref<HTMLElement>): the output (its panel) to keep the end of in view.
 *   size (function): what grows as the output comes in - its length.
 *   running (function): whether the job still runs.
 *
 * Returns:
 *   object: { following } - a ref, false while the reader scrolled up.
 */
export function useFollowOutput(target, size, running) {
  const following = ref(true);
  let scroller = null;
  // our own scrolls : not the reader's, they do not pause it
  let ownScrollUntil = 0;

  // the reader scrolled : following again at the output's end, paused above it
  function onScroll() {
    if (Date.now() < ownScrollUntil || !target.value) return;
    const gap = target.value.getBoundingClientRect().bottom - viewBottom(scroller);
    following.value = gap < NEAR_END;
  }

  // the scroller to listen to : found again when the output appears or moves to another one
  function attach() {
    const next = target.value ? scrollerOf(target.value) : null;
    if (next === scroller) return;
    detach();
    scroller = next;
    const where = scroller === document.scrollingElement || scroller === document.documentElement ? window : scroller;
    where?.addEventListener('scroll', onScroll, { passive: true });
  }
  function detach() {
    if (!scroller) return;
    const where = scroller === document.scrollingElement || scroller === document.documentElement ? window : scroller;
    where.removeEventListener('scroll', onScroll);
    scroller = null;
  }

  // the end of the output in view : the scroller moved by what hides it
  function follow() {
    if (!target.value) return;
    attach();
    const gap = target.value.getBoundingClientRect().bottom + 16 - viewBottom(scroller);
    if (gap <= 0) return;
    ownScrollUntil = Date.now() + 300;
    scroller.scrollTop += gap;
  }

  // a new run : followed from its start ; an ended one a few seconds more - its status turns
  // before its last lines arrive
  let endedAt = 0;
  watch(running, (now, before) => {
    if (now && !before) following.value = true;
    if (!now && before) endedAt = Date.now();
  });
  const live = () => running() || Date.now() - endedAt < 5000;
  // more output : followed when the reader is at its end and the job runs (or just ended)
  watch(size, async () => {
    if (!live() || !following.value) return;
    await nextTick();
    follow();
  });
  onBeforeUnmount(detach);

  return { following };
}

export default useFollowOutput;
