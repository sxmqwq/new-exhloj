import { marked } from 'marked';
import createDOMPurify from 'dompurify';
import markedKatex from 'marked-katex-extension';
const purifier = createDOMPurify(window);
marked.use(markedKatex({ output: 'mathml', throwOnError: false, trust: false, strict: 'ignore', nonStandard: true }));
export function render(text) {
  return purifier.sanitize(marked.parse(String(text), { async: false, gfm: true }), {
    FORBID_TAGS: ['style', 'script', 'iframe', 'form', 'input', 'button', 'textarea', 'select', 'object', 'embed', 'link', 'meta'],
    FORBID_ATTR: ['style', 'srcdoc', 'id', 'name'],
    SANITIZE_NAMED_PROPS: true,
  });
}
