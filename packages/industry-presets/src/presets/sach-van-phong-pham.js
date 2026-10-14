'use strict';

module.exports = {
  id: 'sach-van-phong-pham',
  name: 'Nhà sách / Văn phòng phẩm',
  description: 'Sách, báo, dụng cụ học tập, văn phòng phẩm: quét mã ISBN/mã vạch, quy đổi hộp/lốc, công nợ khách sỉ.',
  icon: 'book',
  posnicBusinessType: 'supermarket',
  features: ['barcode', 'quickSale', 'unitConversion', 'debtLedger', 'loyalty', 'returns', 'einvoice'],
  units: [
    { code: 'cuon', name: 'Cuốn' },
    { code: 'cay', name: 'Cây' },
    { code: 'cai', name: 'Cái' },
    { code: 'ram', name: 'Ram' },
    { code: 'hop', name: 'Hộp', conversions: [{ unit: 'cay', factor: 20 }] },
    { code: 'loc', name: 'Lốc', conversions: [{ unit: 'cuon', factor: 10 }] },
  ],
  categories: ['Sách giáo khoa', 'Sách tham khảo', 'Văn học', 'Thiếu nhi', 'Vở & giấy', 'Bút viết', 'Dụng cụ học tập', 'Văn phòng phẩm'],
  sampleItems: [
    { name: 'Sách giáo khoa Toán 6 (tập 1)', category: 'Sách giáo khoa', unit: 'cuon', price: 23000, vatRate: 'KCT' },
    { name: 'Tiểu thuyết văn học (bìa mềm)', category: 'Văn học', unit: 'cuon', price: 128000, vatRate: 5 },
    { name: 'Vở kẻ ngang 200 trang', category: 'Vở & giấy', unit: 'cuon', price: 18000, vatRate: 8 },
    { name: 'Bút bi Thiên Long TL-027', category: 'Bút viết', unit: 'cay', price: 5000, vatRate: 8 },
    { name: 'Giấy in A4 Double A 70gsm', category: 'Văn phòng phẩm', unit: 'ram', price: 85000, vatRate: 8 },
    { name: 'Bút chì gỗ 2B', category: 'Bút viết', unit: 'cay', price: 4000, vatRate: 8 },
    { name: 'Hộp bút chì màu 24 màu', category: 'Dụng cụ học tập', unit: 'hop', price: 65000, vatRate: 8 },
  ],
  receipt: { template: 'k80', showVatBreakdown: true, footer: 'Cảm ơn quý khách! Chúc quý khách học tốt, làm việc hiệu quả.' },
  payments: ['cash', 'vietqr', 'payos', 'card', 'momo', 'debt'],
  vatDefault: 8,
  recommendedPlan: 'basic',
  recommendedApps: ['pos-web', 'business'],
};
