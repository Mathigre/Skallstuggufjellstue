// Prevent double-booking when approving a request.
// Multiple pending requests may overlap, but an approved booking blocks the same nights.
window.checkOverlap = function checkOverlap(booking) {
  if (!booking || !booking.start_date || !booking.end_date) return null;

  for (const b of allBookings) {
    if (String(b.id) === String(booking.id)) continue;
    if (b.status !== "approved") continue;

    // Checkout day can be the next guest's check-in day.
    const overlaps = booking.start_date < b.end_date && booking.end_date > b.start_date;
    if (overlaps) return b;
  }

  return null;
};
