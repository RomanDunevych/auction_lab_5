const { Lot, LotStatus, User, Bid, Category } = require('../models');

// GET / — головна сторінка зі статистикою та останніми активними лотами
exports.index = async (req, res) => {
  const activeStatus = await LotStatus.findOne({ where: { name: 'active' } });

  const [lotsCount, usersCount, bidsCount, activeCount, latestLots] = await Promise.all([
    Lot.count(),
    User.count(),
    Bid.count(),
    activeStatus ? Lot.count({ where: { statusId: activeStatus.id } }) : 0,
    Lot.findAll({
      where: activeStatus ? { statusId: activeStatus.id } : {},
      include: [
        { model: Category, as: 'category' },
        { model: LotStatus, as: 'status' },
      ],
      order: [['endTime', 'ASC']],
      limit: 3,
    }),
  ]);

  res.render('home', {
    title: 'Головна',
    stats: { lotsCount, usersCount, bidsCount, activeCount },
    latestLots,
  });
};
