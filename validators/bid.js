const {
  addError, str, parseMoney, parseId, toCents, fromCents,
} = require('./common');
const { MAX_MONEY } = require('../config/constants');

// Перевірка суми ставки (формат і допустимий діапазон)
function checkAmount(errors, raw) {
  if (str(raw) === '') {
    addError(errors, 'amount', 'Вкажіть суму ставки');
    return null;
  }
  const amount = parseMoney(raw);
  if (amount === null) {
    addError(errors, 'amount', 'Сума має бути додатним числом не більше ніж із двома знаками після коми');
  } else if (amount <= 0) {
    addError(errors, 'amount', 'Сума має бути більшою за 0');
  } else if (amount > MAX_MONEY) {
    addError(errors, 'amount', 'Сума завелика');
  }
  return errors.amount ? null : amount;
}

// Перевірка форми нової ставки (формат полів та існування лоту й користувача)
async function validateNewBid(body, { db = null } = {}) {
  const lookups = db || require('./lookups');
  const errors = {};

  const lotId = parseId(body.lotId);
  if (str(body.lotId) === '') {
    addError(errors, 'lotId', 'Оберіть лот');
  } else if (lotId === null || !(await lookups.exists('Lot', lotId))) {
    addError(errors, 'lotId', 'Обраного лоту не існує');
  }

  const userId = parseId(body.userId);
  if (str(body.userId) === '') {
    addError(errors, 'userId', 'Оберіть користувача');
  } else if (userId === null || !(await lookups.exists('User', userId))) {
    addError(errors, 'userId', 'Обраного користувача не існує');
  }

  const amount = checkAmount(errors, body.amount);

  return { values: { lotId, userId, amount }, errors };
}

// Перевірка форми редагування ставки: змінюється лише сума
function validateBidAmount(body) {
  const errors = {};
  const amount = checkAmount(errors, body.amount);
  return { values: { amount }, errors };
}

// Бізнес-правила розміщення ставки (чиста функція: усі дані передаються параметрами).
//   lot    — { statusName, startTime, endTime, sellerId, startPrice, currentPrice, minStep }
//   topBid — найвища поточна ставка лоту ({ userId }) або null
// Повертає об’єкт помилок по полях (порожній, якщо ставку можна приймати).
function bidPlacementRules({
  lot, userId, amount, topBid, now = new Date(),
}) {
  const errors = {};

  if (lot.statusName !== 'active') {
    addError(errors, 'lotId', 'Торги за цим лотом не активні');
  } else if (now < lot.startTime) {
    addError(errors, 'lotId', 'Торги за цим лотом ще не розпочалися');
  } else if (now > lot.endTime) {
    addError(errors, 'lotId', 'Торги за цим лотом уже завершено');
  }

  if (lot.sellerId === userId) {
    addError(errors, 'userId', 'Продавець не може робити ставки на власний лот');
  } else if (topBid && topBid.userId === userId) {
    addError(errors, 'userId', 'Ставка цього користувача вже є найвищою');
  }

  // Перша ставка — не менше початкової ціни, наступні — не менше поточної ціни + крок
  const minCents = topBid
    ? toCents(lot.currentPrice) + toCents(lot.minStep)
    : toCents(lot.startPrice);
  if (toCents(amount) < minCents) {
    addError(errors, 'amount', `Ставка має бути не меншою за ${fromCents(minCents)} грн`);
  }

  return errors;
}

// Правила редагування суми ставки.
//   bid     — { id }
//   lot     — { statusName, startPrice, minStep }
//   topBids — дві найвищі ставки лоту від найвищої: [{ id, amount }, { id, amount }]
function bidEditRules({
  lot, bid, topBids, amount,
}) {
  const errors = {};

  if (lot.statusName === 'sold') {
    addError(errors, '_form', 'Лот уже продано: ставку змінити не можна');
    return errors;
  }
  if (!topBids.length || topBids[0].id !== bid.id) {
    addError(errors, '_form', 'Редагувати можна лише найвищу ставку лоту');
    return errors;
  }

  // Нова сума має перевищувати попередню ставку не менше ніж на крок (або дорівнювати початковій ціні)
  const previous = topBids[1];
  const minCents = previous
    ? toCents(previous.amount) + toCents(lot.minStep)
    : toCents(lot.startPrice);
  if (toCents(amount) < minCents) {
    addError(errors, 'amount', `Ставка має бути не меншою за ${fromCents(minCents)} грн`);
  }

  return errors;
}

// Правила видалення ставки
function bidDeleteRules({ lot }) {
  const errors = {};
  if (lot.statusName === 'sold') {
    addError(errors, '_form', 'Лот уже продано: ставку видалити не можна');
  }
  return errors;
}

module.exports = {
  validateNewBid, validateBidAmount, bidPlacementRules, bidEditRules, bidDeleteRules,
};
