// Email unsubscribe page (unsubscribe.html). The link in each alert email
// carries ?u=<user id>&t=<signed token>; the buttons POST them to the API.
// Nothing happens on page load: mail scanners open links, people press buttons.
(function () {
  var params = new URLSearchParams(location.search);
  var u = params.get('u') || '';
  var t = params.get('t') || '';
  var base = (window.WORKER_BASE || '').replace(/\/+$/, '');
  var $ = function (id) { return document.getElementById(id); };
  function show(id) {
    ['askBox', 'doneBox', 'backOnBox', 'badBox'].forEach(function (b) { $(b).hidden = b !== id; });
    $('errLine').hidden = true;
  }
  if (!u || !t) { show('badBox'); return; }

  function send(path, btn, next) {
    btn.disabled = true;
    fetch(base + '/api/email/' + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ u: u, t: t }),
    }).then(function (r) {
      btn.disabled = false;
      if (r.ok) show(next);
      else if (r.status === 400) show('badBox');
      else $('errLine').hidden = false;
    }).catch(function () {
      btn.disabled = false;
      $('errLine').hidden = false;
    });
  }
  $('unsubBtn').addEventListener('click', function () { send('unsubscribe', this, 'doneBox'); });
  $('resubBtn').addEventListener('click', function () { send('resubscribe', this, 'backOnBox'); });
})();
