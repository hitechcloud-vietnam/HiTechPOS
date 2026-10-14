'use strict';

module.exports = {
  id: 'dien-thoai-dien-may',
  name: 'Điện thoại / Điện máy',
  description: 'Điện thoại, laptop, điện gia dụng: quản lý IMEI/serial, phiếu bảo hành, bán trả góp, đổi trả.',
  icon: 'phone',
  posnicBusinessType: 'electrical',
  features: ['barcode', 'serialImei', 'warranty', 'installments', 'variants', 'returns', 'debtLedger', 'loyalty', 'delivery', 'einvoice'],
  units: [
    { code: 'cai', name: 'Cái' },
    { code: 'chiec', name: 'Chiếc' },
    { code: 'bo', name: 'Bộ' },
    { code: 'hop', name: 'Hộp' },
  ],
  categories: ['Điện thoại', 'Máy tính bảng', 'Laptop', 'Phụ kiện', 'Tivi', 'Tủ lạnh', 'Máy giặt', 'Điều hòa', 'Gia dụng nhỏ'],
  sampleItems: [
    { name: 'iPhone 16 128GB', category: 'Điện thoại', unit: 'chiec', price: 19990000, vatRate: 10 },
    { name: 'Samsung Galaxy A56 5G 8GB/128GB', category: 'Điện thoại', unit: 'chiec', price: 9490000, vatRate: 10 },
    { name: 'Xiaomi Redmi Note 14 8GB/256GB', category: 'Điện thoại', unit: 'chiec', price: 5690000, vatRate: 10 },
    { name: 'Tai nghe Bluetooth AirPods 4', category: 'Phụ kiện', unit: 'cai', price: 3290000, vatRate: 10 },
    { name: 'Củ sạc nhanh 20W USB-C', category: 'Phụ kiện', unit: 'cai', price: 390000, vatRate: 10 },
    { name: 'Smart Tivi 55 inch 4K', category: 'Tivi', unit: 'chiec', price: 10990000, vatRate: 10 },
    { name: 'Máy giặt cửa trước 9kg Inverter', category: 'Máy giặt', unit: 'chiec', price: 8490000, vatRate: 10 },
    { name: 'Nồi cơm điện 1,8 lít', category: 'Gia dụng nhỏ', unit: 'cai', price: 890000, vatRate: 8 },
  ],
  settings: { defaultWarrantyMonths: 12 },
  receipt: { template: 'k80', showVatBreakdown: true, footer: 'Cảm ơn quý khách! Vui lòng giữ hóa đơn để được bảo hành.' },
  payments: ['cash', 'vietqr', 'payos', 'pay2s', 'card', 'momo', 'zalopay'],
  vatDefault: 10,
  recommendedPlan: 'pro',
  recommendedApps: ['pos-web', 'business'],
};
