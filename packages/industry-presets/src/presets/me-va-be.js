'use strict';

module.exports = {
  id: 'me-va-be',
  name: 'Mẹ & bé',
  description: 'Sữa, bỉm, đồ dùng trẻ em: quản lý hạn dùng, tích điểm thành viên, quy đổi thùng/hộp.',
  icon: 'baby',
  posnicBusinessType: 'supermarket',
  features: ['barcode', 'unitConversion', 'batchExpiry', 'loyalty', 'returns', 'variants', 'onlineOrdering', 'delivery', 'einvoice'],
  units: [
    { code: 'hop', name: 'Hộp' },
    { code: 'lon', name: 'Lon' },
    { code: 'goi', name: 'Gói' },
    { code: 'bich', name: 'Bịch' },
    { code: 'cai', name: 'Cái' },
    { code: 'thung', name: 'Thùng', conversions: [{ unit: 'hop', factor: 48 }] },
  ],
  categories: ['Sữa bột', 'Sữa pha sẵn', 'Bỉm tã', 'Ăn dặm', 'Bình sữa & phụ kiện', 'Quần áo trẻ em', 'Đồ chơi'],
  sampleItems: [
    { name: 'Sữa bột Similac số 4 lon 900g', category: 'Sữa bột', unit: 'lon', price: 645000, vatRate: 8 },
    { name: 'Sữa bột Optimum Gold số 3 lon 850g', category: 'Sữa bột', unit: 'lon', price: 475000, vatRate: 8 },
    { name: 'Sữa pha sẵn Grow Plus 110ml', category: 'Sữa pha sẵn', unit: 'hop', price: 8500, vatRate: 8 },
    { name: 'Tã dán Bobby size M 76 miếng', category: 'Bỉm tã', unit: 'bich', price: 345000, vatRate: 8 },
    { name: 'Tã quần Huggies size L 62 miếng', category: 'Bỉm tã', unit: 'bich', price: 389000, vatRate: 8 },
    { name: 'Bột ăn dặm vị gạo sữa 200g', category: 'Ăn dặm', unit: 'hop', price: 89000, vatRate: 8 },
    { name: 'Bình sữa cổ rộng 240ml', category: 'Bình sữa & phụ kiện', unit: 'cai', price: 259000, vatRate: 8 },
  ],
  receipt: { template: 'k80', showVatBreakdown: false, footer: 'Cảm ơn ba mẹ! Chúc bé luôn khỏe mạnh.' },
  payments: ['cash', 'vietqr', 'payos', 'card', 'momo', 'zalopay'],
  vatDefault: 8,
  recommendedPlan: 'basic',
  recommendedApps: ['pos-web', 'mobile-pos', 'business'],
};
