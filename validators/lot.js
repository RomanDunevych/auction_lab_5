const {
  addError, str, parseMoney, parseId, parseDateTime,
} = require('./common');
const { MAX_MONEY, MAX_AUCTION_DAYS } = require('../config/constants');

const DAY_MS = 24 * 3600 * 1000;

// Перевірка форми лоту.
//   id       — id лоту, що редагується (null при створенні)
//   hasBids  — чи є на лот ставки (тоді початкову ціну змінювати не можна)
//   now      — поточний час (параметр потрібен для тестів)
async function validateLot(body, {
  id = null, hasBids = false, db = null, now = new Date(),
} = {}) {
  const lookups = db || require('./lookups');
  const errors = {};

  const title = str(body.title);
  const description = str(body.description);

  // Назва
  if (!title) {
    addError(errors, 'title', 'Вкажіть назву лоту');
  } else if (title.length < 3) {
    addError(errors, 'title', 'Назва має містити щонайменше 3 символи');
  } else if (title.length > 150) {
    addError(errors, 'title', 'Назва не може бути довшою за 150 символів');
  } else if (/[<>]/.test(title)) {
    addError(errors, 'title', 'Назва не може містити символів < та >');
  }

  // Опис
  if (description.length > 2000) {
    addError(errors, 'description', 'Опис не може бути довшим за 2000 символів');
  }

  // Початкова ціна (якщо на лот уже є ставки, поле заблоковане й не перевіряється)
  let startPrice = null;
  if (!hasBids) {
    if (str(body.startPrice) === '') {
      addError(errors, 'startPrice', 'Вкажіть початкову ціну');
    } else {
      startPrice = parseMoney(body.startPrice);
      if (startPrice === null) {
        addError(errors, 'startPrice', 'Початкова ціна має бути додатним числом не більше ніж із двома знаками після коми');
      } else if (startPrice <= 0) {
        addError(errors, 'startPrice', 'Початкова ціна має бути більшою за 0');
      } else if (startPrice > MAX_MONEY) {
        addError(errors, 'startPrice', 'Початкова ціна завелика');
      }
    }
  }

  // Мінімальний крок ставки
  let minStep = null;
  if (str(body.minStep) === '') {
    addError(errors, 'minStep', 'Вкажіть мінімальний крок ставки');
  } else {
    minStep = parseMoney(body.minStep);
    if (minStep === null) {
      addError(errors, 'minStep', 'Крок має бути додатним числом не більше ніж із двома знаками після коми');
    } else if (minStep <= 0) {
      addError(errors, 'minStep', 'Крок має бути більшим за 0');
    } else if (minStep > MAX_MONEY) {
      addError(errors, 'minStep', 'Крок завеликий');
    }
  }

  // Час початку й завершення торгів
  let startTime = null;
  let endTime = null;
  if (str(body.startTime) === '') {
    addError(errors, 'startTime', 'Вкажіть час початку торгів');
  } else {
    startTime = parseDateTime(body.startTime);
    if (!startTime) addError(errors, 'startTime', 'Вкажіть коректні дату й час початку торгів');
  }
  if (str(body.endTime) === '') {
    addError(errors, 'endTime', 'Вкажіть час завершення торгів');
  } else {
    endTime = parseDateTime(body.endTime);
    if (!endTime) addError(errors, 'endTime', 'Вкажіть коректні дату й час завершення торгів');
  }
  if (startTime && endTime) {
    if (endTime <= startTime) {
      addError(errors, 'endTime', 'Час завершення має бути пізніше за час початку');
    } else if (endTime - startTime > MAX_AUCTION_DAYS * DAY_MS) {
      addError(errors, 'endTime', `Торги не можуть тривати довше за ${MAX_AUCTION_DAYS} днів`);
    }
  }

  // Продавець
  const sellerId = parseId(body.sellerId);
  if (str(body.sellerId) === '') {
    addError(errors, 'sellerId', 'Оберіть продавця');
  } else if (sellerId === null || !(await lookups.exists('User', sellerId))) {
    addError(errors, 'sellerId', 'Обраного продавця не існує');
  } else if (id && await lookups.userHasBidOnLot(id, sellerId)) {
    addError(errors, 'sellerId', 'Цей користувач робив ставки на цей лот, тому не може бути його продавцем');
  }

  // Категорія
  const categoryId = parseId(body.categoryId);
  if (str(body.categoryId) === '') {
    addError(errors, 'categoryId', 'Оберіть категорію');
  } else if (categoryId === null || !(await lookups.exists('Category', categoryId))) {
    addError(errors, 'categoryId', 'Обраної категорії не існує');
  }

  // Статус
  const statusId = parseId(body.statusId);
  if (str(body.statusId) === '') {
    addError(errors, 'statusId', 'Оберіть статус');
  } else {
    const statusName = statusId === null ? null : await lookups.statusName(statusId);
    if (!statusName) {
      addError(errors, 'statusId', 'Обраного статусу не існує');
    } else if (statusName === 'sold' && !hasBids) {
      addError(errors, 'statusId', 'Лот не можна позначити проданим: на нього немає жодної ставки');
    } else if (statusName === 'active' && endTime && endTime <= now) {
      addError(errors, 'endTime', 'Для активного лоту час завершення має бути в майбутньому');
    }
  }

  return {
    values: {
      title, description: description || null, startPrice, minStep, startTime, endTime, sellerId, categoryId, statusId,
    },
    errors,
  };
}

module.exports = { validateLot };
