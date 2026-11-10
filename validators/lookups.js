// Запити до бази даних, потрібні валідаторам (існування записів, унікальність тощо).
// Валідатори отримують цей об’єкт параметром `db`, тому в тестах його можна замінити заглушкою.

const {
  User, Category, LotStatus, Lot, Bid, BidHistory,
} = require('../models');

const MODELS = { User, Category, LotStatus, Lot, Bid, BidHistory };

// Чи існує запис із таким id
async function exists(model, id) {
  return (await MODELS[model].count({ where: { id } })) > 0;
}

// Чи вільне значення поля (без урахування регістру). excludeId — запис, який редагується.
// Порівняння виконується в JavaScript, бо SQLite не вміє переводити кирилицю в нижній регістр.
async function isUnique(model, field, value, excludeId = null) {
  const rows = await MODELS[model].findAll({ attributes: ['id', field], raw: true });
  const wanted = String(value).toLowerCase();
  return !rows.some((row) => Number(row.id) !== Number(excludeId) && String(row[field]).toLowerCase() === wanted);
}

// Назва статусу за id (або null)
async function statusName(id) {
  const status = await LotStatus.findByPk(id);
  return status ? status.name : null;
}

// Чи робив користувач ставки на цей лот
async function userHasBidOnLot(lotId, userId) {
  return (await Bid.count({ where: { lotId, userId } })) > 0;
}

// Ставка разом із даними лоту, до якого вона належить (або null)
async function bidContext(bidId) {
  const bid = await Bid.findByPk(bidId, { include: [{ model: Lot, as: 'lot', include: [{ model: LotStatus, as: 'status' }] }] });
  if (!bid) return null;
  return {
    id: bid.id,
    lotId: bid.lotId,
    userId: bid.userId,
    amount: Number(bid.amount),
    lotStatusName: bid.lot.status.name,
  };
}

// Скільки подій такого типу вже є для ставки (крім події excludeId)
async function countHistory(bidId, eventType, excludeId = null) {
  const rows = await BidHistory.findAll({ where: { bidId, eventType }, attributes: ['id'], raw: true });
  return rows.filter((row) => Number(row.id) !== Number(excludeId)).length;
}

module.exports = { exists, isUnique, statusName, userHasBidOnLot, bidContext, countHistory };
