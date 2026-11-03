-- Keep catalogue identities and history; existing chambers remain active.
ALTER TABLE "onion_chambers" ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "toll_entry" DROP CONSTRAINT "toll_entry_machineId_fkey";
ALTER TABLE "toll_entry" ADD CONSTRAINT "toll_entry_machineId_fkey"
  FOREIGN KEY ("machineId") REFERENCES "machine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "toll_top_up" DROP CONSTRAINT "toll_top_up_machineId_fkey";
ALTER TABLE "toll_top_up" ADD CONSTRAINT "toll_top_up_machineId_fkey"
  FOREIGN KEY ("machineId") REFERENCES "machine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
