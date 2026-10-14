'use strict';

module.exports = {
  id: 'nha-thuoc',
  name: 'Nhà thuốc',
  description: 'Quầy thuốc, nhà thuốc GPP: quản lý lô và hạn dùng, xuất FEFO, thuốc kê đơn, liên thông Cơ sở dữ liệu Dược quốc gia.',
  icon: 'pharmacy',
  posnicBusinessType: 'supermarket',
  features: ['barcode', 'unitConversion', 'batchExpiry', 'fefo', 'prescriptions', 'nationalPharmacyLink', 'debtLedger', 'loyalty', 'returns', 'wastage', 'einvoice'],
  units: [
    { code: 'vien', name: 'Viên' },
    { code: 'vi', name: 'Vỉ', conversions: [{ unit: 'vien', factor: 10 }] },
    { code: 'hop', name: 'Hộp', conversions: [{ unit: 'vi', factor: 10 }] },
    { code: 'chai', name: 'Chai' },
    { code: 'tuyp', name: 'Tuýp' },
    { code: 'goi', name: 'Gói' },
  ],
  categories: ['Thuốc kê đơn', 'Thuốc không kê đơn', 'Thực phẩm chức năng', 'Vitamin & khoáng chất', 'Dụng cụ y tế', 'Chăm sóc cá nhân'],
  sampleItems: [
    { name: 'Panadol Extra (hộp 12 vỉ x 10 viên)', category: 'Thuốc không kê đơn', unit: 'hop', price: 195000, vatRate: 5 },
    { name: 'Paracetamol 500mg (vỉ 10 viên)', category: 'Thuốc không kê đơn', unit: 'vi', price: 5000, vatRate: 5 },
    { name: 'Berberin 100mg (lọ 100 viên)', category: 'Thuốc không kê đơn', unit: 'chai', price: 15000, vatRate: 5 },
    { name: 'Amoxicillin 500mg (vỉ 10 viên) - kê đơn', category: 'Thuốc kê đơn', unit: 'vi', price: 18000, vatRate: 5 },
    { name: 'Siro ho Prospan 100ml', category: 'Thuốc không kê đơn', unit: 'chai', price: 98000, vatRate: 5 },
    { name: 'Oresol gói 4,1g', category: 'Thuốc không kê đơn', unit: 'goi', price: 3000, vatRate: 5 },
    { name: 'Vitamin C 500mg (tuýp 20 viên sủi)', category: 'Vitamin & khoáng chất', unit: 'tuyp', price: 45000, vatRate: 8 },
    { name: 'Khẩu trang y tế 4 lớp (hộp 50 cái)', category: 'Dụng cụ y tế', unit: 'hop', price: 35000, vatRate: 5 },
  ],
  receipt: { template: 'k80', showVatBreakdown: true, footer: 'Cảm ơn quý khách! Vui lòng dùng thuốc theo chỉ dẫn của dược sĩ.' },
  payments: ['cash', 'vietqr', 'payos', 'card', 'momo'],
  vatDefault: 5,
  recommendedPlan: 'pro',
  recommendedApps: ['pos-web', 'business'],
};
