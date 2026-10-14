'use strict';

module.exports = {
  id: 'nong-san-thuc-pham',
  name: 'Nông sản / Thực phẩm tươi',
  description: 'Rau củ, trái cây, thịt cá: bán theo cân với cân điện tử in tem, theo dõi hao hụt, hạn dùng ngắn.',
  icon: 'produce',
  posnicBusinessType: 'grocery',
  features: ['weighing', 'barcode', 'quickSale', 'wastage', 'batchExpiry', 'unitConversion', 'debtLedger', 'delivery', 'einvoice'],
  units: [
    { code: 'kg', name: 'Kg' },
    { code: 'g', name: 'Gram' },
    { code: 'bo', name: 'Bó' },
    { code: 'trai', name: 'Trái' },
    { code: 'khay', name: 'Khay' },
    { code: 'thung', name: 'Thùng', conversions: [{ unit: 'kg', factor: 10 }] },
  ],
  categories: ['Rau ăn lá', 'Củ quả', 'Trái cây', 'Thịt', 'Hải sản', 'Trứng', 'Gạo & ngũ cốc', 'Đồ khô'],
  sampleItems: [
    { name: 'Rau muống', unit: 'bo', price: 12000, vatRate: 5 },
    { name: 'Cà chua', unit: 'kg', price: 28000, vatRate: 5 },
    { name: 'Khoai tây Đà Lạt', unit: 'kg', price: 32000, vatRate: 5 },
    { name: 'Xoài cát Hòa Lộc', unit: 'kg', price: 75000, vatRate: 5 },
    { name: 'Thịt ba chỉ heo', unit: 'kg', price: 165000, vatRate: 5 },
    { name: 'Cá basa phi lê', unit: 'kg', price: 95000, vatRate: 5 },
    { name: 'Trứng gà ta (khay 10 quả)', unit: 'khay', price: 45000, vatRate: 5 },
    { name: 'Gạo ST25', unit: 'kg', price: 38000, vatRate: 5 },
  ],
  receipt: { template: 'k58', showVatBreakdown: false, footer: 'Cảm ơn quý khách! Thực phẩm tươi mỗi ngày.' },
  payments: ['cash', 'vietqr', 'payos', 'momo', 'debt'],
  vatDefault: 5,
  recommendedPlan: 'free',
  recommendedApps: ['pos-web', 'mobile-pos'],
};
