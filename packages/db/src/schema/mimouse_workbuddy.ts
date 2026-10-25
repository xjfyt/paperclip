import { sql } from "drizzle-orm";
import { pgTable, uuid, text, integer, timestamp, jsonb, unique, foreignKey, check } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { companySecrets } from "./company_secrets.js";
export const mimouseWorkbuddyConnections = pgTable("mimouse_workbuddy_connections", {
  id: uuid("id").primaryKey().defaultRandom(), companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  ownerUserId: text("owner_user_id").notNull(), status: text("status").notNull().default("disconnected"),
  tokenSecretRef: uuid("token_secret_ref").references(() => companySecrets.id), tokenVersion: integer("token_version").notNull().default(0),
  tokenMaterial: jsonb("token_material").$type<Record<string, unknown>>(), credentialIdentity: text("credential_identity"),
  expiresAt: timestamp("expires_at", { withTimezone: true }), scopes: jsonb("scopes").$type<string[]>().notNull().default([]),
  allowedAgentIds: jsonb("allowed_agent_ids").$type<string[]>().notNull().default([]),
  oauthStateHash: text("oauth_state_hash"), oauthSessionId: text("oauth_session_id"), oauthExpiresAt: timestamp("oauth_expires_at", { withTimezone: true }), oauthRedirectUri: text("oauth_redirect_uri"),
  refreshLease: uuid("refresh_lease"), lastCode: text("last_code"), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => ({ identity: unique("mimouse_wb_connection_company_identity").on(t.companyId, t.id), owner: unique("mimouse_wb_connection_owner").on(t.companyId, t.ownerUserId), oauth: unique("mimouse_wb_oauth_state_unique").on(t.oauthStateHash) }));
export const mimouseWorkbuddyJobs = pgTable("mimouse_workbuddy_jobs", {
  id: uuid("id").primaryKey().defaultRandom(), companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  connectionId: uuid("connection_id").notNull(), requestKey: text("request_key").notNull(), promptHash: text("prompt_hash").notNull(),
  credentialIdentity: text("credential_identity"),
  runId: uuid("run_id"), providerJobId: text("provider_job_id"), dispatchState: text("dispatch_state").notNull().default("dispatching"),
  remoteState: text("remote_state").notNull().default("unknown"), cancelState: text("cancel_state").notNull().default("not_requested"),
  report: text("report").notNull().default(""), artifactRefs: jsonb("artifact_refs").$type<string[]>().notNull().default([]),
  activeTurn: uuid("active_turn"), lastCode: text("last_code"), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => ({ connection: foreignKey({ columns: [t.companyId, t.connectionId], foreignColumns: [mimouseWorkbuddyConnections.companyId, mimouseWorkbuddyConnections.id] }), identity: unique("mimouse_wb_job_company_identity").on(t.companyId, t.id), request: unique("mimouse_wb_job_request_unique").on(t.companyId, t.connectionId, t.requestKey) }));
export const mimouseWorkbuddyTurns = pgTable("mimouse_workbuddy_turns", {
  id: uuid("id").primaryKey().defaultRandom(), companyId: uuid("company_id").notNull(), jobId: uuid("job_id").notNull(), requestKey: text("request_key").notNull(), promptHash: text("prompt_hash").notNull(),
  state: text("state").notNull().default("prepared"), stopReason: text("stop_reason"), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => ({ job: foreignKey({ columns: [t.companyId, t.jobId], foreignColumns: [mimouseWorkbuddyJobs.companyId, mimouseWorkbuddyJobs.id] }), request: unique("mimouse_wb_turn_request_unique").on(t.companyId, t.jobId, t.requestKey), stateCheck: check("mimouse_wb_turn_state", sql`${t.state} IN ('prepared','dispatched','round_finished','indeterminate')`) }));
