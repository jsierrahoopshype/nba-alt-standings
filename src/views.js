// Timeframes in the browser: ?asof=YYYY-MM-DD, ?since=YYYY-MM-DD,
// ?since=last7 and ?since=last15. The build renders the season; for any of
// these the leader lines, tables and charts are drawn again from the saved
// nights embedded in #hm-data, with the same functions the build uses
// (window.HM, bundled from lib/ by scripts/build.mjs). These views are
// marked noindex,follow with a canonical to themselves; the plain page is
// left exactly as built.
(function () {
  var HM = window.HM, el = document.getElementById('hm-data');
  if (!HM || !el) return;
  var D = JSON.parse(el.textContent);
  var order = D.teams.map(function (t) { return t.abbr; });
  var q = new URLSearchParams(location.search);
  var params = { asof: q.get('asof'), since: q.get('since') };
  var tf = HM.resolveTimeframe(params, { dates: D.dates, gameDate: D.gameDate });

  // The chips and the two date pickers show the current choice; picking a
  // date opens that view.
  var key = tf.kind === 'season' ? 'season' : (tf.preset || '');
  Array.prototype.forEach.call(document.querySelectorAll('.tf .chip'), function (a) {
    a.classList.toggle('active', a.getAttribute('data-tf') === key);
  });
  ['asof', 'since'].forEach(function (name) {
    var s = document.getElementById('tf-' + name);
    if (!s) return;
    if (tf.kind === name && !tf.preset) {
      var has = Array.prototype.some.call(s.options, function (o) { return o.value === tf.requested; });
      if (!has) { var o = document.createElement('option'); o.value = tf.requested; o.textContent = HM.fmtDay(tf.requested); s.appendChild(o); }
      s.value = tf.requested;
    }
    s.addEventListener('change', function () {
      if (s.value) location.href = D.pageUrl + '?' + name + '=' + encodeURIComponent(s.value);
    });
  });
  if (tf.kind === 'season') return;

  var snaps = {};
  D.dates.forEach(function (d) { snaps[d] = HM.unpackTeams(D.snapshots[d], order); });
  var standings = HM.standingsFor(tf, HM.unpackTeams(D.current, order), snaps);
  var parts = HM.timeframeParts(D.teams, standings, D.lines, D.payroll);
  document.getElementById('tf-leaders').innerHTML = parts.leaders;
  document.getElementById('tf-tables').innerHTML = parts.tables;
  document.getElementById('tf-charts').innerHTML = parts.charts;
  var text = HM.timeframeLabel(tf, standings);
  var lab = document.getElementById('tf-label'), note = document.getElementById('tf-note');
  lab.textContent = text.label; lab.hidden = !text.label;
  note.textContent = text.note; note.hidden = !text.note;
  if (window.hmBindSort) window.hmBindSort();

  // Not for search: noindex,follow, canonical and og:url to this view.
  var self = D.pageUrl + '?' + (tf.kind === 'asof' ? 'asof=' + tf.requested : 'since=' + (tf.preset || tf.requested));
  var m = document.createElement('meta');
  m.name = 'robots'; m.content = 'noindex,follow';
  document.head.appendChild(m);
  var c = document.querySelector('link[rel="canonical"]');
  if (c) c.href = self;
  var og = document.querySelector('meta[property="og:url"]');
  if (og) og.content = self;
})();
