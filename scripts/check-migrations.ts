/*
 * Migration review gate (audit C1).
 *
 * Fails when a migration contains a destructive statement (DROP TABLE,
 * DROP COLUMN, DROP TYPE, TRUNCATE, DELETE FROM) unless the migration
 * explicitly acknowledges it with a line
 *
 *   -- destructive-approved: <why this data loss is intended>
 *
 * The marker forces an author (and reviewer) to state intent instead of
 * shipping whatever `prisma migrate dev` happened to emit — which is how
 * `stock_flow` came to drop the Offer table.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const MIGRATIONS_DIR = path.join(
  __dirname,
  "..",
  "prisma",
  "migrations"
);

const DESTRUCTIVE =
  /\b(DROP\s+TABLE|DROP\s+COLUMN|DROP\s+TYPE|TRUNCATE|DELETE\s+FROM)\b/i;

const APPROVAL = /^--\s*destructive-approved:\s*\S+/im;

// Reviewed before this gate existed. Editing them to add the marker
// would change their checksums on every environment that applied them.
const GRANDFATHERED = new Set([
  "20260915062208_redesign_offer", // intentional Offer redesign
]);

const stripComments = (sql: string) =>
  sql
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--.*$/gm, "");

export const findUnapprovedDestructiveMigrations = (
  dir = MIGRATIONS_DIR
) =>
  readdirSync(dir)
    .filter((name) => statSync(path.join(dir, name)).isDirectory())
    .sort()
    .flatMap((name) => {
      const sql = readFileSync(
        path.join(dir, name, "migration.sql"),
        "utf8"
      );

      const statements = stripComments(sql)
        .split("\n")
        .filter((line) => DESTRUCTIVE.test(line))
        .map((line) => line.trim());

      if (
        statements.length === 0 ||
        GRANDFATHERED.has(name) ||
        APPROVAL.test(sql)
      ) {
        return [];
      }

      return [{ name, statements }];
    });

if (require.main === module) {
  const offenders = findUnapprovedDestructiveMigrations();

  if (offenders.length > 0) {
    for (const { name, statements } of offenders) {
      console.error(`✖ ${name}`);
      for (const statement of statements) {
        console.error(`    ${statement}`);
      }
    }

    console.error(
      "\nDestructive migration statements need an explicit '-- destructive-approved: <reason>' line."
    );
    process.exit(1);
  }

  console.log("Migrations OK: no unapproved destructive statements.");
}
