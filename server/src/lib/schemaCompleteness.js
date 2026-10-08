// What the database lacks compared with the schema manifest (models/schema.model.js), read from
// information_schema. Shared by the Status page (health.model.js schemaCheck) and an app node
// that waits for the worker to patch the schema before it serves (app-start.js).
export async function missingFromManifest(manifest, mysql) {
  if (!manifest?.base?.tables?.length) {
    throw new Error("The schema manifest is empty or unreadable, so completeness cannot be judged");
  }
  const wanted = { tables: new Set(manifest.base.tables), columns: new Set(), indexes: new Set() };
  // which patch is responsible for each item, so a report can name the migration to look at
  const owner = new Map();
  for (const [patch, spec] of Object.entries(manifest.patches || {})) {
    for (const t of spec.tables || []) { wanted.tables.add(t); if (!owner.has(t)) owner.set(t, patch); }
    for (const c of spec.columns || []) { wanted.columns.add(c); owner.set(c, patch); }
    for (const i of spec.indexes || []) { wanted.indexes.add(i); owner.set(i, patch); }
  }

  const [tableRows, columnRows, indexRows] = await Promise.all([
    mysql.do("SELECT table_name AS t FROM information_schema.tables WHERE table_schema='AnsibleForms'"),
    mysql.do("SELECT table_name AS t, column_name AS c FROM information_schema.columns WHERE table_schema='AnsibleForms'"),
    mysql.do("SELECT DISTINCT table_name AS t, index_name AS i FROM information_schema.statistics WHERE table_schema='AnsibleForms'"),
  ]);
  const haveTables = new Set(tableRows.map(r => r.t));
  const haveColumns = new Set(columnRows.map(r => `${r.t}.${r.c}`));
  const haveIndexes = new Set(indexRows.map(r => `${r.t}.${r.i}`));

  const missingTables = [...wanted.tables].filter(t => !haveTables.has(t)).sort();
  // a column on a table that is itself missing would be noise - the table is the finding
  const missingColumns = [...wanted.columns]
    .filter(c => !haveColumns.has(c) && haveTables.has(c.split('.')[0]))
    .sort();
  const missingIndexes = [...wanted.indexes].filter(i => !haveIndexes.has(i) && haveTables.has(i.split('.')[0])).sort();
  return { missingTables, missingColumns, missingIndexes, haveTables, owner };
}
