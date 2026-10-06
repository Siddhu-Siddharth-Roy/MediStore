// Order lifecycle. Staff move an order forward one step at a time; cancellation is a side exit.
exports.FLOW = ['Pending', 'Confirmed', 'Processing', 'Packed', 'Dispatched', 'Out for Delivery', 'Delivered'];
exports.ALL = [...exports.FLOW, 'Cancelled'];
exports.nextOf = (s) => { const i = exports.FLOW.indexOf(s); return i >= 0 && i < exports.FLOW.length - 1 ? exports.FLOW[i + 1] : null; };
// Customers may cancel until staff start processing; staff until the parcel is packed. After that the goods have left the shelf.
exports.CUSTOMER_CANCELLABLE = ['Pending', 'Confirmed'];
exports.STAFF_CANCELLABLE = ['Pending', 'Confirmed', 'Processing', 'Packed'];
exports.CUSTOMER_MESSAGES = {
  Pending: 'has been placed', Confirmed: 'has been confirmed', Processing: 'is being processed', Packed: 'has been packed',
  Dispatched: 'has been dispatched', 'Out for Delivery': 'is out for delivery', Delivered: 'has been delivered', Cancelled: 'has been cancelled'
};
