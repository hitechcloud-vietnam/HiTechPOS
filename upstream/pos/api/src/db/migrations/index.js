// src/db/migrations/index.js
//
// The migration registry, in the order they run. See ../migrations.js for the
// contract (forward-only, idempotent up(db), ledger in schema_migrations).
//
// Naming: NNN-kebab-summary, zero-padded so lexical order = run order.
// Add new entries at the END; never edit or remove a shipped one - a database
// that already applied it will simply skip it, and one that has not will run
// exactly what every other database ran.
//
// When you add a migration, bump API_SCHEMA_VERSION in
// constants/runtime.constants.js in the same commit.

module.exports = [
  {
    id: '001-business-cloud-daily-indexes',
    description: 'Bound Business daily sales and historical-sale refund reads by branch and date',
    up: require('../../services/business-cloud-reports').ensureCloudReportingIndexes,
  },
  {
    id: '002-repair-demo-document-lines',
    description: 'Repair untouched demo document line fields and restaurant supply purchases',
    up: require('../../services/demo-repair').repairDemoRecords,
  },
  {
    // HiTechPOS: see helpers/print-templates.js. Only branches in Vietnam
    // still on the untouched stock thermal template; a customised one is kept.
    id: '003-vietnamese-default-bill',
    description: 'Vietnamese shops still on the stock thermal receipt get the Vietnamese bill',
    up: (db) => require('../../helpers/print-templates').upgradeVietnameseThermalTemplates(db),
  },
];
