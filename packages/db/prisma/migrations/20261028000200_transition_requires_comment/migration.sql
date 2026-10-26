-- A decision can demand a comment (a rejection, a return to correct): whoever takes it must say why.
ALTER TABLE "transitions" ADD COLUMN "requires_comment" BOOLEAN NOT NULL DEFAULT false;
