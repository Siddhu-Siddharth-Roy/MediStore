// Single definition of expiry rules, shared by every query so the UI never disagrees with itself.
//   EXPIRED        : expiry date is before today (the expiry date itself is still sellable)
//   EXPIRING SOON  : expires within the next 90 days
//   VALID          : everything else
exports.EXPIRING_SOON_DAYS = 90;
exports.expiryStatusSql = (col = 'expiry_date') =>
  `CASE WHEN ${col} < CURDATE() THEN 'EXPIRED' WHEN ${col} <= DATE_ADD(CURDATE(), INTERVAL 90 DAY) THEN 'EXPIRING SOON' ELSE 'VALID' END`;
