// Tap a column header to sort that conference's table by it; tap again to
// flip the direction. Numbers start high-to-low (Rank and $ per Win start
// low-to-high, where low is best), names start A-Z, and a dash always sorts
// last in either direction. Each cell's data-v carries the raw value.
// hmBindSort() runs once here and again whenever src/views.js redraws the
// tables for another timeframe.
(function () {
  function bind() {
  var tables = document.querySelectorAll('table.lb[data-sortable]');
  Array.prototype.forEach.call(tables, function (table) {
    var ths = table.querySelectorAll('thead th');
    var tbody = table.tBodies[0];
    // The build renders the rows already in the default order (Pct, high to
    // low) and marks that header, so the first tap on it flips the order.
    var state = { col: -1, dir: 1 };
    Array.prototype.forEach.call(ths, function (h, j) {
      var s = h.getAttribute('aria-sort');
      if (s === 'ascending' || s === 'descending') state = { col: j, dir: s === 'ascending' ? 1 : -1 };
    });
    function val(tr, i) {
      var v = tr.cells[i].getAttribute('data-v');
      return v === null || v === '' ? null : v;
    }
    function sortBy(i, dir) {
      var th = ths[i], isNum = th.getAttribute('data-t') === 'num';
      var rows = Array.prototype.slice.call(tbody.rows);
      rows.sort(function (a, b) {
        var x = val(a, i), y = val(b, i);
        if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
        var d = isNum ? Number(x) - Number(y) : x.localeCompare(y);
        if (d === 0) d = Number(a.getAttribute('data-o')) - Number(b.getAttribute('data-o'));
        else d *= dir;
        return d;
      });
      rows.forEach(function (r) { tbody.appendChild(r); });
      Array.prototype.forEach.call(ths, function (h, j) {
        h.setAttribute('aria-sort', j === i ? (dir > 0 ? 'ascending' : 'descending') : 'none');
        var a = h.querySelector('.arr');
        if (a) a.textContent = j === i ? (dir > 0 ? '▲' : '▼') : '';
      });
      state = { col: i, dir: dir };
    }
    Array.prototype.forEach.call(ths, function (th, i) {
      var b = th.querySelector('button');
      (b || th).addEventListener('click', function () {
        var first = Number(th.getAttribute('data-first') || -1);
        sortBy(i, state.col === i ? -state.dir : first);
      });
    });
  });
  }
  window.hmBindSort = bind;
  bind();
})();
