// The unlock page's script. scripts/lock.mjs puts it inline, next to the box it opens.
// The box (#ls-box) holds the whole application, gzipped and then sealed with AES-256-GCM. The key
// comes from the password through PBKDF2. Nothing here is secret: all of the lock is in the password.
(() => {
  'use strict';

  const STORE = 'long-sunday.lock';
  const $ = (id) => document.getElementById(id);
  const form = $('ls-form');
  const pass = $('ls-pass');
  const show = $('ls-show');
  const keep = $('ls-keep');
  const go = $('ls-go');
  const error = $('ls-error');
  const status = $('ls-status');

  // First of all, so the key is out of the address bar before anything else runs.
  const linkPassword = takeLinkPassword();
  // A key link followed in a tab that already shows this page only changes the fragment. Nothing
  // loads again, so the same clean up has to run from here.
  let entered = false;
  window.addEventListener('hashchange', onHash);
  const box = JSON.parse($('ls-box').textContent);

  const able = !!(window.crypto && crypto.subtle && window.DecompressionStream);
  if (!able) {
    status.textContent = 'This page needs a current browser and a secure connection.';
    return;
  }

  // A link can end in #k=<password>. Any other parts (#d= and #e= belong to the world) stay.
  function takeLinkPassword() {
    const rest = [];
    let found = null;
    for (const part of location.hash.slice(1).split('&')) {
      if (found === null && part.startsWith('k=')) found = part.slice(2);
      else if (part) rest.push(part);
    }
    if (found === null) return null;
    const clean = location.pathname + location.search + (rest.length ? '#' + rest.join('&') : '');
    try {
      history.replaceState(history.state, '', clean);
    } catch {
      // A page opened from disk can refuse. Swapping the fragment in place leaves no history entry either.
      location.replace('#' + rest.join('&'));
    }
    try {
      return decodeURIComponent(found);
    } catch {
      return null;
    }
  }

  function fromBase64(text) {
    const bin = atob(text);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function gunzip(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).arrayBuffer();
  }

  // The slow step, on purpose. The browser does it off the main thread, so the page stays live.
  async function rawKeyFrom(password) {
    const text = new TextEncoder().encode(password.normalize('NFC').trim());
    const base = await crypto.subtle.importKey('raw', text, 'PBKDF2', false, ['deriveBits']);
    const params = { name: 'PBKDF2', hash: 'SHA-256', salt: fromBase64(box.salt), iterations: box.iter };
    return new Uint8Array(await crypto.subtle.deriveBits(params, base, 256));
  }

  // The application's html with the key that opened it, or null when the key does not fit.
  // A wrong password and a damaged file look the same from here, and are told the same way.
  async function open(raw) {
    try {
      const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
      const sealed = fromBase64(box.ct);
      const packed = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(box.iv) }, key, sealed);
      return { raw, key, html: new TextDecoder().decode(await gunzip(packed)) };
    } catch {
      return null;
    }
  }

  // The world's side files are sealed the same way: twelve bytes of nonce, then the sealed bytes.
  // Inside, the first byte says whether the rest is gzipped. See src/lock/asset.d.ts.
  function assetReader(key) {
    return async (path) => {
      const url = new URL(path, document.baseURI);
      if (url.origin !== location.origin) throw new Error(`Long Sunday: ${path} is not beside the page.`);
      let res;
      try {
        res = await fetch(url);
      } catch {
        throw new Error(`Long Sunday: ${path} could not be fetched.`);
      }
      if (!res.ok) throw new Error(`Long Sunday: ${path} is missing (${res.status}).`);
      const file = await res.arrayBuffer();
      let plain;
      try {
        const params = { name: 'AES-GCM', iv: new Uint8Array(file, 0, 12) };
        plain = await crypto.subtle.decrypt(params, key, new Uint8Array(file, 12));
      } catch {
        throw new Error(`Long Sunday: ${path} did not open. It is damaged or was locked with another password.`);
      }
      const body = plain.slice(1);
      return new Uint8Array(plain, 0, 1)[0] === 1 ? gunzip(body) : body;
    };
  }

  // Hand the page over. Writing the document again lets the parser run the application exactly as it
  // would from its own file: styles, canvas and #ui first, then its module script. Same address.
  function enter(opened) {
    if (entered) return;
    entered = true;
    window.__lsAsset = assetReader(opened.key);
    document.open();
    document.write(opened.html);
    document.close();
    // document.open() drops every listener on the window, so the one for key links goes back on.
    window.addEventListener('hashchange', onHash);
  }

  // The fragment changed under a page that is already up. A key in it leaves the address bar at once.
  // On the lock screen it is also tried, the same way a link that opened the page is: a key that does
  // not fit says nothing. In the open world there is nothing left to do with it.
  async function onHash() {
    const given = takeLinkPassword();
    if (given === null || entered || !able) return;
    const opened = await rawKeyFrom(given).then(open, () => null);
    if (opened) enter(opened);
  }

  // "Stay unlocked" keeps the derived key, never the password, and names the build it fits by its salt.
  function storedKey() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE));
      if (saved && saved.s === box.salt) return fromBase64(saved.k);
      if (saved) localStorage.removeItem(STORE);
    } catch {
      // Storage can be off or full of something else. Then the form is shown as usual.
    }
    return null;
  }

  function storeKey(raw) {
    try {
      localStorage.setItem(STORE, JSON.stringify({ s: box.salt, k: btoa(String.fromCharCode(...raw)) }));
    } catch {
      // Private windows can refuse. The visitor is in either way.
    }
  }

  function showForm() {
    status.textContent = '';
    status.classList.add('sr');
    form.hidden = false;
    // A keyboard is at hand: start in the field. On a phone this would throw the keys up over the card.
    if (matchMedia('(hover: hover) and (pointer: fine)').matches) pass.focus();
  }

  show.addEventListener('click', () => {
    const reveal = pass.type === 'password';
    pass.type = reveal ? 'text' : 'password';
    show.firstChild.data = reveal ? 'Hide' : 'Show';
  });

  let busy = false;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    busy = true;
    go.setAttribute('aria-disabled', 'true');
    pass.readOnly = true;
    pass.removeAttribute('aria-invalid');
    error.textContent = '';
    go.textContent = status.textContent = 'Opening';

    const opened = await rawKeyFrom(pass.value).then(open, () => null);
    if (opened) {
      if (keep.checked) storeKey(opened.raw);
      enter(opened);
      return;
    }

    busy = false;
    go.removeAttribute('aria-disabled');
    pass.readOnly = false;
    pass.setAttribute('aria-invalid', 'true');
    status.textContent = '';
    go.textContent = 'Open';
    error.classList.add('is-kept');
    error.textContent = 'That is not it. Try again.';
    pass.focus();
    pass.select();
  });

  // A key kept on this device, then a key in the link, then the form. A link that does not fit says nothing.
  (async () => {
    const saved = storedKey();
    if (!saved && linkPassword === null) return showForm();
    status.textContent = 'Opening';
    let opened = saved ? await open(saved) : null;
    if (!opened && linkPassword !== null) opened = await rawKeyFrom(linkPassword).then(open, () => null);
    if (opened) enter(opened);
    else showForm();
  })();
})();
