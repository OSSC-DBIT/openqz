// Google's sign-in button, in its own frame (google-signin.html, embedded by
// src/auth/GoogleButton.tsx). Google's library adds inline styles; keeping it here lets the app run
// with a content security policy that allows none. The signed ID token Google gives us goes to the
// parent page only (same origin), which sends it to the API to be verified.
(function () {
  'use strict';
  if (window.parent === window) {
    document.body.textContent = 'This page is part of the OpenQZ sign-in page.';
    return;
  }
  var params = new URLSearchParams(location.search);
  var clientId = params.get('client_id') || '';
  var width = Math.max(200, Math.min(400, Number(params.get('width')) || 320));
  function send(msg) {
    msg.source = 'openqz-google';
    window.parent.postMessage(msg, location.origin);
  }
  if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(clientId)) {
    send({ error: 'Google sign-in is not set up correctly.' });
    return;
  }
  var s = document.createElement('script');
  s.src = 'https://accounts.google.com/gsi/client';
  s.async = true;
  s.onerror = function () {
    send({ error: 'Could not load Google sign-in. Check your connection.' });
  };
  s.onload = function () {
    var id = window.google.accounts.id;
    id.initialize({
      client_id: clientId,
      callback: function (r) {
        send({ credential: r.credential });
      },
      ux_mode: 'popup',
      auto_select: false,
      itp_support: true,
    });
    id.renderButton(document.getElementById('btn'), {
      type: 'standard',
      theme: 'outline',
      size: 'large',
      text: 'continue_with',
      shape: 'pill',
      logo_alignment: 'left',
      width: width,
    });
    send({ ready: true });
  };
  document.head.appendChild(s);
})();
