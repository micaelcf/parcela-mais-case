CREATE TYPE "attempt_reason" AS ENUM('AMOUNT_ABOVE_LIMIT', 'PROFILE_NOT_ELIGIBLE', 'LENDER_ERROR', 'TIMEOUT', 'CIRCUIT_OPEN', 'DISABLED', 'INTEGRATION_ERROR');--> statement-breakpoint
CREATE TYPE "attempt_status" AS ENUM('PENDING', 'APPROVED', 'REFUSED', 'UNAVAILABLE');--> statement-breakpoint
CREATE TYPE "lender_code" AS ENUM('ALFA', 'BETA', 'GAMA', 'DELTA');--> statement-breakpoint
CREATE TYPE "quote_status" AS ENUM('QUOTING', 'SETTLED');--> statement-breakpoint
CREATE TYPE "simulation_scenario" AS ENUM('NORMAL', 'ALL_APPROVE', 'DELTA_FAILS', 'DELTA_TIMES_OUT', 'NONE_APPROVE');--> statement-breakpoint
CREATE TABLE "consultation" (
	"id" uuid PRIMARY KEY,
	"patient_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL UNIQUE,
	"request_hash" text NOT NULL,
	"monthly_income_cents" bigint NOT NULL,
	"treatment_amount_cents" bigint NOT NULL,
	"birthdate" date NOT NULL,
	"age_years" smallint NOT NULL,
	"simulation_scenario" "simulation_scenario" DEFAULT 'NORMAL'::"simulation_scenario" NOT NULL,
	"quote_status" "quote_status" DEFAULT 'QUOTING'::"quote_status" NOT NULL,
	"deadline_at" timestamp with time zone NOT NULL,
	"settled_at" timestamp with time zone,
	"chosen_offer_id" uuid,
	"chosen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lender_attempt" (
	"id" uuid PRIMARY KEY,
	"consultation_id" uuid NOT NULL,
	"lender" "lender_code" NOT NULL,
	"simulation_scenario" "simulation_scenario" NOT NULL,
	"status" "attempt_status" DEFAULT 'PENDING'::"attempt_status" NOT NULL,
	"reason" "attempt_reason",
	"approved_cents" bigint,
	"monthly_rate" numeric(7,6),
	"max_approvable_cents" bigint,
	"breaker_probe" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"picked_at" timestamp with time zone,
	"called_at" timestamp with time zone,
	"settled_at" timestamp with time zone,
	"latency_ms" integer,
	CONSTRAINT "lender_attempt_consultation_lender_key" UNIQUE("consultation_id","lender")
);
--> statement-breakpoint
CREATE TABLE "lender_setting" (
	"lender" "lender_code" PRIMARY KEY,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "lender_switch_log" (
	"id" uuid PRIMARY KEY,
	"lender" "lender_code" NOT NULL,
	"enabled" boolean NOT NULL,
	"actor" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offer" (
	"id" uuid PRIMARY KEY,
	"attempt_id" uuid NOT NULL,
	"consultation_id" uuid NOT NULL,
	"lender" "lender_code" NOT NULL,
	"approved_cents" bigint NOT NULL,
	"requested_cents" bigint NOT NULL,
	"monthly_rate" numeric(7,6) NOT NULL,
	"term_months" smallint NOT NULL,
	"installment_cents" bigint NOT NULL,
	"total_cents" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "offer_attempt_term_key" UNIQUE("attempt_id","term_months")
);
--> statement-breakpoint
CREATE TABLE "patient" (
	"id" uuid PRIMARY KEY,
	"cpf_hmac" bytea NOT NULL UNIQUE,
	"cpf_ciphertext" bytea NOT NULL,
	"cpf_key_version" smallint NOT NULL,
	"full_name" text NOT NULL,
	"birthdate" date NOT NULL,
	"phone" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "request_throttle" (
	"id" uuid PRIMARY KEY,
	"ip_hmac" bytea NOT NULL,
	"route" text NOT NULL,
	"status_code" smallint,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "consultation_patient_created_idx" ON "consultation" ("patient_id","created_at");--> statement-breakpoint
CREATE INDEX "consultation_created_id_idx" ON "consultation" ("created_at","id");--> statement-breakpoint
CREATE INDEX "consultation_quote_deadline_idx" ON "consultation" ("quote_status","deadline_at");--> statement-breakpoint
CREATE INDEX "lender_attempt_breaker_idx" ON "lender_attempt" ("lender","simulation_scenario","settled_at" desc);--> statement-breakpoint
CREATE INDEX "lender_switch_log_created_id_idx" ON "lender_switch_log" ("created_at","id");--> statement-breakpoint
CREATE INDEX "request_throttle_ip_route_created_idx" ON "request_throttle" ("ip_hmac","route","created_at");--> statement-breakpoint
CREATE INDEX "request_throttle_created_id_idx" ON "request_throttle" ("created_at","id");--> statement-breakpoint
ALTER TABLE "consultation" ADD CONSTRAINT "consultation_patient_id_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patient"("id");--> statement-breakpoint
ALTER TABLE "consultation" ADD CONSTRAINT "consultation_chosen_offer_id_offer_id_fkey" FOREIGN KEY ("chosen_offer_id") REFERENCES "offer"("id");--> statement-breakpoint
ALTER TABLE "lender_attempt" ADD CONSTRAINT "lender_attempt_consultation_id_consultation_id_fkey" FOREIGN KEY ("consultation_id") REFERENCES "consultation"("id");--> statement-breakpoint
ALTER TABLE "offer" ADD CONSTRAINT "offer_attempt_id_lender_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "lender_attempt"("id");--> statement-breakpoint
ALTER TABLE "offer" ADD CONSTRAINT "offer_consultation_id_consultation_id_fkey" FOREIGN KEY ("consultation_id") REFERENCES "consultation"("id");