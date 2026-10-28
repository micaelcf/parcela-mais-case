-- Kill switches start enabled for the four lenders (RF-219, RF-608).
INSERT INTO "lender_setting" ("lender", "enabled") VALUES
  ('ALFA', true),
  ('BETA', true),
  ('GAMA', true),
  ('DELTA', true)
ON CONFLICT ("lender") DO NOTHING;
