import hljs from 'highlight.js/lib/core'
import yaml from 'highlight.js/lib/languages/yaml'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'

// Only the languages the app highlights: YAML (extravars, job output, form data),
// JavaScript (expressions) and JSON. The full highlight.js bundle carries about 190
// languages and was most of a megabyte of the client; auto-detection now picks among these.
hljs.registerLanguage('yaml', yaml)
hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('json', json)

// v-highlightjs: highlights every <code> inside the element with highlight.js
//
// The function shorthand of `app.directive` registers the same callback for
// both `mounted` and `updated`. highlight.js marks processed nodes with
// `data-highlighted="yes"` and warns when called twice on the same node, so
// we have to either skip those nodes (content unchanged) or clear the marker
// and re-render text from the binding before re-highlighting (content changed).
export default function (app) {
  app.directive('highlightjs', (el, binding) => {
    const codeNodes = el.querySelectorAll('code')
    for (let i = 0; i < codeNodes.length; i++) {
      const codeNode = codeNodes[i]
      const incoming = typeof binding.value === 'string' ? binding.value : null
      // Track the last source we highlighted so updates only re-run when the
      // actual text changed. Avoids hljs "previously highlighted" warnings on
      // every reactivity tick.
      const last = codeNode.dataset.highlightSource
      const current = incoming !== null ? incoming : codeNode.textContent
      if (codeNode.dataset.highlighted === 'yes' && last === current) {
        continue
      }
      if (incoming !== null) {
        codeNode.textContent = incoming
      }
      // Reset hljs marker so highlightElement does not warn.
      delete codeNode.dataset.highlighted
      hljs.highlightElement(codeNode)
      codeNode.dataset.highlightSource = current
    }
  })
}
