// Операції зі ставками, що змінюють кілька таблиць одразу (ставка, історія, ціна лоту).
// Кожна операція виконується в транзакції: або всі зміни, або жодної.
// Правила перевірки описані чистими функціями в validators/bid.js.

const {
  sequelize, Lot, LotStatus, Bid, BidHistory,
} = require('../models');
const { ValidationError, hasErrors } = require('../validators/common');
const { bidPlacementRules, bidEditRules, bidDeleteRules } = require('../validators/bid');

// Найвища ставка — перша: за сумою, а за однакової суми — пізніша
const TOP_ORDER = [['amount', 'DESC'], ['id', 'DESC']];

// Лот у вигляді, зручному для функцій-правил
const ruleLot = (lot) => ({
  statusName: lot.status.name,
  startTime: lot.startTime,
  endTime: lot.endTime,
  sellerId: lot.sellerId,
  startPrice: Number(lot.startPrice),
  currentPrice: Number(lot.currentPrice),
  minStep: Number(lot.minStep),
});

const loadLot = (lotId, transaction) => Lot.findByPk(lotId, {
  include: [{ model: LotStatus, as: 'status' }],
  transaction,
});

// Розміщення нової ставки
async function placeBid({ lotId, userId, amount }) {
  return sequelize.transaction(async (t) => {
    const lot = await loadLot(lotId, t);
    if (!lot) throw new ValidationError({ lotId: 'Обраного лоту не існує' });

    const topBid = await Bid.findOne({ where: { lotId }, order: TOP_ORDER, transaction: t });

    const errors = bidPlacementRules({
      lot: ruleLot(lot), userId, amount, topBid: topBid ? { userId: topBid.userId } : null,
    });
    if (hasErrors(errors)) throw new ValidationError(errors);

    const bid = await Bid.create({ amount, lotId, userId }, { transaction: t });
    await BidHistory.create(
      { eventType: 'PLACED', amount, bidId: bid.id, lotId, userId },
      { transaction: t },
    );
    // Попередня найвища ставка перебита
    if (topBid) {
      await BidHistory.create(
        { eventType: 'OUTBID', amount: topBid.amount, bidId: topBid.id, lotId, userId: topBid.userId },
        { transaction: t },
      );
    }
    await lot.update({ currentPrice: amount }, { transaction: t });
    return bid;
  });
}

// Зміна суми ставки (лише найвищої ставки непроданого лоту)
async function updateBidAmount({ bidId, amount }) {
  return sequelize.transaction(async (t) => {
    const bid = await Bid.findByPk(bidId, { transaction: t });
    if (!bid) throw new ValidationError({ _form: 'Ставку не знайдено' });
    const lot = await loadLot(bid.lotId, t);

    const top = await Bid.findAll({
      where: { lotId: bid.lotId }, order: TOP_ORDER, limit: 2, transaction: t,
    });

    const errors = bidEditRules({
      lot: ruleLot(lot),
      bid: { id: bid.id },
      topBids: top.map((b) => ({ id: b.id, amount: Number(b.amount) })),
      amount,
    });
    if (hasErrors(errors)) throw new ValidationError(errors);

    await bid.update({ amount }, { transaction: t });
    await lot.update({ currentPrice: amount }, { transaction: t });
    // Запис «ставку зроблено» в історії має відображати нову суму
    await BidHistory.update({ amount }, { where: { bidId: bid.id, eventType: 'PLACED' }, transaction: t });
    return bid;
  });
}

// Видалення ставки разом із її записами історії; поточна ціна лоту перераховується
async function deleteBid({ bidId }) {
  return sequelize.transaction(async (t) => {
    const bid = await Bid.findByPk(bidId, { transaction: t });
    if (!bid) throw new ValidationError({ _form: 'Ставку не знайдено' });
    const lot = await loadLot(bid.lotId, t);

    const errors = bidDeleteRules({ lot: ruleLot(lot) });
    if (hasErrors(errors)) throw new ValidationError(errors);

    await BidHistory.destroy({ where: { bidId: bid.id }, transaction: t });
    await bid.destroy({ transaction: t });

    const newTop = await Bid.findOne({ where: { lotId: lot.id }, order: TOP_ORDER, transaction: t });
    if (newTop) {
      // Ставка знову найвища, тож подія «перебито» для неї втрачає сенс
      await BidHistory.destroy({ where: { bidId: newTop.id, eventType: 'OUTBID' }, transaction: t });
    }
    await lot.update({ currentPrice: newTop ? newTop.amount : lot.startPrice }, { transaction: t });
  });
}

module.exports = { placeBid, updateBidAmount, deleteBid };
