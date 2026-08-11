import { Client } from "pg";

async function main(): Promise<void> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const tables = await client.query(`
    select count(*) from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
  `);
  console.log("Tablas en public:", tables.rows[0].count);

  const rls = await client.query(`
    select relname, relrowsecurity from pg_class
    where relnamespace = 'public'::regnamespace and relkind = 'r'
    order by relname
  `);
  const withoutRls = rls.rows.filter((r) => !r.relrowsecurity);
  console.log(
    "Tablas SIN RLS activo:",
    withoutRls.length === 0 ? "ninguna ✓" : withoutRls.map((r) => r.relname),
  );

  const partitions = await client.query(`
    select parent.relname as parent, count(*) as n
    from pg_inherits
    join pg_class parent on pg_inherits.inhparent = parent.oid
    where parent.relname in ('events', 'driver_locations')
    group by parent.relname
  `);
  console.log("Particiones:", partitions.rows);

  const postgis = await client.query(`select postgis_version()`);
  console.log("PostGIS:", postgis.rows[0].postgis_version);

  const grants = await client.query(`
    select grantee, privilege_type from information_schema.role_table_grants
    where table_name = 'events' and privilege_type in ('UPDATE', 'DELETE')
  `);
  console.log(
    "Roles con UPDATE/DELETE sobre events (debería estar vacío o solo postgres):",
    grants.rows,
  );

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
