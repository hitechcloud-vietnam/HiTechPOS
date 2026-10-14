'use strict';

module.exports = {
  id: 'cafe-tra-sua',
  name: 'Cà phê / Trà sữa',
  description: 'Quán đồ uống: topping, size S/M/L, order tại quầy hoặc tại bàn, in tem dán ly.',
  icon: 'coffee',
  posnicBusinessType: 'cafe',
  features: ['quickSale', 'modifiers', 'variants', 'tables', 'kitchen', 'cupLabels', 'loyalty', 'onlineOrdering', 'delivery', 'recipes', 'einvoice'],
  units: [
    { code: 'ly', name: 'Ly' },
    { code: 'chai', name: 'Chai' },
    { code: 'phan', name: 'Phần' },
    { code: 'cai', name: 'Cái' },
  ],
  categories: ['Cà phê', 'Trà sữa', 'Trà trái cây', 'Đá xay', 'Nước ép & sinh tố', 'Topping', 'Bánh ngọt'],
  sampleItems: [
    { name: 'Cà phê sữa đá', category: 'Cà phê', unit: 'ly', price: 29000, vatRate: 8 },
    { name: 'Cà phê đen đá', category: 'Cà phê', unit: 'ly', price: 25000, vatRate: 8 },
    { name: 'Bạc xỉu', category: 'Cà phê', unit: 'ly', price: 32000, vatRate: 8 },
    { name: 'Trà sữa trân châu đường đen (M)', category: 'Trà sữa', unit: 'ly', price: 39000, vatRate: 8 },
    { name: 'Trà đào cam sả', category: 'Trà trái cây', unit: 'ly', price: 45000, vatRate: 8 },
    { name: 'Matcha đá xay', category: 'Đá xay', unit: 'ly', price: 55000, vatRate: 8 },
    { name: 'Topping trân châu trắng', category: 'Topping', unit: 'phan', price: 8000, vatRate: 8 },
    { name: 'Topping kem cheese', category: 'Topping', unit: 'phan', price: 12000, vatRate: 8 },
  ],
  settings: { sizes: [{ code: 'S', priceDelta: 0 }, { code: 'M', priceDelta: 6000 }, { code: 'L', priceDelta: 10000 }] },
  receipt: { template: 'k80', showVatBreakdown: false, footer: 'Cảm ơn bạn đã ghé quán! Hẹn gặp lại nhé.' },
  payments: ['cash', 'vietqr', 'payos', 'momo', 'zalopay', 'card'],
  vatDefault: 8,
  recommendedPlan: 'basic',
  recommendedApps: ['pos-web', 'mobile-pos', 'business'],
};
