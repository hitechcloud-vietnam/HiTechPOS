'use strict';

const { S1_HKD, NOTICE } = require('./tax-ledger-config');
const { dayLabel, formatAmount } = require('./tax-ledger');

/*
 * Exports of a ledger built by tax-ledger.js buildLedger():
 *   toCsv  - UTF-8 with BOM, CRLF line ends, ',' or ';' separated, for Excel;
 *   toHtml - a standalone A4 page (print CSS) the owner can open and print.
 * Both carry the "Số liệu tham khảo – cần kế toán xác nhận" notice.
 */

const BOM = '﻿';
const STATUS_LABEL = { exceeded: 'Đã vượt ngưỡng', not_exceeded_yet: 'Chưa vượt ngưỡng (năm chưa kết thúc)', not_exceeded: 'Không vượt ngưỡng' };

/* Rate in basis points as a Vietnamese percentage: 50 -> "0,5%". */
function pct(bp) {
  const s = (bp / 100).toFixed(2).replace(/\.?0+$/, '');
  return `${s.replace('.', ',')}%`;
}

/*
 * One CSV cell. Numbers are written bare (no grouping, so Excel reads them
 * as numbers in any locale). Text is quoted when it holds the separator, a
 * quote, a line break or edge spaces; a text cell starting with = + - @ or a
 * tab/CR is prefixed with ' so Excel never evaluates it as a formula.
 */
