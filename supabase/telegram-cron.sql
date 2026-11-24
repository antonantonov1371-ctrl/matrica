-- Uses the existing encrypted scheduler credential. No browser permission is needed.
select cron.schedule('matrica-telegram-reminders','* * * * *',$cron$
 select net.http_post(
   url := replace((select decrypted_secret from vault.decrypted_secrets where name='matrica_push_url'),
                  'matrica-push?action=dispatch','matrica-telegram?action=dispatch'),
   headers := jsonb_build_object('Content-Type','application/json','Authorization',
     'Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='matrica_push_scheduler_token')),
   body := '{}'::jsonb,timeout_milliseconds := 100000
 );
$cron$);
