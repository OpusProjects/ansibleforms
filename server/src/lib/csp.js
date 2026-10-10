/******************************************************************/
/*                                                                */
/*  The Content-Security-Policy of the web app : scripts from the */
/*  app only, so a script injected into a page - an XSS - does    */
/*  not run, and the page cannot be framed by another site.       */
/*                                                                */
/*  What the app itself needs :                                   */
/*    - 'unsafe-eval' : a form's local expressions (runLocal) and */
/*      a wizard step's `when` are JavaScript, run in the browser */
/*      with new Function ;                                       */
/*    - inline styles : Vue's style bindings and the code editor ;*/
/*    - images from anywhere : a form's or a category's image may */
/*      be any url ;                                              */
/*    - workers from blob: : the code editor.                     */
/*  CONTENT_SECURITY_POLICY=0 turns it off, for a setup that      */
/*  needs to (and should say why).                                */
/*                                                                */
/******************************************************************/

/**
 * The policy's directives, as helmet takes them.
 *
 * Returns:
 *   object: directive name -> sources.
 */
export function cspDirectives() {
  return {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", "'unsafe-eval'"],
    scriptSrcAttr: ["'none'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", "data:", "blob:", "https:", "http:"],
    fontSrc: ["'self'", "data:"],
    connectSrc: ["'self'"],
    workerSrc: ["'self'", "blob:"],
    frameSrc: ["'self'"],
    frameAncestors: ["'self'"],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
  };
}

export default { cspDirectives };
