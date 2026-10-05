/**
 * Tiny DOM builder. Strings become text nodes (never HTML), so content from
 * content.json cannot inject markup. Attributes are set one by one; "href"
 * values must already be validated by content.js.
 */

export function h(tag, attrs = {}, ...children) {

  const el = document.createElement(tag);

  for (const [name, value] of Object.entries(attrs)) {

    if (value === null || value === undefined || value === false) {
      continue;
    }

    if (name === 'class') {
      el.className = value;
    }
    else if (name === 'dataset') {
      Object.assign(el.dataset, value);
    }
    else if (name.startsWith('on') && typeof value === 'function') {
      el.addEventListener(name.slice(2), value);
    }
    else {
      el.setAttribute(name, value === true ? '' : String(value));
    }

  }

  append(el, children);

  return el;

}


function append(el, children) {

  for (const child of children) {

    if (child === null || child === undefined || child === false) {
      continue;
    }

    if (Array.isArray(child)) {
      append(el, child);
    }
    else if (child instanceof Node) {
      el.appendChild(child);
    }
    else {
      el.appendChild(document.createTextNode(String(child)));
    }

  }

}


/* Attributes for links that leave the site. */
export function external(href) {

  return { href, target: '_blank', rel: 'noopener' };

}
