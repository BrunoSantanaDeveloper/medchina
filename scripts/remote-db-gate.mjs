import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import postgres from "postgres";

const root = process.cwd();
const args = new Set(process.argv.slice(2));
const knownArgs = new Set(["--apply", "--test", "--test-only"]);

for (const arg of args) {
  if (!knownArgs.has(arg)) throw new Error(`Unknown argument: ${arg}`);
}

const shouldApply = args.has("--apply");
const shouldTest = args.has("--test") || args.has("--test-only");
const shouldInspectMigrations = !args.has("--test-only");
const envPath = path.resolve(root, process.env.MEDCHINA_ENV_FILE ?? "apps/web/.env");
const migrationsPath = path.resolve(root, "packages/db/migrations");
const testsPath = path.resolve(root, "packages/db/tests");

function parseEnvValue(source, key) {
  const line = source
    .split(/\r?\n/u)
    .find((candidate) => candidate.startsWith(`${key}=`));

  if (!line) return undefined;
  const value = line.slice(key.length + 1).trim();
  if (value.startsWith('"') && value.endsWith('"')) return JSON.parse(value);
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  return value;
}

async function getDatabaseUrl() {
  const envFile = await readFile(envPath, "utf8");
  const value = process.env.DATABASE_URL ?? parseEnvValue(envFile, "DATABASE_URL");
  if (!value) throw new Error(`DATABASE_URL is not set in ${envPath}`);

  const databaseUrl = new URL(value);
  if (!new Set(["postgres:", "postgresql:"]).has(databaseUrl.protocol)) {
    throw new Error("DATABASE_URL must use the postgres or postgresql protocol");
  }

  const localHosts = new Set(["127.0.0.1", "localhost", "::1", "host.docker.internal"]);
  if (localHosts.has(databaseUrl.hostname)) {
    throw new Error("The remote database gate refuses local DATABASE_URL targets");
  }

  return value;
}

async function getMigrationFiles() {
  const entries = await readdir(migrationsPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /^\d{4}_.+\.sql$/u.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

async function readAppliedMigrations(sql) {
  const [state] = await sql`
    select
      to_regclass('public.schema_migrations') is not null as has_history,
      to_regclass('public.organizations') is not null as has_product_schema
  `;

  if (!state.has_history || !state.has_product_schema) {
    throw new Error(
      "The configured database is not an initialized MedChina database (migration history or product schema missing)",
    );
  }

  const rows = await sql`select version from public.schema_migrations order by version`;
  return new Set(rows.map((row) => row.version));
}

async function migrate(databaseUrl) {
  const sql = postgres(databaseUrl, {
    application_name: "medchina-remote-db-gate",
    connect_timeout: 20,
    idle_timeout: 20,
    max: 1,
    prepare: false,
  });

  const files = await getMigrationFiles();

  try {
    if (shouldApply) {
      await sql`select pg_advisory_lock(hashtext('medchina'), hashtext('schema_migrations'))`;
    }

    const applied = await readAppliedMigrations(sql);
    const unknownApplied = [...applied].filter((version) => !files.includes(version));
    if (unknownApplied.length > 0) {
      throw new Error(`Remote migration history contains unknown files: ${unknownApplied.join(", ")}`);
    }

    const pending = files.filter((file) => !applied.has(file));
    console.log(`Remote migrations: ${applied.size} applied, ${pending.length} pending.`);

    if (pending.length === 0) return;

    if (!shouldApply) {
      for (const file of pending) console.log(`  pending ${file}`);
      return;
    }

    for (const file of pending) {
      const migration = await readFile(path.join(migrationsPath, file), "utf8");
      console.log(`Applying ${file}...`);
      await sql.begin(async (transaction) => {
        await transaction.unsafe(migration);
        await transaction`
          insert into public.schema_migrations (version)
          values (${file})
        `;
      });
      console.log(`Applied ${file}.`);
    }
  } finally {
    if (shouldApply) {
      await sql`select pg_advisory_unlock(hashtext('medchina'), hashtext('schema_migrations'))`.catch(
        () => undefined,
      );
    }
    await sql.end({ timeout: 5 });
  }
}

async function testDatabase(databaseUrl) {
  const sql = postgres(databaseUrl, {
    application_name: "medchina-remote-pgtap",
    connect_timeout: 20,
    idle_timeout: 20,
    max: 1,
    prepare: false,
  });
  const entries = await readdir(testsPath, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  let total = 0;

  try {
    await sql.unsafe("set statement_timeout = '120s'");

    for (const file of files) {
      const source = await readFile(path.join(testsPath, file), "utf8");
      let results;

      try {
        results = await sql.unsafe(source);
      } catch (error) {
        await sql.unsafe("rollback").catch(() => undefined);
        throw new Error(`${file} failed: ${error.message}`, { cause: error });
      }

      const rows = results.flatMap((result) => (Array.isArray(result) ? result : [result]));
      const tap = rows.flatMap((row) =>
        row && typeof row === "object"
          ? Object.values(row).filter((value) => typeof value === "string")
          : [],
      );
      const plan = tap.map((line) => /^1\.\.(\d+)$/u.exec(line)).find(Boolean);
      const assertions = tap.filter((line) => /^(?:not )?ok\s+\d+/u.test(line));
      const failures = assertions.filter((line) => line.startsWith("not ok"));

      if (!plan) throw new Error(`${file} did not emit a pgTAP plan`);
      const planned = Number(plan[1]);
      if (assertions.length !== planned || failures.length > 0) {
        for (const failure of failures) console.error(`  ${failure}`);
        throw new Error(
          `${file} emitted ${assertions.length}/${planned} assertions with ${failures.length} failure(s)`,
        );
      }

      total += assertions.length;
      console.log(`pgTAP ${file}: ${assertions.length}/${planned} passed.`);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }

  console.log(`Remote pgTAP: ${total} assertions passed.`);
}

const databaseUrl = await getDatabaseUrl();

if (shouldInspectMigrations) await migrate(databaseUrl);

if (shouldTest) {
  if (shouldInspectMigrations && !shouldApply) {
    throw new Error("Use --apply --test to migrate and test, or --test-only to test the current schema");
  }
  await testDatabase(databaseUrl);
}
