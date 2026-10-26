-- Restores the old catering data (from the MySQL dump) into Supabase.
-- Safe to run more than once: rows are matched by name, no IDs are set.

INSERT INTO "CateringAssets" ("name","quantity","unit")
SELECT v.n, v.q, v.u FROM (VALUES
  ('Table',50,'pcs'),('Chair',100,'pcs'),('Table Cloth',150,'pcs'),
  ('Uniformed Waiter',70,'pcs'),('Grass Carpet',100,'pcs'),
  ('Team Backdrop',50,'pcs'),('Utensil',25,'pcs')
) AS v(n,q,u)
WHERE NOT EXISTS (SELECT 1 FROM "CateringAssets" a WHERE a."name" = v.n);

INSERT INTO "Packages" ("name","price","min_guests")
SELECT v.n, v.p, v.g FROM (VALUES
  ('Package A',30000.00,50),('Package B',35000.00,100),('Package C',50000.00,120)
) AS v(n,p,g)
WHERE NOT EXISTS (SELECT 1 FROM "Packages" x WHERE x."name" = v.n);

INSERT INTO "Dishes" ("name","category")
SELECT v.n, v.c FROM (VALUES
  ('Lechon','Main Course'),('Pesto pasta','Pasta'),('Menudo','Main Course')
) AS v(n,c)
WHERE NOT EXISTS (SELECT 1 FROM "Dishes" d WHERE d."name" = v.n);

INSERT INTO "PackageAssets" ("package_id","asset_id","qty_required")
SELECT p."id", a."id", v.q FROM (VALUES
  ('Package A','Table',5),('Package A','Chair',5),('Package A','Table Cloth',5),
  ('Package A','Team Backdrop',1),('Package A','Uniformed Waiter',1),('Package A','Grass Carpet',1),
  ('Package B','Grass Carpet',1),('Package B','Table',1),('Package B','Team Backdrop',1),
  ('Package C','Chair',1),('Package C','Table',1)
) AS v(pk,an,q)
JOIN "Packages" p ON p."name" = v.pk
JOIN "CateringAssets" a ON a."name" = v.an
WHERE NOT EXISTS (
  SELECT 1 FROM "PackageAssets" x WHERE x."package_id" = p."id" AND x."asset_id" = a."id"
);

INSERT INTO "PackageDishes" ("package_id","dish_id")
SELECT p."id", d."id" FROM (VALUES
  ('Package A','Lechon'),('Package A','Pesto pasta'),
  ('Package B','Lechon'),('Package B','Pesto pasta'),
  ('Package C','Lechon'),('Package C','Pesto pasta')
) AS v(pk,dn)
JOIN "Packages" p ON p."name" = v.pk
JOIN "Dishes" d ON d."name" = v.dn
WHERE NOT EXISTS (
  SELECT 1 FROM "PackageDishes" x WHERE x."package_id" = p."id" AND x."dish_id" = d."id"
);

INSERT INTO "PackageFreebies" ("package_id","name")
SELECT p."id", v.f FROM (VALUES
  ('Package A','1 Free Layer Cake'),
  ('Package B','1 Free Layer Cake'),
  ('Package B','1 Free Graizing table')
) AS v(pk,f)
JOIN "Packages" p ON p."name" = v.pk
WHERE NOT EXISTS (
  SELECT 1 FROM "PackageFreebies" x WHERE x."package_id" = p."id" AND x."name" = v.f
);
