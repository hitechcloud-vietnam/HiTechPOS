'use strict';

module.exports = {
  id: 'thoi-trang',
  name: 'Thời trang / Giày dép',
  description: 'Quần áo, giày dép, phụ kiện: biến thể size - màu, mã vạch theo biến thể, đổi trả hàng, tích điểm.',
  icon: 'shirt',
  posnicBusinessType: 'textile',
  features: ['barcode', 'variants', 'returns', 'loyalty', 'onlineOrdering', 'delivery', 'einvoice'],
  units: [
    { code: 'cai', name: 'Cái' },
    { code: 'doi', name: 'Đôi' },
    { code: 'bo', name: 'Bộ' },
    { code: 'chiec', name: 'Chiếc' },
  ],
  categories: ['Áo', 'Quần', 'Váy đầm', 'Đồ bộ', 'Giày', 'Dép & sandal', 'Túi xách', 'Phụ kiện'],
  sampleItems: [
    { name: 'Áo thun cotton cổ tròn', category: 'Áo', unit: 'cai', price: 159000, vatRate: 8, barcode: '2000000001012' },
    { name: 'Áo sơ mi nam tay dài', category: 'Áo', unit: 'cai', price: 299000, vatRate: 8 },
    { name: 'Quần jean nữ ống suông', category: 'Quần', unit: 'cai', price: 389000, vatRate: 8 },
    { name: 'Đầm voan hoa nhí', category: 'Váy đầm', unit: 'cai', price: 459000, vatRate: 8 },
    { name: 'Giày sneaker trắng', category: 'Giày', unit: 'doi', price: 650000, vatRate: 8 },
    { name: 'Dép quai ngang', category: 'Dép & sandal', unit: 'doi', price: 129000, vatRate: 8 },
    { name: 'Túi tote canvas', category: 'Túi xách', unit: 'cai', price: 199000, vatRate: 8 },
  ],
  settings: { variantAxes: ['Size', 'Màu'], returnWindowDays: 7 },
  receipt: { template: 'k80', showVatBreakdown: false, footer: 'Cảm ơn bạn! Đổi hàng trong 7 ngày kèm hóa đơn.' },
  payments: ['cash', 'vietqr', 'payos', 'card', 'momo', 'zalopay'],
  vatDefault: 8,
  recommendedPlan: 'basic',
  recommendedApps: ['pos-web', 'mobile-pos', 'business'],
};
