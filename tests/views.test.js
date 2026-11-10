// Перевірка шаблонів: у формах не повинно бути атрибутів клієнтської валідації.
// Вимога лабораторної: жодне поле не має атрибута required, щоб серверну валідацію було легко перевірити.
// Запуск: npm test

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const VIEWS = path.join(__dirname, '..', 'views');

function listTemplates(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listTemplates(full);
    return entry.name.endsWith('.njk') ? [full] : [];
  });
}

// Атрибути, які змушують браузер перевіряти поля до надсилання форми
const FORBIDDEN = ['required', 'min', 'max', 'minlength', 'maxlength', 'pattern', 'step'];
// Типи полів, що обмежують введення або мають вбудовану перевірку
const ALLOWED_INPUT_TYPES = ['text', 'password', 'hidden', 'datetime-local'];

const templates = listTemplates(VIEWS).map((file) => ({
  name: path.relative(VIEWS, file),
  source: fs.readFileSync(file, 'utf8'),
}));

// Усі теги форм і полів у шаблоні
function tagsOf(source) {
  return source.match(/<(?:form|input|select|textarea)\b[^>]*>/gi) || [];
}

describe('шаблони: форми без клієнтської валідації', () => {
  it('знайдено шаблони з формами', () => {
    assert.ok(templates.length > 10);
    assert.ok(templates.some((t) => tagsOf(t.source).length > 0));
  });

  for (const { name, source } of templates) {
    it(`${name}: немає required/min/max/minlength/maxlength/pattern/step`, () => {
      for (const tag of tagsOf(source)) {
        const withoutValues = tag.replace(/"[^"]*"/g, '""'); // значення в лапках не перевіряємо
        for (const attr of FORBIDDEN) {
          const found = new RegExp(`\\s${attr}(?=[\\s=>/])`, 'i').test(withoutValues);
          assert.equal(found, false, `${name}: атрибут «${attr}» у тегу ${tag}`);
        }
      }
    });

    it(`${name}: дозволені лише безпечні типи <input>`, () => {
      for (const tag of tagsOf(source).filter((t) => /^<input/i.test(t))) {
        const type = (/type="([^"]*)"/i.exec(tag) || [])[1];
        assert.ok(ALLOWED_INPUT_TYPES.includes(type), `${name}: недозволений type="${type}" у ${tag}`);
      }
    });

    it(`${name}: POST-форми (крім видалення) мають novalidate`, () => {
      for (const tag of tagsOf(source).filter((t) => /^<form/i.test(t))) {
        const isPost = /method="post"/i.test(tag);
        const isDelete = /action="[^"]*\/delete"/i.test(tag);
        if (isPost && !isDelete) assert.match(tag, /\snovalidate/, `${name}: у формі немає novalidate: ${tag}`);
      }
    });
  }
});
