'use strict';

/*
 * Canonical feature catalog.
 *
 * Every preset carries exactly these keys (no more, no less). Each entry says
 * where the capability lives in upstream Posnic POS (api/src/...), so the
 * control plane knows which branch setting to flip after install and which
 * capabilities HiTechPOS still has to build.
 *
 * support:
 *   'native'    - Posnic already does it; hitechExtension = false
 *   'partial'   - Posnic has a building block, HiTechPOS must extend it;
 *                 hitechExtension = true, posnic names the building block
 *   'extension' - nothing upstream; hitechExtension = true, posnic = null
 *
 * posnicSetting is set only when the capability is gated by a real boolean
 * branch setting (see api/src/services/settings-groups.js and
 * InstallService.newShopModuleDefaults in api/src/services/install.service.js).
 */

const SUPPORT = Object.freeze(['native', 'partial', 'extension']);

const CATALOG = {
  barcode: {
    label: 'Quét mã vạch',
    support: 'native',
    posnic: 'items.barcode_id / items.barcodes',
    posnicSetting: null,
    ref: ['api/src/models/item.model.js (barcode_id, barcodes)'],
  },
  quickSale: {
    label: 'Bán nhanh tại quầy',
    support: 'native',
    posnic: 'quick_sale_enable',
    posnicSetting: 'quick_sale_enable',
    ref: ['api/src/services/install.service.js (newShopModuleDefaults)'],
  },
  unitConversion: {
    label: 'Đơn vị quy đổi (thùng/lốc/chai)',
    support: 'partial',
    posnic: 'items.purchase_unit + items.conversion_factor',
    posnicSetting: null,
    ref: ['api/src/models/item.model.js ("Unit conversion (V3) - receiving entry assist; stock stays base units")'],
    note: 'Upstream converts only on receiving; selling the same item per thùng/lốc at its own price needs a HiTechPOS extension.',
  },
  weighing: {
    label: 'Cân điện tử / bán theo cân',
    support: 'native',
    posnic: 'hardware_weight_machine_enable',
    posnicSetting: 'hardware_weight_machine_enable',
    ref: ['api/src/services/settings-groups.js', 'api/src/models/item.model.js (item_weight_machine_based)'],
  },
  variants: {
    label: 'Biến thể (size, màu)',
    support: 'native',
    posnic: 'variants',
    posnicSetting: null,
    ref: ['api/src/routes/variants.routes.js', 'api/src/models/variant.model.js', 'api/src/models/item.model.js (variant_group_id, variant_axis)'],
  },
  modifiers: {
    label: 'Topping / tùy chọn món',
    support: 'native',
    posnic: 'items.modifier_group_ids',
    posnicSetting: null,
    ref: ['api/src/models/item.model.js (modifier_group_ids)', 'api/src/models/setting.model.js'],
  },
  tables: {
    label: 'Sơ đồ bàn / phòng',
    support: 'native',
    posnic: 'tableorder',
    posnicSetting: null,
    ref: ['api/src/constants/settings.constants.js (TABLE_ORDER)', 'api/src/services/captain-tables.js', 'api/src/services/desktop-seating.js'],
  },
  mergeSplitTables: {
    label: 'Gộp / tách / chuyển bàn',
    support: 'native',
    posnic: 'table_seating (combined seating) + captain-transfer',
    posnicSetting: null,
    ref: ['api/src/services/seating-claims.js', 'api/src/services/captain-transfer.js', 'api/src/services/table-move-check.js'],
  },
  kitchen: {
    label: 'In phiếu bếp (KOT)',
    support: 'native',
    posnic: 'kitchen rounds (KOT)',
    posnicSetting: null,
    ref: ['api/src/helpers/kitchen-rounds.js', 'api/src/services/captain-transfer-kitchen.js'],
  },
  kds: {
    label: 'Màn hình bếp (KDS)',
    support: 'native',
    posnic: 'kitchen-board',
    posnicSetting: null,
    ref: ['api/src/kitchen-board/', 'api/src/routes/kitchen-board.routes.js', 'api/src/services/kitchen-board.js'],
  },
  captainApp: {
    label: 'Ứng dụng gọi món Captain',
    support: 'native',
    posnic: 'module_captain_enable',
    posnicSetting: 'module_captain_enable',
    ref: ['api/src/routes/captain-access.routes.js', 'api/src/services/captain-service.js'],
  },
  serviceCharge: {
    label: 'Phí phục vụ / phụ thu',
    support: 'native',
    posnic: 'custom_charges_enable',
    posnicSetting: 'custom_charges_enable',
    ref: ['api/src/services/settings-groups.js', 'api/src/models/setting.model.js'],
  },
  cupLabels: {
    label: 'In tem ly / tem nhãn',
    support: 'extension',
    posnic: null,
    posnicSetting: null,
    ref: [],
    note: 'No label/sticker printer flow upstream (only receipt and kitchen print jobs).',
  },
  hourlyBilling: {
    label: 'Tính tiền theo giờ (block giờ)',
    support: 'partial',
    posnic: "tableorder.time_billing + sale.time_billing (HiTechPOS patch)",
    posnicSetting: null,
    ref: [
      'api/src/utils/time-billing.js',
      'api/src/services/table-time-billing.js (POST /api/sales/tableTime)',
      'frontend/static/script/js/modules/js/kot_v2.js',
    ],
    note: 'Running clock per room/table, block rounding, minimum and time-of-day rates are a local patch on Posnic (docs/UPSTREAM.md), not upstream.',
  },
  services: {
    label: 'Bán dịch vụ (không tồn kho)',
    support: 'native',
    posnic: "items.item_kind='service'",
    posnicSetting: null,
    ref: ['api/src/models/item.model.js (item_kind, service_unit)'],
  },
  appointments: {
    label: 'Lịch hẹn',
    support: 'extension',
    posnic: null,
    posnicSetting: null,
    ref: [],
  },
  commissions: {
    label: 'Hoa hồng nhân viên kỹ thuật',
    support: 'extension',
    posnic: null,
    posnicSetting: null,
    ref: [],
    note: 'Upstream commissionReport (api/src/repositories/sale.repository.js) is venue/aggregator commission, not per-staff; staff_tips_enable is tips only.',
  },
  servicePackages: {
    label: 'Thẻ liệu trình / gói dịch vụ',
    support: 'extension',
    posnic: null,
    posnicSetting: null,
    ref: [],
  },
  debtLedger: {
    label: 'Công nợ khách hàng',
    support: 'native',
    posnic: 'module_credit_enable',
    posnicSetting: 'module_credit_enable',
    ref: ['api/src/routes/credit.routes.js', 'api/src/models/credit-settings.model.js'],
  },
  loyalty: {
    label: 'Tích điểm khách hàng',
    support: 'native',
    posnic: 'loyalty',
    posnicSetting: null,
    ref: ['api/src/routes/loyalty.routes.js', 'api/src/models/loyalty-config.model.js', 'api/src/models/loyalty-ledger.model.js'],
  },
  delivery: {
    label: 'Giao hàng',
    support: 'partial',
    posnic: 'module_delivery_partners_enable',
    posnicSetting: 'module_delivery_partners_enable',
    ref: ['api/src/services/settings-groups.js (delivery partners)', 'api/src/services/kitchen-delivery.js'],
    note: 'Upstream tracks third-party delivery partners; own-fleet delivery and VN carriers (GHN, GHTK, Ahamove) need adapters.',
  },
  onlineOrdering: {
    label: 'Đặt hàng online',
    support: 'native',
    posnic: 'module_online_ordering_enable',
    posnicSetting: 'module_online_ordering_enable',
    ref: ['api/src/routes/online-ordering.routes.js'],
  },
  preorders: {
    label: 'Đặt hàng trước / đặt cọc',
    support: 'extension',
    posnic: null,
    posnicSetting: null,
    ref: [],
    note: 'quotes_enable exists upstream but has no deposit/pickup-date flow.',
  },
  recipes: {
    label: 'Định lượng nguyên liệu / sản xuất',
    support: 'extension',
    posnic: null,
    posnicSetting: null,
    ref: [],
    note: 'Upstream "recipe" fields are AI dish facts (api/src/services/ai-dish-facts.js), not bill-of-materials stock deduction.',
  },
  wastage: {
    label: 'Ghi nhận hao hụt / hư hỏng',
    support: 'native',
    posnic: "inventory counts mode 'damage' | 'loss'",
    posnicSetting: null,
    ref: ['api/src/services/mobile-inventory.js', 'api/src/routes/inventory-counts.routes.js'],
  },
  batchExpiry: {
    label: 'Lô & hạn sử dụng',
    support: 'partial',
    posnic: 'items.items_expiry_date',
    posnicSetting: null,
    ref: ['api/src/models/item.model.js (items_mfg_date, items_expiry_date)', 'api/src/services/item-expiry-reminders.js'],
    note: 'Upstream stores one expiry date per item with reminders; per-lot quantities are missing.',
  },
  fefo: {
    label: 'Xuất kho FEFO (hết hạn trước xuất trước)',
    support: 'extension',
    posnic: null,
    posnicSetting: null,
    ref: [],
  },
  serialImei: {
    label: 'Quản lý IMEI / số serial',
    support: 'extension',
    posnic: null,
    posnicSetting: null,
    ref: [],
  },
  warranty: {
    label: 'Bảo hành',
    support: 'extension',
    posnic: null,
    posnicSetting: null,
    ref: [],
  },
  installments: {
    label: 'Trả góp',
    support: 'extension',
    posnic: null,
    posnicSetting: null,
    ref: [],
  },
  returns: {
    label: 'Đổi / trả hàng',
    support: 'native',
    posnic: 'sales/returnSales',
    posnicSetting: null,
    ref: ['api/src/routes/sales.routes.js (returnSales, productBasedReturnDetails)'],
  },
  prescriptions: {
    label: 'Thuốc kê đơn',
    support: 'extension',
    posnic: null,
    posnicSetting: null,
    ref: [],
  },
  nationalPharmacyLink: {
    label: 'Liên thông Cơ sở dữ liệu Dược quốc gia',
    support: 'extension',
    posnic: null,
    posnicSetting: null,
    ref: [],
  },
  einvoice: {
    label: 'Hóa đơn điện tử',
    support: 'extension',
    posnic: null,
    posnicSetting: null,
    ref: ['api/src/services/einvoice/applicability.js'],
    note: 'Upstream module_einvoice_enable is India GST only (isIndianShop && isGstOn); Vietnamese HĐĐT is a separate HiTechPOS adapter.',
  },
};

const FEATURE_KEYS = Object.freeze(Object.keys(CATALOG));

for (const key of FEATURE_KEYS) {
  const entry = CATALOG[key];
  if (!SUPPORT.includes(entry.support)) throw new Error(`features: bad support for ${key}`);
  entry.hitechExtension = entry.support !== 'native';
  entry.ref = Object.freeze(entry.ref);
  Object.freeze(entry);
}
Object.freeze(CATALOG);

/**
 * Expand a list of enabled keys into the full { key: {enabled, posnic,
 * hitechExtension} } map. Unknown keys throw so typos surface at load time.
 */
function buildFeatures(enabledKeys) {
  const enabled = new Set(enabledKeys);
  for (const key of enabled) {
    if (!CATALOG[key]) throw new Error(`Unknown feature key: ${key}`);
  }
  const out = {};
  for (const key of FEATURE_KEYS) {
    const c = CATALOG[key];
    out[key] = { enabled: enabled.has(key), posnic: c.posnic, hitechExtension: c.hitechExtension };
  }
  return out;
}

module.exports = { FEATURE_KEYS, FEATURE_CATALOG: CATALOG, SUPPORT, buildFeatures };
