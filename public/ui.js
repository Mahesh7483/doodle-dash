// Small DOM helpers shared by the phone app and the TV screen.

// Update a list of cards in place by key: unchanged cards are left alone (their pop-in
// animation isn't replayed), changed cards are swapped without animating, new ones pop in.
export function syncCards(el, cards) {
  const old = new Map([...el.children].map((n) => [n.dataset.key, n]));
  let prev = null;
  for (const { key, html } of cards) {
    let node = old.get(key);
    if (!node || node.dataset.html !== html) {
      const tmp = document.createElement('div');
      tmp.innerHTML = html.trim();
      const fresh = tmp.firstElementChild;
      fresh.dataset.key = key;
      fresh.dataset.html = html;
      if (node) {
        fresh.style.animation = 'none';
        node.replaceWith(fresh);
      }
      node = fresh;
    }
    old.delete(key);
    const want = prev ? prev.nextElementSibling : el.firstElementChild;
    if (want !== node) el.insertBefore(node, want);
    prev = node;
  }
  for (const n of old.values()) n.remove();
}
