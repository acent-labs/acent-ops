CREATE INDEX IF NOT EXISTS "heartbeat_runs_status_created_idx"
ON "heartbeat_runs" USING btree ("status", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "heartbeat_runs_agent_status_created_idx"
ON "heartbeat_runs" USING btree ("agent_id", "status", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "heartbeat_runs_company_status_issue_created_idx"
ON "heartbeat_runs" USING btree ("company_id", "status", (("context_snapshot" ->> 'issueId')), "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_wakeup_requests_company_status_issue_requested_idx"
ON "agent_wakeup_requests" USING btree ("company_id", "status", (("payload" ->> 'issueId')), "requested_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_wakeup_requests_company_status_run_requested_idx"
ON "agent_wakeup_requests" USING btree ("company_id", "status", "run_id", "requested_at");
