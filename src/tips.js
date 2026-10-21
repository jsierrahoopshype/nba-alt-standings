// Column explanations: every table header with a data-tip shows it in a
// small box under the header, on hover (desktop) and on tap (mobile; the tap
// still sorts a sortable table). One box for the page, fixed to the viewport
// so the tables' horizontal scroller cannot clip it. Listeners sit on the
// document, so tables redrawn by src/views.js need nothing re-bound.
(function () {
  var box = document.createElement('div');
  box.className = 'hm-tip';
  box.setAttribute('role', 'tooltip');
  box.hidden = true;
  document.body.appendChild(box);
  var current = null, timer = null;
  var hover = window.matchMedia && window.matchMedia('(hover: hover)').matches;

  function show(th, ms) {
    var text = th.getAttribute('data-tip');
    if (!text) return;
    current = th;
    box.textContent = text;
    box.hidden = false;
    var r = th.getBoundingClientRect(), w = box.offsetWidth, vw = document.documentElement.clientWidth;
    var left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), vw - w - 8);
    box.style.left = left + 'px';
    box.style.top = (r.bottom + 6) + 'px';
    clearTimeout(timer);
    if (ms) timer = setTimeout(hide, ms);
  }
  function hide() { clearTimeout(timer); box.hidden = true; current = null; }
  function tipOf(el) { return el && el.closest ? el.closest('th[data-tip]') : null; }

  if (hover) {
    document.addEventListener('mouseover', function (e) { var th = tipOf(e.target); if (th && th !== current) show(th); else if (!th && current) hide(); });
  }
  // A tap (or click) shows the explanation for a few seconds.
  document.addEventListener('click', function (e) { var th = tipOf(e.target); if (th) show(th, 4000); else hide(); });
  document.addEventListener('focusin', function (e) { var th = tipOf(e.target); if (th) show(th); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hide(); });
  window.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);
})();
