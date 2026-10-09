/******************************************************************/
/*                                                                */
/*  useRouteTab : a page's tab kept in its url (?tab=<key>)       */
/*                                                                */
/*  The tab shown follows the url and the url follows the tab : a */
/*  link or a bookmark opens a tab, the title's steps link to     */
/*  theirs, and Back returns to the tab before. The first tab has */
/*  no ?tab, so a page's plain address still opens it.            */
/*                                                                */
/******************************************************************/
import { ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

/**
 * A tab kept in the url.
 *
 * Args:
 *   firstTab (string|Function): the tab shown without ?tab (a function when it depends on the
 *     page, as the settings pages').
 *   isTab (Function): whether a key is one of the page's tabs (an unknown ?tab opens the first).
 *
 * Returns:
 *   object: { activeTab (a ref : set it to change the tab), tabLink (key) => the route of a tab }.
 */
export function useRouteTab(firstTab, isTab = () => true) {
  const route = useRoute();
  const router = useRouter();
  const first = () => (typeof firstTab === 'function' ? firstTab() : firstTab);
  // ------------------------------------------------------------------
  // the tab the url names, when it is one of the page's ; else the first
  // ------------------------------------------------------------------
  const fromRoute = () => {
    const key = route.query?.tab ? String(route.query.tab) : '';
    return key && isTab(key) ? key : first();
  };
  const activeTab = ref(fromRoute());

  /**
   * The route of a tab : this page, its ?tab (none for the first tab).
   *
   * Args:
   *   key (string): the tab.
   *
   * Returns:
   *   object: a route location.
   */
  const tabLink = (key) => {
    const query = { ...route.query };
    if (key && key !== first()) query.tab = key;
    else delete query.tab;
    return { path: route.path, query };
  };

  // ------------------------------------------------------------------
  // the url changed (a link, Back) : its tab ; the tab changed : the url
  // ------------------------------------------------------------------
  watch(
    () => [route.path, route.query?.tab],
    () => {
      activeTab.value = fromRoute();
    },
  );
  watch(activeTab, (key) => {
    const want = key && key !== first() ? key : undefined;
    if ((route.query?.tab || undefined) !== want) router.replace(tabLink(key));
  });
  return { activeTab, tabLink };
}
