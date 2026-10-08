var Navigate = {
  toLogin(router, route) {
    if (route?.name != '/login') {
      // redirect to login page with original route as query parameter
      router
        .replace({ name: '/login', query: { from: route.fullPath != '/logout' ? route.fullPath : '' } })
        .catch((_err) => {}); // no token found, logout
    }
  },

  toHome(router, _route) {
    console.log('Redirecting to home');
    router.push({ name: '/' }).catch((_err) => {});
  },
  toError(router) {
    console.log('Redirecting to error');
    router.push({ name: '/error' }).catch((_err) => {});
  },

  toSchema(router) {
    console.log('Redirecting to schema');
    router.push({ name: '/schema' }).catch((_err) => {});
  },

  toPath(router, path, query = '', forceReload = false) {
    // If path is already an object, just use it directly
    if (typeof path === 'object') {
      router.push(path).catch((_err) => {});
      return;
    }

    // For string paths, use URL API to handle existing query params properly
    const url = new URL(path, window.location.origin);

    // Add/merge additional query parameters if provided
    if (query && typeof query === 'object') {
      for (const [key, value] of Object.entries(query)) {
        url.searchParams.set(key, value);
      }
    }

    const fullPath = url.pathname + url.search;

    // If we're navigating to the same path and forceReload is true,
    // first navigate away then back to trigger a reload
    if (forceReload && router.currentRoute.value.fullPath === fullPath) {
      router
        .push('/')
        .then(() => {
          router.push(fullPath).catch((_err) => {});
        })
        .catch((_err) => {});
    } else {
      // Use the pathname + search (which will have proper %20 encoding)
      router.push(fullPath).catch((_err) => {});
    }
  },

  toOrigin(router, route) {
    if (route.query.from && route.query.from != '/login' && route.query.from != '/logout') {
      // authentication, redirect to original route
      console.log('Redirecting to original route');
      Navigate.toPath(router, route.query.from);
    } else {
      // is there a route name?
      console.log('No original route');
      if (route.name) {
        // we don't allow origin for login/logout & schema
        if (route.name == '/login' || route.name == '/logout' || route.name == '/schema') {
          Navigate.toHome(router, route);
        } else {
          Navigate.toPath(router, route.fullPath);
        }
      } else {
        // default home
        Navigate.toHome(router, route);
      }
    }
  },
};
export default Navigate;
