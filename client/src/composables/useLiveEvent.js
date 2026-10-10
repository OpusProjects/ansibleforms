import { onMounted, onBeforeUnmount } from 'vue';
import { listen } from '@/lib/liveEvents';

/**
 * Re-reads what a component shows when the server says it changed (lib/liveEvents.js), and
 * when the stream (re)opens : for as long as the component is mounted.
 *
 * Args:
 *   name (string): what to hear - 'jobs'.
 *   fn (function): what to re-read, at most once a second.
 */
export function useLiveEvent(name, fn) {
  let stop = null;
  onMounted(() => {
    stop = listen(name, fn);
  });
  onBeforeUnmount(() => stop?.());
}

export default useLiveEvent;
