const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const BidHistory = sequelize.define('BidHistory', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  eventType: {
    type: DataTypes.ENUM('PLACED', 'OUTBID', 'WON', 'CANCELLED'),
    allowNull: false,
  },
  amount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
}, { tableName: 'bid_history', updatedAt: false });

module.exports = BidHistory;
