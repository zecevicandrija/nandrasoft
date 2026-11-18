-- Add sort and filter indexes for TollEntry and TollTopUp list/isolation queries.
CREATE INDEX "toll_entry_date_createdAt_idx" ON "toll_entry"("date" DESC, "createdAt" DESC);
CREATE INDEX "toll_entry_createdById_idx" ON "toll_entry"("createdById");
CREATE INDEX "toll_entry_paymentMethod_idx" ON "toll_entry"("paymentMethod");
CREATE INDEX "toll_top_up_date_createdAt_idx" ON "toll_top_up"("date" DESC, "createdAt" DESC);
