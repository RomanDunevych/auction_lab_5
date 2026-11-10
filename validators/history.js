const {
  addError, str, parseMoney, parseId,
} = require('./common');
const { EVENT_TYPES, MAX_MONEY } = require('../config/constants');

// Перевірка форми запису історії ставок.
// Лот і користувач визначаються автоматично за обраною ставкою, тому в формі їх немає.
async function validateHistory(body, { id = null, db = null } = {}) {
  const lookups = db || require('./lookups');
  const errors = {};

  // Ставка
  let bid = null;
  const bidId = parseId(body.bidId);
  if (str(body.bidId) === '') {
    addError(errors, 'bidId', 'Оберіть ставку');
  } else {
    bid = bidId === null ? null : await lookups.bidContext(bidId);
    if (!bid) addError(errors, 'bidId', 'Обраної ставки не існує');
  }

  // Тип події
  const eventType = str(body.eventType);
  if (!eventType) {
    addError(errors, 'eventType', 'Оберіть тип події');
  } else if (!EVENT_TYPES.includes(eventType)) {
    addError(errors, 'eventType', 'Оберіть тип події зі списку');
  }

  // Сума
  let amount = null;
  if (str(body.amount) === '') {
    addError(errors, 'amount', 'Вкажіть суму');
  } else {
    amount = parseMoney(body.amount);
    if (amount === null) {
      addError(errors, 'amount', 'Сума має бути додатним числом не більше ніж із двома знаками після коми');
    } else if (amount <= 0) {
      addError(errors, 'amount', 'Сума має бути більшою за 0');
    } else if (amount > MAX_MONEY) {
      addError(errors, 'amount', 'Сума завелика');
    }
  }

  // Правила, що залежать від ставки й типу події
  if (bid && EVENT_TYPES.includes(eventType)) {
    if (eventType === 'WON' && bid.lotStatusName !== 'sold') {
      addError(errors, 'eventType', 'Подію «Виграш» можна додати лише для проданого лоту');
    } else if ((await lookups.countHistory(bid.id, eventType, id)) > 0) {
      addError(errors, 'eventType', 'Для цієї ставки подія такого типу вже існує');
    }
  }

  return {
    values: {
      bidId: bid ? bid.id : null,
      lotId: bid ? bid.lotId : null,
      userId: bid ? bid.userId : null,
      eventType,
      amount,
    },
    errors,
  };
}

module.exports = { validateHistory };
