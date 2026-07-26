-- Add the column nullable first so existing questions inherit their quiz default.
ALTER TABLE "Question" ADD COLUMN "timeLimitSeconds" INTEGER;

UPDATE "Question"
SET "timeLimitSeconds" = "Quiz"."defaultTimeLimitSeconds"
FROM "Quiz"
WHERE "Question"."quizId" = "Quiz"."id";

ALTER TABLE "Question" ALTER COLUMN "timeLimitSeconds" SET NOT NULL;
ALTER TABLE "Question" ALTER COLUMN "timeLimitSeconds" SET DEFAULT 30;
