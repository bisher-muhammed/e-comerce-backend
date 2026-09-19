-- M13: one account per mailbox, whatever the letter case.
--
-- 1. Addresses that collide once lower-cased keep their data: the earliest
--    account in each group gets the normalised address, every later one is
--    moved to "<local>+dup<id>@<domain>" (unique, still deliverable on most
--    providers) so nothing is lost and an admin can merge them. They are
--    listed as NOTICEs in the migration output.
-- 2. Every other address is normalised (trimmed, lower-cased).
-- 3. A CHECK constraint keeps it that way, which together with the
--    existing unique index makes email uniqueness case-insensitive.

DO $$
DECLARE
  dup RECORD;
BEGIN
  FOR dup IN
    SELECT u."id", u."email",
           lower(btrim(u."email")) AS normalised,
           row_number() OVER (
             PARTITION BY lower(btrim(u."email"))
             ORDER BY u."createdAt", u."id"
           ) AS rank
      FROM "User" u
  LOOP
    IF dup.rank > 1 THEN
      UPDATE "User"
         SET "email" = split_part(dup.normalised, '@', 1)
                       || '+dup' || dup."id" || '@'
                       || split_part(dup.normalised, '@', 2)
       WHERE "id" = dup."id";

      RAISE NOTICE 'M13: user % (%) duplicates another account; moved to +dup%',
        dup."id", dup."email", dup."id";
    END IF;
  END LOOP;
END
$$;

UPDATE "User"
   SET "email" = lower(btrim("email"))
 WHERE "email" <> lower(btrim("email"));

ALTER TABLE "User"
  ADD CONSTRAINT "User_email_normalized_check"
  CHECK ("email" = lower(btrim("email")));
