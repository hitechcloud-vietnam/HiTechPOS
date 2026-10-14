'use strict';

module.exports = {
  id: 'khac',
  name: 'Bán lẻ khác',
  description: 'Cấu hình chung cho các cửa hàng bán lẻ không thuộc ngành nào ở trên; bật thêm tính năng khi cần.',
  icon: 'shop',
  posnicBusinessType: 'supermarket',
  features: ['barcode', 'quickSale', 'returns', 'debtLedger', 'loyalty', 'einvoice'],
  units: [
    { code: 'cai', name: 'Cái' },
    { code: 'hop', name: 'Hộp' },
    { code: 'goi', name: 'Gói' },
    { code: 'bo', name: 'Bộ' },
    { code: 'kg', name: 'Kg' },
  ],
  categories: ['Hàng hóa', 'Dịch vụ', 'Khác'],
  sampleItems: [
    { name: 'Sản phẩm mẫu A', category: 'Hàng hóa', unit: 'cai', price: 50000, vatRate: 8 },
    { name: 'Sản phẩm mẫu B', category: 'Hàng hóa', unit: 'hop', price: 120000, vatRate: 8 },
    { name: 'Sản phẩm mẫu C', category: 'Hàng hóa', unit: 'goi', price: 25000, vatRate: 8 },
    { name: 'Bộ quà tặng', category: 'Hàng hóa', unit: 'bo', price: 299000, vatRate: 8 },
    { name: 'Phí dịch vụ lắp đặt', category: 'Dịch vụ', unit: 'cai', price: 100000, vatRate: 8 },
  ],
  receipt: { template: 'k80', showVatBreakdown: false, footer: 'Cảm ơn quý khách! Hẹn gặp lại.' },
  payments: ['cash', 'vietqr', 'payos', 'momo'],
  vatDefault: 8,
  recommendedPlan: 'free',
  recommendedApps: ['pos-web', 'mobile-pos'],
};
