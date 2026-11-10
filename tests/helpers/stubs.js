// Допоміжні засоби для тестів без встановлених пакетів і без бази даних.
//
// installStubs() підміняє завантаження модулів: замість express, sequelize, passport та
// моделей (../models) підставляються заглушки, тому контролери та маршрути
// можна виконувати як звичайні функції.

const Module = require('module');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const originalLoad = Module._load;
const stubs = new Map();

// key: ім’я пакета ('sequelize') або шлях від кореня проєкту без розширення ('models', 'controllers/lotController')
function stub(key, exports) {
  stubs.set(key, exports);
}

function installStubs() {
  Module._load = function patchedLoad(request, parent, isMain) {
    if (stubs.has(request)) return stubs.get(request);
    if (request.startsWith('.') && parent && parent.filename) {
      const rel = path.relative(ROOT, path.resolve(path.dirname(parent.filename), request))
        .split(path.sep).join('/').replace(/\.js$/, '');
      if (stubs.has(rel)) return stubs.get(rel);
    }
    return originalLoad.call(this, request, parent, isMain);
  };
}

// Заглушка, що повертає порожню функцію для будь-якої властивості
function anyFunctions() {
  return new Proxy({}, { get: () => () => {} });
}

// Фейкова відповідь Express: запам’ятовує, що зробив код
function fakeRes() {
  const res = {
    code: 200, out: null, cleared: [],
    status(code) { res.code = code; return res; },
    render(view, data) { res.out = { type: 'render', view, data, code: res.code }; return res; },
    redirect(url) { res.out = { type: 'redirect', url }; return res; },
    clearCookie(name) { res.cleared.push(name); return res; },
    locals: {},
  };
  return res;
}

// Фейковий запит; user === null — відвідувач
function fakeReq({ user = null, body = {}, query = {}, params = {}, method = 'GET', originalUrl = '/' } = {}) {
  return {
    user, body, query, params, method, originalUrl,
    logIn(u, cb) { this.user = u; cb(null); },
    logout(cb) { this.user = null; cb(null); },
  };
}

module.exports = { ROOT, stub, installStubs, anyFunctions, fakeRes, fakeReq };
