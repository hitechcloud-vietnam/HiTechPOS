'use strict';

module.exports = {
  id: 'karaoke-bida',
  name: 'Karaoke / Bida',
  description: 'Tính tiền phòng hát, bàn bida theo giờ với block làm tròn, kèm bán đồ uống và đồ ăn vặt.',
  icon: 'music',
  posnicBusinessType: 'cafe',
  features: ['tables', 'mergeSplitTables', 'hourlyBilling', 'services', 'quickSale', 'kitchen', 'serviceCharge', 'loyalty', 'einvoice'],
  units: [
    { code: 'gio', name: 'Giờ' },
    { code: 'phut', name: 'Phút' },
    { code: 'lon', name: 'Lon' },
    { code: 'chai', name: 'Chai' },
    { code: 'dia', name: 'Đĩa' },
    { code: 'thung', name: 'Thùng', conversions: [{ unit: 'lon', factor: 24 }] },
  ],
  categories: ['Giờ phòng karaoke', 'Giờ bàn bida', 'Bia', 'Nước ngọt', 'Đồ ăn vặt', 'Trái cây'],
  /*
   * Time is sold as an ordinary service item whose price is the daytime rate
   * per hour; the table/room settings (sampleTables) bill it by the clock:
   * blocks of 15 minutes, at least 1 hour, and a higher evening rate.
   */
  sampleItems: [
    { name: 'Giờ hát phòng thường', category: 'Giờ phòng karaoke', unit: 'gio', price: 150000, vatRate: 10 },
    { name: 'Giờ hát phòng VIP', category: 'Giờ phòng karaoke', unit: 'gio', price: 300000, vatRate: 10 },
    { name: 'Giờ chơi bida lỗ', category: 'Giờ bàn bida', unit: 'gio', price: 60000, vatRate: 8 },
    { name: 'Giờ chơi bida phăng', category: 'Giờ bàn bida', unit: 'gio', price: 50000, vatRate: 8 },
    { name: 'Bia Heineken lon 330ml', category: 'Bia', unit: 'lon', price: 30000, vatRate: 10 },
    { name: 'Nước suối Lavie 500ml', category: 'Nước ngọt', unit: 'chai', price: 10000, vatRate: 8 },
    { name: 'Đĩa trái cây thập cẩm', category: 'Trái cây', unit: 'dia', price: 120000, vatRate: 8 },
    { name: 'Khô bò', category: 'Đồ ăn vặt', unit: 'dia', price: 80000, vatRate: 8 },
  ],
  // Rooms and tables with their time billing (Posnic table labels: 1-6 letters/digits).
  sampleTables: [
    {
      label: 'P01', area: 'Karaoke', capacity: 8, item: 'Giờ hát phòng thường',
      timeBilling: { blockMinutes: 15, minBlocks: 4, graceMinutes: 5, bands: [{ start: '18:00', end: '24:00', rate: 180000, label: 'Buổi tối' }] },
    },
    {
      label: 'P02', area: 'Karaoke', capacity: 8, item: 'Giờ hát phòng thường',
      timeBilling: { blockMinutes: 15, minBlocks: 4, graceMinutes: 5, bands: [{ start: '18:00', end: '24:00', rate: 180000, label: 'Buổi tối' }] },
    },
    {
      label: 'VIP1', area: 'Karaoke', capacity: 15, item: 'Giờ hát phòng VIP',
      timeBilling: { blockMinutes: 15, minBlocks: 4, graceMinutes: 5, bands: [{ start: '18:00', end: '24:00', rate: 350000, label: 'Buổi tối' }] },
    },
    { label: 'BIDA1', area: 'Bida', capacity: 4, item: 'Giờ chơi bida lỗ', timeBilling: { blockMinutes: 5, minBlocks: 6, graceMinutes: 0, bands: [] } },
    { label: 'BIDA2', area: 'Bida', capacity: 4, item: 'Giờ chơi bida phăng', timeBilling: { blockMinutes: 5, minBlocks: 6, graceMinutes: 0, bands: [] } },
  ],
  settings: { hourlyBlockMinutes: 15, minimumMinutes: 60 },
  receipt: { template: 'k80', showVatBreakdown: true, footer: 'Cảm ơn quý khách! Chúc quý khách vui vẻ.' },
  payments: ['cash', 'vietqr', 'payos', 'card', 'momo'],
  vatDefault: 10,
  recommendedPlan: 'pro',
  recommendedApps: ['pos-web', 'mobile-pos', 'business'],
};
