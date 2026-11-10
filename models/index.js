const sequelize = require('../config/database');
const User = require('./User');
const Category = require('./Category');
const LotStatus = require('./LotStatus');
const Lot = require('./Lot');
const Bid = require('./Bid');
const BidHistory = require('./BidHistory');

// User <-> Lot (продавець)
User.hasMany(Lot, { foreignKey: { name: 'sellerId', allowNull: false }, as: 'lotsForSale' });
Lot.belongsTo(User, { foreignKey: { name: 'sellerId', allowNull: false }, as: 'seller' });

// User <-> Lot (переможець, може бути порожнім)
User.hasMany(Lot, { foreignKey: { name: 'winnerId', allowNull: true }, as: 'wonLots' });
Lot.belongsTo(User, { foreignKey: { name: 'winnerId', allowNull: true }, as: 'winner' });

// Category <-> Lot
Category.hasMany(Lot, { foreignKey: { name: 'categoryId', allowNull: false }, as: 'lots' });
Lot.belongsTo(Category, { foreignKey: { name: 'categoryId', allowNull: false }, as: 'category' });

// LotStatus <-> Lot
LotStatus.hasMany(Lot, { foreignKey: { name: 'statusId', allowNull: false }, as: 'lots' });
Lot.belongsTo(LotStatus, { foreignKey: { name: 'statusId', allowNull: false }, as: 'status' });

// Lot <-> Bid
Lot.hasMany(Bid, { foreignKey: { name: 'lotId', allowNull: false }, as: 'bids' });
Bid.belongsTo(Lot, { foreignKey: { name: 'lotId', allowNull: false }, as: 'lot' });

// User <-> Bid
User.hasMany(Bid, { foreignKey: { name: 'userId', allowNull: false }, as: 'bids' });
Bid.belongsTo(User, { foreignKey: { name: 'userId', allowNull: false }, as: 'bidder' });

// Bid <-> BidHistory
Bid.hasMany(BidHistory, { foreignKey: { name: 'bidId', allowNull: false }, as: 'history' });
BidHistory.belongsTo(Bid, { foreignKey: { name: 'bidId', allowNull: false }, as: 'bid' });

// Lot <-> BidHistory
Lot.hasMany(BidHistory, { foreignKey: { name: 'lotId', allowNull: false }, as: 'bidHistory' });
BidHistory.belongsTo(Lot, { foreignKey: { name: 'lotId', allowNull: false }, as: 'lot' });

// User <-> BidHistory
User.hasMany(BidHistory, { foreignKey: { name: 'userId', allowNull: false }, as: 'bidHistory' });
BidHistory.belongsTo(User, { foreignKey: { name: 'userId', allowNull: false }, as: 'user' });

module.exports = { sequelize, User, Category, LotStatus, Lot, Bid, BidHistory };
