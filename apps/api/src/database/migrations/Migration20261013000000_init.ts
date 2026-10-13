import { Migration } from '@mikro-orm/migrations';

export class Migration20261013000000_init extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table "users" ("id" uuid not null, "email" varchar(254) not null, "password_hash" varchar(255) not null, "created_at" timestamptz not null, constraint "users_pkey" primary key ("id"));`);
    this.addSql(`alter table "users" add constraint "users_email_unique" unique ("email");`);

    this.addSql(`create table "sessions" ("id" uuid not null, "user_id" uuid not null, "token_hash" varchar(64) not null, "expires_at" timestamptz not null, "created_at" timestamptz not null, constraint "sessions_pkey" primary key ("id"));`);
    this.addSql(`alter table "sessions" add constraint "sessions_token_hash_unique" unique ("token_hash");`);
    this.addSql(`create index "sessions_expires_at_index" on "sessions" ("expires_at");`);
    this.addSql(`create index "sessions_user_id_index" on "sessions" ("user_id");`);

    this.addSql(`create table "cvs" ("id" uuid not null, "owner_id" uuid not null, "title" varchar(120) not null, "target_role" varchar(120) not null, "status" text check ("status" in ('generating', 'ready', 'failed')) not null default 'generating', "source_type" text check ("source_type" in ('pdf', 'text')) not null, "source_file_name" varchar(255) null, "source_text" text not null, "document" jsonb null, "removed_claims" jsonb not null default '[]', "version" int not null default 0, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "cvs_pkey" primary key ("id"));`);
    this.addSql(`create index "cvs_owner_id_updated_at_index" on "cvs" ("owner_id", "updated_at");`);

    this.addSql(`create table "cv_questions" ("id" uuid not null, "cv_id" uuid not null, "section" text check ("section" in ('contact', 'summary', 'experience', 'education', 'skills')) not null, "item_id" varchar(40) null, "question" text not null, "status" text check ("status" in ('open', 'applying', 'answered', 'dismissed')) not null default 'open', "answer" text null, "origin" text check ("origin" in ('model', 'verifier')) not null default 'model', "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "cv_questions_pkey" primary key ("id"));`);
    this.addSql(`create index "cv_questions_cv_id_index" on "cv_questions" ("cv_id");`);

    this.addSql(`create table "cv_jobs" ("id" uuid not null, "cv_id" uuid not null, "type" text check ("type" in ('generate', 'apply_answer')) not null, "status" text check ("status" in ('queued', 'running', 'succeeded', 'failed')) not null default 'queued', "stage" varchar(32) null default 'queued', "attempts" int not null default 0, "error" text null, "question_id" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "cv_jobs_pkey" primary key ("id"));`);
    this.addSql(`create index "cv_jobs_cv_id_index" on "cv_jobs" ("cv_id");`);
    this.addSql(`create index "cv_jobs_status_updated_at_index" on "cv_jobs" ("status", "updated_at");`);
    // Database-level guard against double submits: at most one in-flight
    // generation per CV, and at most one in-flight apply per question.
    this.addSql(`create unique index "cv_jobs_one_active_generate" on "cv_jobs" ("cv_id") where "type" = 'generate' and "status" in ('queued', 'running');`);
    this.addSql(`create unique index "cv_jobs_one_active_apply_per_question" on "cv_jobs" ("question_id") where "type" = 'apply_answer' and "status" in ('queued', 'running');`);

    this.addSql(`alter table "sessions" add constraint "sessions_user_id_foreign" foreign key ("user_id") references "users" ("id") on update cascade on delete cascade;`);
    this.addSql(`alter table "cvs" add constraint "cvs_owner_id_foreign" foreign key ("owner_id") references "users" ("id") on update cascade on delete cascade;`);
    this.addSql(`alter table "cv_questions" add constraint "cv_questions_cv_id_foreign" foreign key ("cv_id") references "cvs" ("id") on update cascade on delete cascade;`);
    this.addSql(`alter table "cv_jobs" add constraint "cv_jobs_cv_id_foreign" foreign key ("cv_id") references "cvs" ("id") on update cascade on delete cascade;`);
    this.addSql(`alter table "cv_jobs" add constraint "cv_jobs_question_id_foreign" foreign key ("question_id") references "cv_questions" ("id") on update cascade on delete set null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "cv_jobs" cascade;`);
    this.addSql(`drop table if exists "cv_questions" cascade;`);
    this.addSql(`drop table if exists "cvs" cascade;`);
    this.addSql(`drop table if exists "sessions" cascade;`);
    this.addSql(`drop table if exists "users" cascade;`);
  }
}
