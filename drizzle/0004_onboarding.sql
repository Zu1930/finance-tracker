CREATE TABLE "onboarding_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "onboarding_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" text NOT NULL,
	"step" text NOT NULL,
	"action" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_onboarding" (
	"user_id" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"completed_at" timestamp with time zone,
	"checklist_dismissed_at" timestamp with time zone,
	"checklist_hidden_items" text[] DEFAULT '{}'::text[] NOT NULL,
	"hints_seen" text[] DEFAULT '{}'::text[] NOT NULL,
	"pwa_seen_at" timestamp with time zone,
	"version" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "onboarding_events" ADD CONSTRAINT "onboarding_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_onboarding" ADD CONSTRAINT "user_onboarding_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "onboarding_events_user" ON "onboarding_events" USING btree ("user_id");--> statement-breakpoint
-- Кто уже пользуется приложением, опрос и карточку не видит; подсказки (hints_seen пустой) — по одному разу
INSERT INTO "user_onboarding" ("user_id", "status", "completed_at", "checklist_dismissed_at") SELECT "id", 'done', now(), now() FROM "users" ON CONFLICT DO NOTHING;
