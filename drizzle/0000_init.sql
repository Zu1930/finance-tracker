CREATE TABLE "accounts" (
	"household_id" text NOT NULL,
	"id" text NOT NULL,
	"name" text NOT NULL,
	"currency" text NOT NULL,
	"scope" text NOT NULL,
	"owner_id" text,
	"balance" numeric(14, 2) NOT NULL,
	"initial" numeric(14, 2) NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"updated_by" text NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"version" integer NOT NULL,
	CONSTRAINT "accounts_household_id_id_pk" PRIMARY KEY("household_id","id"),
	CONSTRAINT "accounts_scope_owner" CHECK (("accounts"."scope" = 'personal') = ("accounts"."owner_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "api_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"hash" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "app_meta" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"household_id" text NOT NULL,
	"id" text NOT NULL,
	"scope" text NOT NULL,
	"owner_id" text,
	"name" text NOT NULL,
	"limit" numeric(14, 2) NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"since" char(7),
	"archived_from" char(7),
	"history" jsonb,
	"sort" integer NOT NULL,
	CONSTRAINT "categories_scope_owner" CHECK (("categories"."scope" = 'personal') = ("categories"."owner_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "deleted_entries" (
	"household_id" text NOT NULL,
	"id" text NOT NULL,
	"kind" text NOT NULL,
	"owner_id" text,
	"entry" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "deleted_entries_household_id_id_pk" PRIMARY KEY("household_id","id")
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"household_id" text NOT NULL,
	"id" text NOT NULL,
	"author_id" text NOT NULL,
	"scope" text NOT NULL,
	"owner_id" text,
	"category_id" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"currency" text NOT NULL,
	"rate" numeric NOT NULL,
	"base" numeric(14, 2) NOT NULL,
	"date" date NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"plan_item_id" text,
	"recurring_id" text,
	"recurring_month" char(7),
	CONSTRAINT "expenses_household_id_id_pk" PRIMARY KEY("household_id","id"),
	CONSTRAINT "expenses_scope_owner" CHECK (("expenses"."scope" = 'personal') = ("expenses"."owner_id" IS NOT NULL)),
	CONSTRAINT "expenses_owner_is_author" CHECK ("expenses"."owner_id" IS NULL OR "expenses"."owner_id" = "expenses"."author_id"),
	CONSTRAINT "expenses_recurring_pair" CHECK (("expenses"."recurring_id" IS NULL) = ("expenses"."recurring_month" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "goal_ops" (
	"household_id" text NOT NULL,
	"goal_id" text NOT NULL,
	"id" text NOT NULL,
	"pos" integer NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"date" date NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"by" text NOT NULL,
	CONSTRAINT "goal_ops_household_id_goal_id_id_pk" PRIMARY KEY("household_id","goal_id","id")
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"household_id" text NOT NULL,
	"id" text NOT NULL,
	"name" text NOT NULL,
	"target" numeric(14, 2) NOT NULL,
	"currency" text NOT NULL,
	"allocated" numeric(14, 2) NOT NULL,
	"scope" text NOT NULL,
	"owner_id" text,
	"version" integer NOT NULL,
	CONSTRAINT "goals_household_id_id_pk" PRIMARY KEY("household_id","id"),
	CONSTRAINT "goals_scope_owner" CHECK (("goals"."scope" = 'personal') = ("goals"."owner_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "households" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"base_currency" text,
	"currencies" text[] DEFAULT '{}'::text[] NOT NULL,
	"rates" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"rates_updated_at" date,
	"base_history" jsonb,
	"income_sources_set" boolean DEFAULT false NOT NULL,
	"schema_version" integer,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "income_sources" (
	"household_id" text NOT NULL,
	"id" text NOT NULL,
	"name" text NOT NULL,
	"sort" integer NOT NULL,
	CONSTRAINT "income_sources_household_id_id_pk" PRIMARY KEY("household_id","id")
);
--> statement-breakpoint
CREATE TABLE "incomes" (
	"household_id" text NOT NULL,
	"id" text NOT NULL,
	"author_id" text NOT NULL,
	"source_id" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"currency" text NOT NULL,
	"rate" numeric NOT NULL,
	"base" numeric(14, 2) NOT NULL,
	"date" date NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	CONSTRAINT "incomes_household_id_id_pk" PRIMARY KEY("household_id","id")
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"household_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_household_id_user_id_pk" PRIMARY KEY("household_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "month_plans" (
	"household_id" text NOT NULL,
	"month" char(7) NOT NULL,
	"owner_id" text,
	"income_override" numeric(14, 2),
	"limit_overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer NOT NULL,
	CONSTRAINT "month_plans_income_family" CHECK ("month_plans"."owner_id" IS NULL OR "month_plans"."income_override" IS NULL)
);
--> statement-breakpoint
CREATE TABLE "plan_items" (
	"household_id" text NOT NULL,
	"id" text NOT NULL,
	"month" char(7) NOT NULL,
	"name" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"category_id" text NOT NULL,
	"scope" text NOT NULL,
	"owner_id" text,
	"created_by" text NOT NULL,
	"expense_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"moved_from" char(7),
	"version" integer NOT NULL,
	CONSTRAINT "plan_items_household_id_id_pk" PRIMARY KEY("household_id","id"),
	CONSTRAINT "plan_items_scope_owner" CHECK (("plan_items"."scope" = 'personal') = ("plan_items"."owner_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"endpoint" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"subscription" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quick_rate" (
	"token_id" text NOT NULL,
	"minute" bigint NOT NULL,
	"count" integer NOT NULL,
	CONSTRAINT "quick_rate_token_id_minute_pk" PRIMARY KEY("token_id","minute")
);
--> statement-breakpoint
CREATE TABLE "recons" (
	"household_id" text NOT NULL,
	"id" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"day" date NOT NULL,
	"by" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"total_all" numeric(14, 2) NOT NULL,
	"total_family" numeric(14, 2) NOT NULL,
	CONSTRAINT "recons_household_id_id_pk" PRIMARY KEY("household_id","id")
);
--> statement-breakpoint
CREATE TABLE "recurring_amounts" (
	"household_id" text NOT NULL,
	"payment_id" text NOT NULL,
	"from_month" char(7) NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	CONSTRAINT "recurring_amounts_household_id_payment_id_from_month_pk" PRIMARY KEY("household_id","payment_id","from_month")
);
--> statement-breakpoint
CREATE TABLE "recurring_payments" (
	"household_id" text NOT NULL,
	"id" text NOT NULL,
	"name" text NOT NULL,
	"currency" text NOT NULL,
	"approx" boolean NOT NULL,
	"frequency" text NOT NULL,
	"day" integer NOT NULL,
	"month" integer,
	"category_id" text NOT NULL,
	"scope" text NOT NULL,
	"owner_id" text,
	"start_month" char(7) NOT NULL,
	"end_month" char(7),
	"paused" boolean NOT NULL,
	"skips" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_by" text NOT NULL,
	"version" integer NOT NULL,
	CONSTRAINT "recurring_payments_household_id_id_pk" PRIMARY KEY("household_id","id"),
	CONSTRAINT "recurring_payments_scope_owner" CHECK (("recurring_payments"."scope" = 'personal') = ("recurring_payments"."owner_id" IS NOT NULL)),
	CONSTRAINT "recurring_day" CHECK ("recurring_payments"."day" BETWEEN 1 AND 31),
	CONSTRAINT "recurring_month" CHECK (("recurring_payments"."frequency" = 'yearly') = ("recurring_payments"."month" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"household_id" text NOT NULL,
	"user_id" text NOT NULL,
	"preferred_currency" text,
	"hide_quick_entry" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "user_settings_household_id_user_id_pk" PRIMARY KEY("household_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_owner_member" FOREIGN KEY ("household_id","owner_id") REFERENCES "public"."memberships"("household_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_owner" FOREIGN KEY ("household_id","owner_id") REFERENCES "public"."memberships"("household_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deleted_entries" ADD CONSTRAINT "deleted_entries_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_author" FOREIGN KEY ("household_id","author_id") REFERENCES "public"."memberships"("household_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_recurring" FOREIGN KEY ("household_id","recurring_id") REFERENCES "public"."recurring_payments"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_ops" ADD CONSTRAINT "goal_ops_goal" FOREIGN KEY ("household_id","goal_id") REFERENCES "public"."goals"("household_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_owner_member" FOREIGN KEY ("household_id","owner_id") REFERENCES "public"."memberships"("household_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "income_sources" ADD CONSTRAINT "income_sources_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incomes" ADD CONSTRAINT "incomes_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incomes" ADD CONSTRAINT "incomes_author" FOREIGN KEY ("household_id","author_id") REFERENCES "public"."memberships"("household_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "month_plans" ADD CONSTRAINT "month_plans_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "month_plans" ADD CONSTRAINT "month_plans_owner" FOREIGN KEY ("household_id","owner_id") REFERENCES "public"."memberships"("household_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_items" ADD CONSTRAINT "plan_items_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_items" ADD CONSTRAINT "plan_items_owner" FOREIGN KEY ("household_id","owner_id") REFERENCES "public"."memberships"("household_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recons" ADD CONSTRAINT "recons_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_amounts" ADD CONSTRAINT "recurring_amounts_payment" FOREIGN KEY ("household_id","payment_id") REFERENCES "public"."recurring_payments"("household_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_payments" ADD CONSTRAINT "recurring_payments_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_payments" ADD CONSTRAINT "recurring_owner_member" FOREIGN KEY ("household_id","owner_id") REFERENCES "public"."memberships"("household_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_member" FOREIGN KEY ("household_id","user_id") REFERENCES "public"."memberships"("household_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_owner" ON "accounts" USING btree ("household_id","owner_id");--> statement-breakpoint
CREATE INDEX "api_tokens_user" ON "api_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_key" ON "categories" USING btree ("household_id",coalesce("owner_id", ''),"id");--> statement-breakpoint
CREATE INDEX "expenses_date" ON "expenses" USING btree ("household_id","date");--> statement-breakpoint
CREATE INDEX "expenses_owner" ON "expenses" USING btree ("household_id","owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "expenses_recurring_month" ON "expenses" USING btree ("household_id","recurring_id","recurring_month") WHERE "expenses"."recurring_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "goals_owner" ON "goals" USING btree ("household_id","owner_id");--> statement-breakpoint
CREATE INDEX "incomes_date" ON "incomes" USING btree ("household_id","date");--> statement-breakpoint
CREATE INDEX "memberships_user" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "month_plans_key" ON "month_plans" USING btree ("household_id","month",coalesce("owner_id", ''));--> statement-breakpoint
CREATE INDEX "plan_items_month" ON "plan_items" USING btree ("household_id","month");--> statement-breakpoint
CREATE INDEX "push_subscriptions_user" ON "push_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "recons_at" ON "recons" USING btree ("household_id","at");--> statement-breakpoint
CREATE INDEX "recurring_owner" ON "recurring_payments" USING btree ("household_id","owner_id");