CREATE TABLE "mimouse_auth_revocations" (
	"request_id" uuid PRIMARY KEY NOT NULL,
	"target_user_id" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"reason" text NOT NULL,
	"cutoff_at" timestamp with time zone NOT NULL,
	"sessions_revoked" integer NOT NULL,
	"board_keys_revoked" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mimouse_auth_revocation_shape" CHECK ("mimouse_auth_revocations"."reason" IN ('offboarding','compromised','administrative') AND "mimouse_auth_revocations"."sessions_revoked" >= 0 AND "mimouse_auth_revocations"."board_keys_revoked" >= 0)
);
--> statement-breakpoint
CREATE INDEX "mimouse_auth_revocation_target" ON "mimouse_auth_revocations" USING btree ("target_user_id","created_at");