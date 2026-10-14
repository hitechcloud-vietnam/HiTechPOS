'use strict';

module.exports = {
  id: 'my-pham',
  name: 'Mỹ phẩm',
  description: 'Cửa hàng mỹ phẩm, chăm sóc da: hạn sử dụng, tích điểm, biến thể dung tích/màu son, bán online.',
  icon: 'cosmetics',
  posnicBusinessType: 'supermarket',
  features: ['barcode', 'batchExpiry', 'variants', 'loyalty', 'returns', 'onlineOrdering', 'delivery', 'einvoice'],
  units: [
    { code: 'chai', name: 'Chai' },
    { code: 'tuyp', name: 'Tuýp' },
    { code: 'hop', name: 'Hộp' },
    { code: 'cay', name: 'Cây' },
    { code: 'mieng', name: 'Miếng' },
  ],
  categories: ['Chăm sóc da mặt', 'Trang điểm', 'Chống nắng', 'Chăm sóc tóc', 'Chăm sóc cơ thể', 'Nước hoa', 'Mặt nạ'],
  sampleItems: [
    { name: 'Sữa rửa mặt dịu nhẹ 150ml', unit: 'tuyp', price: 185000, vatRate: 8 },
    { name: 'Nước tẩy trang micellar 400ml', unit: 'chai', price: 229000, vatRate: 8 },
    { name: 'Kem chống nắng SPF50+ 50ml', unit: 'tuyp', price: 395000, vatRate: 8 },
    { name: 'Serum Vitamin C 30ml', unit: 'chai', price: 450000, vatRate: 8 },
    { name: 'Son thỏi lì màu đỏ gạch', unit: 'cay', price: 259000, vatRate: 8 },
    { name: 'Mặt nạ giấy cấp ẩm', unit: 'mieng', price: 25000, vatRate: 8 },
    { name: 'Dầu gội thảo dược 650ml', unit: 'chai', price: 165000, vatRate: 8 },
  ],
  receipt: { template: 'k80', showVatBreakdown: false, footer: 'Cảm ơn bạn! Chúc bạn luôn xinh đẹp.' },
  payments: ['cash', 'vietqr', 'payos', 'card', 'momo', 'zalopay'],
  vatDefault: 8,
  recommendedPlan: 'basic',
  recommendedApps: ['pos-web', 'mobile-pos', 'business'],
};
