'use strict';

const { searchNormalize } = require('./text');

/**
 * Provincial-level administrative units effective 1/7/2025
 * (Nghị quyết 202/2025/QH15 on rearranging provincial units): 34 units = 6 centrally-run
 * cities + 28 provinces. `id` is a stable slug chosen by HiTechPOS, NOT the official
 * numeric code from the national administrative-unit list. `mergedFrom` lists the
 * pre-merger provinces folded into the unit (empty when unchanged).
 */
const RAW = [
  ['ha-noi', 'Hà Nội', 'city', []],
  ['hue', 'Huế', 'city', []],
  ['hai-phong', 'Hải Phòng', 'city', ['Hải Dương']],
  ['da-nang', 'Đà Nẵng', 'city', ['Quảng Nam']],
  ['ho-chi-minh', 'Thành phố Hồ Chí Minh', 'city', ['Bình Dương', 'Bà Rịa - Vũng Tàu']],
  ['can-tho', 'Cần Thơ', 'city', ['Sóc Trăng', 'Hậu Giang']],
  ['lai-chau', 'Lai Châu', 'province', []],
  ['dien-bien', 'Điện Biên', 'province', []],
  ['son-la', 'Sơn La', 'province', []],
  ['lang-son', 'Lạng Sơn', 'province', []],
  ['cao-bang', 'Cao Bằng', 'province', []],
  ['quang-ninh', 'Quảng Ninh', 'province', []],
  ['thanh-hoa', 'Thanh Hóa', 'province', []],
  ['nghe-an', 'Nghệ An', 'province', []],
  ['ha-tinh', 'Hà Tĩnh', 'province', []],
  ['tuyen-quang', 'Tuyên Quang', 'province', ['Hà Giang']],
  ['lao-cai', 'Lào Cai', 'province', ['Yên Bái']],
  ['thai-nguyen', 'Thái Nguyên', 'province', ['Bắc Kạn']],
  ['phu-tho', 'Phú Thọ', 'province', ['Vĩnh Phúc', 'Hòa Bình']],
  ['bac-ninh', 'Bắc Ninh', 'province', ['Bắc Giang']],
  ['hung-yen', 'Hưng Yên', 'province', ['Thái Bình']],
  ['ninh-binh', 'Ninh Bình', 'province', ['Hà Nam', 'Nam Định']],
  ['quang-tri', 'Quảng Trị', 'province', ['Quảng Bình']],
  ['quang-ngai', 'Quảng Ngãi', 'province', ['Kon Tum']],
  ['gia-lai', 'Gia Lai', 'province', ['Bình Định']],
  ['khanh-hoa', 'Khánh Hòa', 'province', ['Ninh Thuận']],
  ['lam-dong', 'Lâm Đồng', 'province', ['Đắk Nông', 'Bình Thuận']],
  ['dak-lak', 'Đắk Lắk', 'province', ['Phú Yên']],
  ['dong-nai', 'Đồng Nai', 'province', ['Bình Phước']],
  ['tay-ninh', 'Tây Ninh', 'province', ['Long An']],
  ['vinh-long', 'Vĩnh Long', 'province', ['Bến Tre', 'Trà Vinh']],
  ['dong-thap', 'Đồng Tháp', 'province', ['Tiền Giang']],
  ['an-giang', 'An Giang', 'province', ['Kiên Giang']],
  ['ca-mau', 'Cà Mau', 'province', ['Bạc Liêu']],
];

const PROVINCES = Object.freeze(
  RAW.map(([id, name, type, mergedFrom]) => Object.freeze({ id, name, type, mergedFrom: Object.freeze(mergedFrom) })),
);

/**
 * Find a unit by id, name or a pre-merger province name (diacritic-insensitive):
 * findProvince('Bình Dương') -> Thành phố Hồ Chí Minh. Accepts "TP HCM"/"TP.HCM"/"HCM".
 */
function findProvince(query) {
  const key = norm(query).replace(/^(thanh pho|tp|tinh)\s*/, '');
  if (!key) return undefined;
  if (['hcm', 'tphcm', 'sai gon', 'saigon'].includes(key)) return PROVINCES.find((p) => p.id === 'ho-chi-minh');
  return PROVINCES.find((p) => p.id === key.replace(/\s+/g, '-') || norm(p.name).replace(/^thanh pho /, '') === key)
    || PROVINCES.find((p) => p.mergedFrom.some((m) => norm(m) === key));
}

function norm(s) {
  return searchNormalize(s).replace(/[.\-]/g, ' ').replace(/\s+/g, ' ').trim();
}

module.exports = { PROVINCES, findProvince };
