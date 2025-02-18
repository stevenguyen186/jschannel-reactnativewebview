var Channel = (function () {
  'use strict';

  var s_curTranId = Math.floor(Math.random() * 1000001);
  var s_boundChans = {};
  var s_transIds = {};

  var s_addBoundChan = function (win, origin, scope, handler) {
    if (typeof s_boundChans[origin] !== 'object') {
      s_boundChans[origin] = {};
    }
    if (typeof s_boundChans[origin][scope] !== 'object') {
      s_boundChans[origin][scope] = [];
    }
    s_boundChans[origin][scope].push({win: win, handler: handler});
  };

  var s_removeBoundChan = function (win, origin, scope) {
    var arr = s_boundChans[origin][scope];
    for (var i = 0; i < arr.length; i++) {
      if (arr[i].win === win) {
        arr.splice(i, 1);
      }
    }
    if (s_boundChans[origin][scope].length === 0) {
      delete s_boundChans[origin][scope];
    }
  };

  var s_onMessage = function (e) {
    try {
      var m = JSON.parse(e.data);
      if (typeof m !== 'object' || m === null) {
        throw 'malformed';
      }
    } catch (e) {
      return;
    }

    var o = e.origin;
    var s, i, meth;
    if (typeof m.method === 'string') {
      var ar = m.method.split('::');
      if (ar.length == 2) {
        s = ar[0];
        meth = ar[1];
      } else {
        meth = m.method;
      }
    }

    if (typeof m.id !== 'undefined') {
      i = m.id;
    }

    if (typeof meth === 'string') {
      var delivered = false;
      if (s_boundChans[o] && s_boundChans[o][s]) {
        for (var j = 0; j < s_boundChans[o][s].length; j++) {
          s_boundChans[o][s][j].handler(o, meth, m);
          delivered = true;
          break;
        }
      }

      if (!delivered && s_boundChans['*'] && s_boundChans['*'][s]) {
        for (var j = 0; j < s_boundChans['*'][s].length; j++) {
          s_boundChans['*'][s][j].handler(o, meth, m);
          break;
        }
      }
    } else if (typeof i !== 'undefined') {
      if (s_transIds[i]) {
        s_transIds[i](o, meth, m);
      }
    }
  };

  if (window.ReactNativeWebView) {
    document.addEventListener('message', s_onMessage, false); // React Native WebView
  } else {
    window.addEventListener('message', s_onMessage, false); // Standard browser
  }

  return {
    build: function (cfg) {
      var debug = function (m) {
        if (cfg.debugOutput && window.console && window.console.log) {
          try {
            if (typeof m !== 'string') {
              m = JSON.stringify(m);
            }
          } catch (e) {}
          console.log('[' + chanId + '] ' + m);
        }
      };

      if (!window.JSON || !window.JSON.stringify || !window.JSON.parse) {
        throw 'jschannel cannot run this browser, no JSON parsing/serialization';
      }

      if (typeof cfg !== 'object') {
        throw 'Channel build invoked without a proper object argument';
      }

      if (!cfg.window || !cfg.window.postMessage) {
        throw 'Channel.build() called without a valid window argument';
      }

      // ✅ FIXED: Remove restriction that prevents same-window communication
      // if (window === cfg.window) throw("target window is same as present window -- not allowed");

      var validOrigin = false;
      if (typeof cfg.origin === 'string') {
        if (cfg.origin === '*') {
          validOrigin = true;
        } else if (
          cfg.origin.match(/^https?:\/\/(?:[-a-zA-Z0-9_\.])+(?::\d+)?/)
        ) {
          cfg.origin = cfg.origin.toLowerCase();
          validOrigin = true;
        }
      }

      if (!validOrigin) {
        throw 'Channel.build() called with an invalid origin';
      }

      var chanId = Math.random().toString(36).substring(7);
      var regTbl = {};
      var outTbl = {};
      var inTbl = {};
      var ready = false;
      var pendingQueue = [];

      var postMessage = function (msg, force) {
        if (!msg) {
          throw 'postMessage called with null message';
        }
        if (!force && !ready) {
          pendingQueue.push(msg);
        } else {
          if (window.ReactNativeWebView) {
            window.ReactNativeWebView.postMessage(JSON.stringify(msg));
          } else {
            cfg.window.postMessage(JSON.stringify(msg), cfg.origin);
          }
        }
      };

      var obj = {
        unbind: function (method) {
          if (regTbl[method]) {
            delete regTbl[method];
            return true;
          }
          return false;
        },
        bind: function (method, cb) {
          if (!method || typeof method !== 'string') {
            throw "'method' argument to bind must be string";
          }
          if (!cb || typeof cb !== 'function') {
            throw 'callback missing from bind params';
          }

          if (regTbl[method]) {
            throw "method '" + method + "' is already bound!";
          }
          regTbl[method] = cb;
          return this;
        },
        call: function (m) {
          if (!m) {
            throw 'missing arguments to call function';
          }
          if (!m.method || typeof m.method !== 'string') {
            throw "'method' argument to call must be string";
          }
          if (!m.success || typeof m.success !== 'function') {
            throw "'success' callback missing from call";
          }

          var msg = {id: s_curTranId, method: m.method, params: m.params};
          outTbl[s_curTranId] = {success: m.success, error: m.error};
          s_transIds[s_curTranId] = s_onMessage;
          s_curTranId++;

          postMessage(msg);
        },
        notify: function (m) {
          if (!m) {
            throw 'missing arguments to notify function';
          }
          if (!m.method || typeof m.method !== 'string') {
            throw "'method' argument to notify must be string";
          }

          postMessage({method: m.method, params: m.params});
        },
        destroy: function () {
          s_removeBoundChan(cfg.window, cfg.origin, '');
          regTbl = {};
          inTbl = {};
          outTbl = {};
          cfg.origin = null;
          pendingQueue = [];
          chanId = '';
        },
      };

      obj.bind('__ready', function () {
        ready = true;
        while (pendingQueue.length) {
          postMessage(pendingQueue.pop());
        }
        if (typeof cfg.onReady === 'function') {
          cfg.onReady(obj);
        }
      });

      setTimeout(function () {
        postMessage({method: '__ready', params: 'ping'}, true);
      }, 0);

      return obj;
    },
  };
})();
