CREATE TABLE "goal_allocs" (
	"household_id" text NOT NULL,
	"goal_id" text NOT NULL,
	"account_id" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"version" integer NOT NULL,
	CONSTRAINT "goal_allocs_household_id_goal_id_account_id_pk" PRIMARY KEY("household_id","goal_id","account_id"),
	CONSTRAINT "goal_allocs_amount" CHECK ("goal_allocs"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ledger_moves" (
	"household_id" text NOT NULL,
	"id" text NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"account_id" text NOT NULL,
	"to_account_id" text,
	"amount" numeric(14, 2) NOT NULL,
	"to_amount" numeric(14, 2),
	"date" date NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	CONSTRAINT "ledger_moves_household_id_id_pk" PRIMARY KEY("household_id","id"),
	CONSTRAINT "ledger_moves_transfer" CHECK (("ledger_moves"."type" = 'transfer') = ("ledger_moves"."to_account_id" IS NOT NULL AND "ledger_moves"."to_amount" IS NOT NULL)),
	CONSTRAINT "ledger_moves_amount" CHECK ("ledger_moves"."type" = 'adjustment' OR ("ledger_moves"."amount" > 0 AND "ledger_moves"."to_amount" > 0 AND "ledger_moves"."to_account_id" <> "ledger_moves"."account_id"))
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "initial_at" date;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "primary" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "account_id" text;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "account_amount" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "goal_id" text;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "legacy" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "households" ADD COLUMN "ledger_since" date;--> statement-breakpoint
ALTER TABLE "incomes" ADD COLUMN "account_id" text;--> statement-breakpoint
ALTER TABLE "incomes" ADD COLUMN "account_amount" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "incomes" ADD COLUMN "legacy" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "goal_allocs" ADD CONSTRAINT "goal_allocs_goal" FOREIGN KEY ("household_id","goal_id") REFERENCES "public"."goals"("household_id","id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ledger_moves" ADD CONSTRAINT "ledger_moves_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_moves" ADD CONSTRAINT "ledger_moves_user" FOREIGN KEY ("household_id","user_id") REFERENCES "public"."memberships"("household_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "goal_allocs_account" ON "goal_allocs" USING btree ("household_id","account_id");--> statement-breakpoint
CREATE INDEX "ledger_moves_account" ON "ledger_moves" USING btree ("household_id","account_id");--> statement-breakpoint
CREATE INDEX "ledger_moves_to_account" ON "ledger_moves" USING btree ("household_id","to_account_id");--> statement-breakpoint
CREATE INDEX "expenses_account" ON "expenses" USING btree ("household_id","account_id");--> statement-breakpoint
CREATE INDEX "incomes_account" ON "incomes" USING btree ("household_id","account_id");--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_account_pair" CHECK (("expenses"."account_id" IS NULL) = ("expenses"."account_amount" IS NULL));--> statement-breakpoint
ALTER TABLE "incomes" ADD CONSTRAINT "incomes_account_pair" CHECK (("incomes"."account_id" IS NULL) = ("incomes"."account_amount" IS NULL));