function csvCell(v, sep) {
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  let s = v === undefined || v === null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (s.includes(sep) || /["\r\n]/.test(s) || /^\s|\s$/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(ledger, { separator = ',' } = {}) {
  const sep = separator === ';' ? ';' : ',';
  const out = [];
  const line = (...cells) => out.push(cells.map((c) => csvCell(c, sep)).join(sep));
  const groups = ledger.groups;
  line(S1_HKD.formNo, S1_HKD.formRef);
  line(S1_HKD.title);
  line('Hộ, cá nhân kinh doanh', ledger.shop.name);
  line('Mã số thuế', ledger.shop.taxCode);
  line('Địa chỉ', ledger.shop.address);
  line('Kỳ', `${ledger.period.label} (${dayLabel(ledger.period.fromDay)} – ${dayLabel(ledger.period.toDay)})`);
  line('Lưu ý', NOTICE);
  line('Bảng thuế suất', ledger.summary.tableVersion);
  out.push('');
  const c = S1_HKD.columns;
  line('Ngày, tháng ghi sổ', 'Số hiệu chứng từ', 'Ngày, tháng chứng từ', 'Diễn giải',
    ...groups.map((g) => `(${g.column}) ${g.label}`), 'Tổng doanh thu', 'Ghi chú');
  line(c.postedOn, c.docNo, c.docDate, c.description, ...groups.map((g) => String(g.column)), '', c.note);
  for (const r of ledger.book.rows) {
    line(dayLabel(r.postedOn), r.docNo, dayLabel(r.docDate), r.description, ...groups.map((g) => r.amounts[g.id] || 0), r.total, r.note || '');
  }
  line('', '', '', 'Tổng cộng', ...groups.map((g) => ledger.book.totals.amounts[g.id] || 0), ledger.book.totals.total, '');
  out.push('');
  const s = ledger.summary;
  line('TỔNG HỢP KỲ ĐỂ TỰ KHAI', NOTICE);
  line('Nhóm ngành nghề', 'Doanh thu', 'Tỷ lệ GTGT', 'Thuế GTGT', 'Tỷ lệ TNCN', 'Thuế TNCN');
  for (const g of s.groups) line(`(${g.column}) ${g.label}`, g.revenue, pct(g.gtgtRateBp), g.gtgt, pct(g.tncnRateBp), g.tncn);
  line('Tổng cộng', s.totals.revenue, '', s.totals.gtgt, '', s.totals.tncn);
  if (s.gtgtReductionPercent) line('Đã giảm tỷ lệ GTGT', `${s.gtgtReductionPercent}%`);
  line('Ngưỡng doanh thu không chịu thuế (năm)', s.threshold.annual);
  line(`Doanh thu năm ${s.threshold.year} đã ghi nhận`, s.threshold.yearRevenue);
  line('Tình trạng', STATUS_LABEL[s.threshold.status] || s.threshold.status);
  line('Thuế phải nộp tạm tính của kỳ', s.payable.total, 'GTGT', s.payable.gtgt, 'TNCN', s.payable.tncn);
  line('Ghi chú', s.threshold.text);
  for (const w of s.warnings) line('Cảnh báo', w);
  return BOM + out.join('\r\n') + '\r\n';
}

const esc = (v) => String(v === undefined || v === null ? '' : v).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const money = (n) => (n ? formatAmount(n) : '');

/* Standalone printable page. Inline CSS on purpose: the file is downloaded
   and opened from disk, where it must render without the server. */
function toHtml(ledger) {
  const groups = ledger.groups;
  const s = ledger.summary;
  const c = S1_HKD.columns;
  const rows = ledger.book.rows.map((r) => `<tr class="${r.kind === 'return' ? 'ret' : ''}"><td>${esc(dayLabel(r.postedOn))}</td><td>${esc(r.docNo)}</td><td>${esc(dayLabel(r.docDate))}</td><td class="desc">${esc(r.description)}</td>${groups.map((g) => `<td class="n">${money(r.amounts[g.id])}</td>`).join('')}<td class="n">${money(r.total)}</td><td>${esc(r.note || '')}</td></tr>`).join('\n');
  const sumRows = s.groups.map((g) => `<tr><td>(${g.column}) ${esc(g.label)}</td><td class="n">${formatAmount(g.revenue)}</td><td class="n">${pct(g.gtgtRateBp)}</td><td class="n">${formatAmount(g.gtgt)}</td><td class="n">${pct(g.tncnRateBp)}</td><td class="n">${formatAmount(g.tncn)}</td></tr>`).join('\n');
  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sổ doanh thu ${esc(ledger.period.label)} – ${esc(ledger.shop.name)}</title>
<style>
  @page { size: A4 landscape; margin: 12mm; }
  * { box-sizing: border-box; }
  body { margin: 0 auto; max-width: 277mm; padding: 8mm 0; font: 11pt/1.4 "Times New Roman", Times, serif; color: #000; background: #fff; }
  .top { display: flex; justify-content: space-between; gap: 16px; }
  .form { text-align: center; font-size: 10pt; }
  h1 { text-align: center; font-size: 14pt; margin: 10px 0 2px; }
  .sub { text-align: center; margin: 0 0 8px; }
  .notice { border: 2px solid #a76300; background: #fff4e0; color: #5a3600; padding: 6px 10px; margin: 8px 0; font-weight: bold; text-align: center; }
  table { width: 100%; border-collapse: collapse; font-size: 9.5pt; page-break-inside: auto; }
  tr { page-break-inside: avoid; }
  thead { display: table-header-group; }
  th, td { border: 1px solid #000; padding: 3px 4px; vertical-align: top; }
  th { text-align: center; font-weight: bold; }
  td.n { text-align: right; white-space: nowrap; }
  td.desc { min-width: 60mm; }
  tr.ret td { font-style: italic; }
  tr.total td { font-weight: bold; }
  h2 { font-size: 12pt; margin: 14px 0 6px; }
  .muted { font-size: 9.5pt; }
  .sign { display: flex; justify-content: space-around; margin-top: 18px; text-align: center; page-break-inside: avoid; }
  .sign div { min-width: 70mm; }
  .sign i { display: block; font-size: 9.5pt; margin-bottom: 60px; }
  @media screen { body { padding: 16px; } }
</style>
</head>
<body>
<div class="top">
  <div>
    <div><b>HỘ, CÁ NHÂN KINH DOANH:</b> ${esc(ledger.shop.name)}</div>
    <div><b>Địa chỉ:</b> ${esc(ledger.shop.address)}</div>
    <div><b>Mã số thuế:</b> ${esc(ledger.shop.taxCode)}</div>
  </div>
  <div class="form"><b>${esc(S1_HKD.formNo)}</b><br>${esc(S1_HKD.formRef)}</div>
</div>
<h1>${esc(S1_HKD.title)}</h1>
<p class="sub">Kỳ: ${esc(ledger.period.label)} (từ ${esc(dayLabel(ledger.period.fromDay))} đến ${esc(dayLabel(ledger.period.toDay))}) · Đơn vị tính: đồng</p>
<div class="notice">${esc(NOTICE)}</div>
<table>
<thead>
<tr><th rowspan="2">Ngày, tháng ghi sổ</th><th colspan="2">Chứng từ</th><th rowspan="2">Diễn giải</th><th colspan="${groups.length}">Doanh thu bán hàng hoá, dịch vụ chia theo danh mục ngành nghề</th><th rowspan="2">Tổng cộng</th><th rowspan="2">Ghi chú</th></tr>
<tr><th>Số hiệu</th><th>Ngày, tháng</th>${groups.map((g) => `<th>${esc(g.label)}</th>`).join('')}</tr>
<tr><th>${c.postedOn}</th><th>${c.docNo}</th><th>${c.docDate}</th><th>${c.description}</th>${groups.map((g) => `<th>${g.column}</th>`).join('')}<th></th><th>${c.note}</th></tr>
</thead>
<tbody>
${rows || `<tr><td colspan="${groups.length + 6}">Không có doanh thu trong kỳ.</td></tr>`}
<tr class="total"><td></td><td></td><td></td><td>Tổng cộng</td>${groups.map((g) => `<td class="n">${formatAmount(ledger.book.totals.amounts[g.id] || 0)}</td>`).join('')}<td class="n">${formatAmount(ledger.book.totals.total)}</td><td></td></tr>
</tbody>
</table>

<h2>Tổng hợp kỳ để tự khai thuế</h2>
<div class="notice">${esc(NOTICE)}</div>
<table>
<thead><tr><th>Nhóm ngành nghề</th><th>Doanh thu</th><th>Tỷ lệ GTGT</th><th>Thuế GTGT</th><th>Tỷ lệ TNCN</th><th>Thuế TNCN</th></tr></thead>
<tbody>
${sumRows}
<tr class="total"><td>Tổng cộng</td><td class="n">${formatAmount(s.totals.revenue)}</td><td></td><td class="n">${formatAmount(s.totals.gtgt)}</td><td></td><td class="n">${formatAmount(s.totals.tncn)}</td></tr>
</tbody>
</table>
<p>Ngưỡng doanh thu không chịu thuế: <b>${formatAmount(s.threshold.annual)} đ/năm</b> · Doanh thu năm ${s.threshold.year} đã ghi nhận: <b>${formatAmount(s.threshold.yearRevenue)} đ</b> · ${esc(STATUS_LABEL[s.threshold.status] || s.threshold.status)}</p>
<p>${esc(s.threshold.text)}</p>
<p><b>Thuế phải nộp tạm tính của kỳ:</b> ${formatAmount(s.payable.total)} đ (GTGT ${formatAmount(s.payable.gtgt)} đ, TNCN ${formatAmount(s.payable.tncn)} đ)${s.gtgtReductionPercent ? ` · đã giảm ${s.gtgtReductionPercent}% tỷ lệ GTGT` : ''}</p>
${s.warnings.map((w) => `<p class="muted">⚠ ${esc(w)}</p>`).join('\n')}
<p class="muted">Bảng thuế suất: ${esc(s.tableVersion)} · Làm tròn: thuế tính theo từng nhóm ngành, làm tròn đến đồng. Lập lúc ${esc(new Date(ledger.generatedAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }))} bởi HiTechPOS.</p>
<p class="muted">Ngày ..... tháng ..... năm .........</p>
<div class="sign">${S1_HKD.signatures.map((t) => `<div><b>${esc(t)}</b><i>(Ký, họ tên${/ĐẠI DIỆN/.test(t) ? ', đóng dấu nếu có' : ''})</i></div>`).join('')}</div>
</body>
</html>
`;
}

module.exports = { toCsv, toHtml, csvCell, pct };
