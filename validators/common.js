// Спільні засоби серверної валідації: розбір значень з форми та накопичення помилок.
// Усі дані з форми приходять рядками, тому кожне значення перевіряється й перетворюється вручну.

// Помилка, що містить помилки по полях: { назваПоля: 'повідомлення' }.
// Ключ _form призначений для помилок, що стосуються всієї форми, а не окремого поля.
class ValidationError extends Error {
  constructor(errors) {
    super('Дані форми не пройшли перевірку');
    this.name = 'ValidationError';
    this.errors = errors;
  }
}

// Значення з форми як обрізаний рядок ('' якщо поля немає)
const str = (value) => (value === undefined || value === null ? '' : String(value).trim());

// Додає помилку до поля, лише якщо для нього ще немає помилки (показуємо першу)
function addError(errors, field, message) {
  if (!errors[field]) errors[field] = message;
}

const hasErrors = (errors) => Object.keys(errors).length > 0;

// Грошова сума: «1250», «1250.5», «1250,50». Не більше двох знаків після коми.
// Повертає число або null, якщо рядок не є сумою.
function parseMoney(raw) {
  const s = str(raw).replace(/\s/g, '').replace(',', '.');
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) return null;
  return Number(s);
}

// Ідентифікатор запису: додатне ціле число. Повертає число або null.
function parseId(raw) {
  const s = str(raw);
  if (!/^[1-9]\d{0,8}$/.test(s)) return null;
  return Number(s);
}

// Дата й час у форматі поля datetime-local («2026-10-31T19:30») або «2026-10-31 19:30».
// Перевіряє, що дата існує в календарі (наприклад, 31 лютого — помилка).
function parseDateTime(raw) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(str(raw));
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m.map(Number);
  const date = new Date(y, mo - 1, d, h, mi, s || 0);
  const exact = date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d
    && date.getHours() === h && date.getMinutes() === mi;
  return exact ? date : null;
}

const isEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);

// Гроші в копійках (цілі числа) — щоб порівнювати суми без помилок округлення
const toCents = (value) => Math.round(Number(value) * 100);
const fromCents = (cents) => (cents / 100).toFixed(2);

module.exports = {
  ValidationError, str, addError, hasErrors, parseMoney, parseId, parseDateTime, isEmail, toCents, fromCents,
};
