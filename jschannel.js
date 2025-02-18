var Channel = (function() {
  "use strict";

  var s_curTranId = Math.floor(Math.random()*1000001);
  var s_boundChans = { };
  var s_transIds = { };

  var s_onMessage = function(e) {
      try {
          var m = JSON.parse(e.data);
          if (typeof m !== 'object' || m === null) throw "malformed";
      } catch (e) {
          return;
      }

      var o = e.origin || '*'; // ✅ Default origin for WebView
      var s, i, meth;

      if (typeof m.method === 'string') {
          var ar = m.method.split('::');
          s = ar.length === 2 ? ar[0] : undefined;
          meth = ar.length === 2 ? ar[1] : m.method;
      }

      if (typeof m.id !== 'undefined') i = m.id;

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
          if (s_transIds[i]) s_transIds[i](o, meth, m);
      }
  };

  if (window.addEventListener) window.addEventListener('message', s_onMessage, false);
  else if (window.attachEvent) window.attachEvent('onmessage', s_onMessage);

  return {
      build: function(cfg) {
          if (!window.postMessage && !window.ReactNativeWebView) 
              throw("jschannel cannot run in this environment, no postMessage");

          if (typeof cfg != 'object') throw("Channel build invoked without a proper object argument");

          var validOrigin = typeof cfg.origin === 'string' && 
              (cfg.origin === "*" || /^https?:\/\/[-a-zA-Z0-9_\.]+(:\d+)?/.test(cfg.origin));

          if (!validOrigin) throw ("Channel.build() called with an invalid origin");

          if (typeof cfg.scope !== 'undefined') {
              if (typeof cfg.scope !== 'string') throw 'scope, when specified, must be a string';
              if (cfg.scope.includes('::')) throw "scope may not contain double colons '::'";
          }

          var chanId = Math.random().toString(36).substr(2, 5);
          var regTbl = { };
          var outTbl = { };
          var inTbl = { };
          var ready = false;
          var pendingQueue = [ ];

          var postMessage = function(msg) {
              if (!msg) throw "postMessage called with null message";

              if (!ready) {
                  pendingQueue.push(msg);
              } else {
                  if (window.ReactNativeWebView) {
                      window.ReactNativeWebView.postMessage(JSON.stringify(msg));
                  } else {
                      cfg.window.postMessage(JSON.stringify(msg), cfg.origin);
                  }
              }
          };

          var onReady = function(trans, type) {
              ready = true;
              if (type === 'ping') obj.notify({ method: '__ready', params: 'pong' });
              while (pendingQueue.length) {
                  postMessage(pendingQueue.pop());
              }
              if (typeof cfg.onReady === 'function') cfg.onReady(obj);
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
                  if (!method || typeof method !== 'string') throw "'method' argument to bind must be string";
                  if (!cb || typeof cb !== 'function') throw "callback missing from bind params";

                  if (regTbl[method]) throw "method '" + method + "' is already bound!";
                  regTbl[method] = cb;
                  return this;
              },
              call: function(m) {
                  if (!m || !m.method || typeof m.method !== 'string') throw "'method' argument to call must be string";
                  if (!m.success || typeof m.success !== 'function') throw "'success' callback missing from call";

                  var callbacks = { };
                  var callbackNames = [ ];
                  var seen = [ ];

                  var pruneFunctions = function (path, obj) {
                      if (seen.indexOf(obj) >= 0) {
                          throw "params cannot be a recursive data structure"
                      }
                      seen.push(obj);
                     
                      if (typeof obj === 'object') {
                          for (var k in obj) {
                              if (!obj.hasOwnProperty(k)) continue;
                              var np = path + (path.length ? '/' : '') + k;
                              if (typeof obj[k] === 'function') {
                                  callbacks[np] = obj[k];
                                  callbackNames.push(np);
                                  delete obj[k];
                              } else if (typeof obj[k] === 'object') {
                                  pruneFunctions(np, obj[k]);
                              }
                          }
                      }
                  };
                  pruneFunctions("", m.params);

                  var msg = { id: s_curTranId, method: m.method, params: m.params };
                  if (callbackNames.length) msg.callbacks = callbackNames;

                  outTbl[s_curTranId] = { callbacks: callbacks, error: m.error, success: m.success };
                  s_transIds[s_curTranId] = s_onMessage;
                  s_curTranId++;
                  postMessage(msg);
              },
              notify: function(m) {
                  if (!m || !m.method || typeof m.method !== 'string') throw "'method' argument to notify must be string";
                  postMessage({ method: m.method, params: m.params });
              },
              destroy: function () {
                  ready = false;
                  regTbl = { };
                  inTbl = { };
                  outTbl = { };
                  pendingQueue = [ ];
              }
          };

          obj.bind('__ready', onReady);
          setTimeout(function() { postMessage({ method: '__ready', params: "ping" }, true); }, 0);

          return obj;
      }
  };
})();
