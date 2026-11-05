// Fits each .fit line to the width of its .fitbox, like wood type set by hand to the measure.
// Without this script the CSS sets an estimate from the line's character count (--n).
(function () {
  var lines = [].slice.call(document.querySelectorAll('.fit'));
  if (!lines.length) return;
  function fit() {
    lines.forEach(function (el) {
      var box = el.closest('.fitbox') || el.parentElement;
      var max = parseFloat(el.getAttribute('data-max')) || 400;
      el.style.fontSize = '100px';
      el.style.display = 'inline-block';
      var w = el.getBoundingClientRect().width;
      el.style.display = '';
      var cs = getComputedStyle(box), target = box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      if (!w || !target) return;
      el.style.fontSize = Math.min(max, Math.floor(100 * target / w * 10) / 10) + 'px';
    });
  }
  var t;
  function later() { clearTimeout(t); t = setTimeout(fit, 80); }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit); else fit();
  fit();
  window.addEventListener('resize', later, { passive: true });
})();
