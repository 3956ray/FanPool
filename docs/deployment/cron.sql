-- CANDIDATE ONLY. Do not run before Leader's external Gate.
-- Require approved pg_cron + pg_net, Vault secret fanpool_index_worker_secret,
-- exact deployment origin, roles/grants review, and public worker smoke test.
-- No secret literals; never paste decrypted values into logs/chat.
SELECT cron.schedule('fanpool-index-minute', '* * * * *', $job$
 SELECT net.http_post(
  url := 'https://fan-pool-eta.vercel.app/api/internal/index',
  headers := jsonb_build_object('Content-Type','application/json','Authorization',
    'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='fanpool_index_worker_secret')),
  body := '{}'::jsonb,
  timeout_milliseconds := 30000
 );
$job$);
-- Inspect cron.job_run_details plus net._http_response status/error and index cursor.
-- A successful cron SELECT only enqueues HTTP; it does not mean the worker succeeded.
-- Approved rollback: SELECT cron.unschedule('fanpool-index-minute'); keep indexed data.
