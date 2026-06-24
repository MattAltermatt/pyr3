// #66 — mobile hamburger nav for the STATIC help pages (public/help/*.html).
// These pages live outside the SPA, so they can't use src/nav-menu.ts. This
// self-contained script builds a ☰ menu mirroring the app's mobile nav and
// appends it to the shared .help-header-inner. CSS (.help-nav* in help.css)
// shows it only at mobile widths (≤820px); desktop keeps the brand-only header.
// Destinations mirror the app's mobile keep-set (no Editor/Animate/Screensaver).
(function () {
  var DESTS = [
    { label: 'Viewer', href: '/viewer' },
    { label: 'Creator', href: '/creator' },
    { header: 'Flame Gallery', items: [
      { label: 'Browse', href: '/esf' },
      { label: 'Gallery', href: '/esf/gallery' },
    ] },
    { header: 'Discover', items: [
      { label: 'Showcase', href: '/showcase/' },
      { label: 'Variations', href: '/variations' },
    ] },
    { header: 'Help', items: [
      { label: 'How flames work', href: '/how-it-works' },
      { label: 'Direct-color variations', href: '/help/direct-color-variations.html' },
      { label: 'Render cost & quality', href: '/help/ifs-and-render-cost.html' },
      { label: 'WebGPU', href: '/help/webgpu.html' },
      { label: 'About', href: '/about' },
    ] },
  ];

  var inner = document.querySelector('.help-header-inner');
  if (!inner) return;

  function mkLink(label, href, leaf) {
    var a = document.createElement('a');
    a.className = 'help-nav-item' + (leaf ? ' help-nav-leaf' : '');
    a.href = href;
    a.textContent = label;
    return a;
  }

  var wrap = document.createElement('div');
  wrap.className = 'help-nav';

  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'help-nav-btn';
  btn.setAttribute('aria-label', 'Menu');
  btn.textContent = '☰'; // ☰

  var panel = document.createElement('div');
  panel.className = 'help-nav-panel';
  panel.hidden = true;

  DESTS.forEach(function (d) {
    if (d.items) {
      var h = document.createElement('div');
      h.className = 'help-nav-head';
      h.textContent = d.header;
      panel.appendChild(h);
      d.items.forEach(function (it) { panel.appendChild(mkLink(it.label, it.href, true)); });
    } else {
      panel.appendChild(mkLink(d.label, d.href, false));
    }
  });

  wrap.appendChild(btn);
  wrap.appendChild(panel);
  inner.appendChild(wrap);

  var open = false;
  function setOpen(v) { open = v; panel.hidden = !v; wrap.classList.toggle('open', v); }
  btn.addEventListener('click', function (e) { e.stopPropagation(); setOpen(!open); });
  document.addEventListener('mousedown', function (e) { if (open && !wrap.contains(e.target)) setOpen(false); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setOpen(false); });
})();
