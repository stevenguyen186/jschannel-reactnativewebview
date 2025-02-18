;var Channel = (function() {
  "use strict";

  var s_curTranId = Math.floor(Math.random()*1000001);
  var s_boundChans = { };
  var s_transIds = { };

  function s_addBoundChan(win, origin, scope, handler) {
      if (!s_boundChans[origin]) s_boundChans[origin] = { };
      if (!s_boundChans[origin][scope]) s_boundChans[origin][scope] = [ ];
      s_boundChans[origin][scope].push({win: win, handler: handler});
  }

  function s_removeBoundChan(win, origin, scope) {
      var arr = s_boundChans[origin][scope];
      for (var i = 0; i < arr.length; i++) {
          if (arr[i].win === win) {
              arr.splice(i, 1);
          }
      }
      if (s_boundChans[origin][scope].length === 0) {
          delete s_boundChans[origin][scope];
      }
  }

  function s_isArray(obj) {
      return Array.isArray ? Array.isArray(obj) : (obj.constructor.toString().indexOf("Array") !== -1);
  }

  var s_onMessage = function(e) {
      try {
          var m = JSON.parse(e.data);
          if (typeof m !== 'object' || m === null) throw "malformed";
      } catch (e) {
          return;
      }

      var w = e.source;
      var o = e.origin;
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
                  if (s_boundChans[o][s][j].win === w) {
                      s_boundChans[o][s][j].handler(o, meth, m);
                      delivered = true;
                      break;
                  }
              }
          }
          if (!delivered && s_boundChans['*'] && s_boundChans['*'][s]) {
              for (var j = 0; j < s_boundChans['*'][s].length; j++) {
                  if (s_boundChans['*'][s][j].win === w) {
                      s_boundChans['*'][s][j].handler(o, meth, m);
                      break;
                  }
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
          if (!window.JSON || !window.JSON.stringify || !window.JSON.parse) {
              throw "jschannel cannot run this browser, no JSON parsing/serialization";
          }

          if (typeof cfg !== 'object') throw "Channel build invoked without a proper object argument";

          var validOrigin = typeof cfg.origin === 'string' &&
              (cfg.origin === "*" || /^https?:\/\/[-a-zA-Z0-9_\.]+(:\d+)?/.test(cfg.origin));

          if (!validOrigin) throw "Channel.build() called with an invalid origin";

          if (typeof cfg.scope !== 'undefined') {
              if (typeof cfg.scope !== 'string') throw 'scope must be a string';
              if (cfg.scope.includes('::')) throw "scope may not contain double colons '::'";
          }

          var chanId = Math.random().toString(36).substr(2, 5);
          var regTbl = { };
          var outTbl = { };
          var inTbl = { };
          var ready = false;
          var pendingQueue = [ ];

          var createTransaction = function(id, origin, callbacks) {
              return {
                  origin: origin,
                  invoke: function(cbName, v) {
                      if (!inTbl[id]) throw "attempting to invoke a callback of a nonexistent transaction: " + id;
                      postMessage({ id: id, callback: cbName, params: v });
                  },
                  error: function(error, message) {
                      delete inTbl[id];
                      postMessage({ id: id, error: error, message: message });
                  },
                  complete: function(v) {
                      delete inTbl[id];
                      postMessage({ id: id, result: v });
                  }
              };
          };

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

                  var pruneFunctions = function (path, obj) {
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
                  s_removeBoundChan(cfg.window, cfg.origin, cfg.scope || '');
                  ready = false;
                  regTbl = { };
                  inTbl = { };
                  outTbl = { };
              }
          };

          obj.bind('__ready', onReady);
          setTimeout(function() { postMessage({ method: '__ready', params: "ping" }, true); }, 0);

          return obj;
      }
  };
})();
