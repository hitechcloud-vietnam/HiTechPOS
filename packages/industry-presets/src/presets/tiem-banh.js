'use strict';

module.exports = {
  id: 'tiem-banh',
  name: 'Tiệm bánh',
  description: 'Bánh mì, bánh ngọt, bánh kem: định lượng nguyên liệu theo công thức, nhận đặt bánh trước có đặt cọc, ghi hao hụt cuối ngày.',
  icon: 'cake',
  posnicBusinessType: 'bakery',
  features: ['quickSale', 'barcode', 'recipes', 'preorders', 'batchExpiry', 'wastage', 'variants', 'modifiers', 'cupLabels', 'loyalty', 'delivery', 'einvoice'],
  units: [
    { code: 'cai', name: 'Cái' },
    { code: 'o', name: 'Ổ' },
    { code: 'hop', name: 'Hộp', conversions: [{ unit: 'cai', factor: 6 }] },
    { code: 'kg', name: 'Kg' },
    { code: 'g', name: 'Gram' },
  ],
  categories: ['Bánh mì', 'Bánh ngọt', 'Bánh kem', 'Bánh quy', 'Bánh theo mùa', 'Đồ uống', 'Nguyên liệu'],
  sampleItems: [
    { name: 'Bánh mì que pate', unit: 'cai', price: 12000, vatRate: 8 },
    { name: 'Bánh mì sandwich nguyên cám', unit: 'o', price: 35000, vatRate: 8 },
    { name: 'Bánh croissant bơ', unit: 'cai', price: 28000, vatRate: 8 },
    { name: 'Bánh bông lan trứng muối', unit: 'hop', price: 85000, vatRate: 8 },
    { name: 'Bánh su kem (hộp 6 cái)', unit: 'hop', price: 45000, vatRate: 8 },
    { name: 'Bánh kem sinh nhật 18cm', unit: 'cai', price: 350000, vatRate: 8 },
    { name: 'Bánh tiramisu ly', unit: 'cai', price: 39000, vatRate: 8 },
  ],
  settings: { preorderDepositPercent: 30 },
  receipt: { template: 'k58', showVatBreakdown: false, footer: 'Cảm ơn quý khách! Bánh ngon nhất khi dùng trong ngày.' },
  payments: ['cash', 'vietqr', 'payos', 'momo', 'zalopay'],
  vatDefault: 8,
  recommendedPlan: 'basic',
  recommendedApps: ['pos-web', 'mobile-pos', 'business'],
};
