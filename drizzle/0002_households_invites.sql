CREATE TABLE "claims" (
	"household_id" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"claimed_by" text,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"copy_id" text,
	"copy_version" integer,
	CONSTRAINT "claims_household_id_entity_entity_id_pk" PRIMARY KEY("household_id","entity","entity_id")
);
--> statement-breakpoint
CREATE TABLE "household_invites" (
	"id" text PRIMARY KEY NOT NULL,
	"household_id" text NOT NULL,
	"code_hash" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_by" text,
	"used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "household_invites_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
CREATE TABLE "signup_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"code_hash" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"uses_total" integer NOT NULL,
	"uses_left" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "signup_codes_code_hash_unique" UNIQUE("code_hash"),
	CONSTRAINT "signup_codes_uses" CHECK ("signup_codes"."uses_left" >= 0 AND "signup_codes"."uses_left" <= "signup_codes"."uses_total")
);
--> statement-breakpoint
ALTER TABLE "accounts" DROP CONSTRAINT "accounts_household_id_households_id_fk";
--> statement-breakpoint
ALTER TABLE "categories" DROP CONSTRAINT "categories_household_id_households_id_fk";
--> statement-breakpoint
ALTER TABLE "deleted_entries" DROP CONSTRAINT "deleted_entries_household_id_households_id_fk";
--> statement-breakpoint
ALTER TABLE "expenses" DROP CONSTRAINT "expenses_household_id_households_id_fk";
--> statement-breakpoint
ALTER TABLE "expenses" DROP CONSTRAINT "expenses_recurring";
--> statement-breakpoint
ALTER TABLE "goal_ops" DROP CONSTRAINT "goal_ops_goal";
--> statement-breakpoint
ALTER TABLE "goals" DROP CONSTRAINT "goals_household_id_households_id_fk";
--> statement-breakpoint
ALTER TABLE "income_sources" DROP CONSTRAINT "income_sources_household_id_households_id_fk";
--> statement-breakpoint
ALTER TABLE "incomes" DROP CONSTRAINT "incomes_household_id_households_id_fk";
--> statement-breakpoint
ALTER TABLE "memberships" DROP CONSTRAINT "memberships_household_id_households_id_fk";
--> statement-breakpoint
ALTER TABLE "month_plans" DROP CONSTRAINT "month_plans_household_id_households_id_fk";
--> statement-breakpoint
ALTER TABLE "plan_items" DROP CONSTRAINT "plan_items_household_id_households_id_fk";
--> statement-breakpoint
ALTER TABLE "recons" DROP CONSTRAINT "recons_household_id_households_id_fk";
--> statement-breakpoint
ALTER TABLE "recurring_amounts" DROP CONSTRAINT "recurring_amounts_payment";
--> statement-breakpoint
ALTER TABLE "recurring_payments" DROP CONSTRAINT "recurring_payments_household_id_households_id_fk";
--> statement-breakpoint
ALTER TABLE "households" ADD COLUMN "kind" text DEFAULT 'family' NOT NULL;--> statement-breakpoint
ALTER TABLE "households" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "households" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "households" ADD COLUMN "purge_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "left_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "readonly_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "restore_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_claimed_by_users_id_fk" FOREIGN KEY ("claimed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_invites" ADD CONSTRAINT "household_invites_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_invites" ADD CONSTRAINT "household_invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_invites" ADD CONSTRAINT "household_invites_used_by_users_id_fk" FOREIGN KEY ("used_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signup_codes" ADD CONSTRAINT "signup_codes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "household_invites_household" ON "household_invites" USING btree ("household_id");--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deleted_entries" ADD CONSTRAINT "deleted_entries_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_recurring" FOREIGN KEY ("household_id","recurring_id") REFERENCES "public"."recurring_payments"("household_id","id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "goal_ops" ADD CONSTRAINT "goal_ops_goal" FOREIGN KEY ("household_id","goal_id") REFERENCES "public"."goals"("household_id","id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "income_sources" ADD CONSTRAINT "income_sources_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incomes" ADD CONSTRAINT "incomes_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "month_plans" ADD CONSTRAINT "month_plans_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_items" ADD CONSTRAINT "plan_items_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recons" ADD CONSTRAINT "recons_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_amounts" ADD CONSTRAINT "recurring_amounts_payment" FOREIGN KEY ("household_id","payment_id") REFERENCES "public"."recurring_payments"("household_id","id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "recurring_payments" ADD CONSTRAINT "recurring_payments_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_one_active" ON "memberships" USING btree ("user_id") WHERE "memberships"."status" = 'active';