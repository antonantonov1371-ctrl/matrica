-- Run after deploying the function and its first config request, which creates:
-- matrica_push_url = https://PROJECT.supabase.co/functions/v1/matrica-push?action=dispatch
-- matrica_push_scheduler_token = generated in the server and encrypted in Vault
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
select cron.schedule('matrica-reminders', '* * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='matrica_push_url'),
    headers := jsonb_build_object('Content-Type','application/json','Authorization',
      'Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='matrica_push_scheduler_token')),
    body := '{}'::jsonb,
    timeout_milliseconds := 50000
  );
$$);
