// Taal: Nederlands of Zösters. Elementen met data-zo (tekst) of data-zo-html (opmaak) krijgen hun Zösterse versie.
// De keuze wordt onthouden in deze browser. Zonder script blijft alles Nederlands.
(function () {
  var KEY = 'zostere-taal';
  function lees() { try { return localStorage.getItem(KEY) === 'zo' ? 'zo' : 'nl'; } catch (e) { return 'nl'; } }
  function zet(t) {
    document.querySelectorAll('[data-zo]').forEach(function (el) {
      if (!el.hasAttribute('data-nl')) el.setAttribute('data-nl', el.textContent);
      el.textContent = t === 'zo' ? el.getAttribute('data-zo') : el.getAttribute('data-nl');
    });
    document.querySelectorAll('[data-zo-html]').forEach(function (el) {
      if (!el.hasAttribute('data-nl-html')) el.setAttribute('data-nl-html', el.innerHTML);
      el.innerHTML = t === 'zo' ? el.getAttribute('data-zo-html') : el.getAttribute('data-nl-html');
    });
    document.querySelectorAll('[data-zo-ph]').forEach(function (el) {
      if (!el.hasAttribute('data-nl-ph')) el.setAttribute('data-nl-ph', el.getAttribute('placeholder') || '');
      el.setAttribute('placeholder', t === 'zo' ? el.getAttribute('data-zo-ph') : el.getAttribute('data-nl-ph'));
    });
    document.documentElement.lang = t === 'zo' ? 'li' : 'nl';
    document.querySelectorAll('.taal [data-taal]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-taal') === t)); });
    window.dispatchEvent(new Event('resize'));
  }
  document.querySelectorAll('.taal [data-taal]').forEach(function (b) {
    b.addEventListener('click', function () { var t = b.getAttribute('data-taal'); try { localStorage.setItem(KEY, t); } catch (e) {} zet(t); });
  });
  if (lees() === 'zo') zet('zo');
})();
