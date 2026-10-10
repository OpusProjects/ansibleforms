// Resolve the public login background images against the base tag, so they follow the subpath
// the app is hosted under (relative urls in css custom properties are unreliable across
// browsers, so we make them absolute here). A file of its own, not inline in index.html : the
// Content-Security-Policy allows scripts from the app only (server/src/lib/csp.js).
(function () {
  var style = document.documentElement.style;
  ['light', 'dark', 'color'].forEach(function (theme) {
    style.setProperty('--af-login-background-' + theme,
      'url(' + new URL('img/login_background_' + theme + '.jpg', document.baseURI) + ')');
  });
})();
