/*
  SQL_012 — Supervision des jobs SQL Agent « GR Job Reglement Inwi » et « GR Job Reglement Inwi (Planification Instantané) ».

  CONSTAT (analyse du 2026-10-01, pilotage/ANALYSE_JOBS_SQL_REGLEMENT_INWI_2026-10-01.md) :
   - historique SQL Agent par défaut : 1000 lignes au total, 100 par job → ≈ 35 min d'historique pour le job 1 (15 lignes par passage
     toutes les 5 min) et ≈ 4 min pour le job 2 (4 lignes toutes les 10 s) : une panne d'hier est déjà effacée ;
   - presque toutes les étapes sont en « en cas d'échec : passer à l'étape suivante » : une étape en erreur ne fait PAS échouer le job,
     qui se termine « Réussi » ; aucune alerte, aucun opérateur, Database Mail non configuré.

  CE QUE FAIT CE SCRIPT (mode aperçu par défaut : @Apply = 0, rien n'est modifié)
   1. Crée GR_GOCOM.dbo.prc_ControleEchecsJob : lit msdb.dbo.sysjobhistory et lève une erreur si une étape du passage EN COURS du job
      a échoué (lignes postérieures à la dernière ligne de fin de job). Les étapes continuent de s'exécuter normalement (indépendance
      conservée) ; seul le résultat final du job devient « Échec » s'il y a eu une erreur quelque part.
   2. Ajoute à chaque job une dernière étape « Contrôle des échecs d'étapes » qui appelle cette procédure, et fait pointer l'ancienne
      dernière étape vers elle (« en cas de succès : étape suivante » au lieu de « quitter »).
   3. Active la notification dans le journal d'événements Windows (journal Application, source SQLSERVERAGENT) en cas d'échec du job.
      E-mail : seulement si @OperatorEmail est renseigné ET que Database Mail est configuré pour SQL Agent (non couvert ici).
   4. Porte l'historique à @HistoMaxRows / @HistoMaxRowsPerJob. ATTENTION : réglage de SQL Agent pour TOUT le serveur (tous les jobs).

  Nécessite sysadmin. À exécuter sur le serveur du job (SQL Agent). Les paramètres sont en tête du bloc de configuration.
  Non testé sur un vrai SQL Agent (service arrêté sur le poste de développement) : la procédure de contrôle est testée sur une copie
  des tables msdb ; l'application sur les jobs doit d'abord être lue en aperçu, puis faite en heures creuses.
  ANNULATION : bloc en fin de fichier.
*/
USE GR_GOCOM;
GO

------------------------------------------------------------------------------------------ PROCÉDURE DE CONTRÔLE
CREATE OR ALTER PROCEDURE dbo.prc_ControleEchecsJob
    @JobName SYSNAME,
    @MsdbDb  SYSNAME = N'msdb'          -- paramétrable uniquement pour les tests
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @sql NVARCHAR(MAX), @n INT, @liste NVARCHAR(MAX), @msg NVARCHAR(2000);

    SET @sql = N'
      DECLARE @id UNIQUEIDENTIFIER = (SELECT job_id FROM ' + QUOTENAME(@MsdbDb) + N'.dbo.sysjobs WHERE name = @j);
      IF @id IS NULL BEGIN SET @n = -1; RETURN; END
      -- dernière ligne de fin de job (step_id = 0) = frontière du passage précédent
      DECLARE @last INT = ISNULL((SELECT MAX(instance_id) FROM ' + QUOTENAME(@MsdbDb) + N'.dbo.sysjobhistory WHERE job_id = @id AND step_id = 0), 0);
      SELECT @n = COUNT(*),
             @liste = STRING_AGG(CONCAT(CAST(step_id AS VARCHAR(5)), N'' ('', step_name, N''): '', LEFT(message, 300)), NCHAR(10)) WITHIN GROUP (ORDER BY step_id)
        FROM ' + QUOTENAME(@MsdbDb) + N'.dbo.sysjobhistory
       WHERE job_id = @id AND step_id > 0 AND run_status = 0 AND instance_id > @last;';
    EXEC sp_executesql @sql, N'@j SYSNAME, @n INT OUTPUT, @liste NVARCHAR(MAX) OUTPUT', @j = @JobName, @n = @n OUTPUT, @liste = @liste OUTPUT;

    IF @n = -1
    BEGIN
        RAISERROR('Job [%s] introuvable dans msdb : contrôle impossible.', 16, 1, @JobName);
        RETURN;
    END
    IF ISNULL(@n, 0) > 0
    BEGIN
        SET @msg = LEFT(CONCAT(@n, N' étape(s) en échec dans ce passage du job [', @JobName, N'] : ', NCHAR(10), @liste), 2000);
        RAISERROR('%s', 16, 1, @msg);
    END
END
GO

------------------------------------------------------------------------------------------ CONFIGURATION DES JOBS
SET NOCOUNT ON;
DECLARE @Apply              BIT           = 0;      -- 0 = aperçu (état actuel + actions prévues) ; 1 = APPLIQUE
DECLARE @JobReglement       SYSNAME       = N'GR Job Reglement Inwi';
DECLARE @JobInstantane      SYSNAME       = N'GR Job Reglement Inwi (Planification Instantané)';
DECLARE @BaseGR             SYSNAME       = N'GR_GOCOM';        -- base où est créée prc_ControleEchecsJob
DECLARE @HistoMaxRows       INT           = 150000;             -- historique total (défaut SQL Agent : 1000)
DECLARE @HistoMaxRowsPerJob INT           = 100000;             -- historique par job (défaut : 100) ; job 2 ≈ 14 000 lignes/jour
DECLARE @OperatorName       SYSNAME       = N'Supervision GRC'; -- créé seulement si @OperatorEmail est renseigné
DECLARE @OperatorEmail      NVARCHAR(100) = NULL;               -- ex. N'it@client.ma' ; NULL = journal d'événements seulement
DECLARE @StepName           SYSNAME       = N'Contrôle des échecs d''étapes';

IF NOT EXISTS (SELECT 1 FROM msdb.dbo.sysjobs WHERE name = @JobReglement)  BEGIN RAISERROR('Job [%s] introuvable.', 16, 1, @JobReglement);  RETURN; END
IF NOT EXISTS (SELECT 1 FROM msdb.dbo.sysjobs WHERE name = @JobInstantane) BEGIN RAISERROR('Job [%s] introuvable.', 16, 1, @JobInstantane); RETURN; END

-- état actuel
SELECT 'JOBS' AS Section, j.name, j.enabled, j.notify_level_eventlog, j.notify_level_email
FROM msdb.dbo.sysjobs j WHERE j.name IN (@JobReglement, @JobInstantane);
SELECT 'ETAPES' AS Section, j.name AS Job, s.step_id, s.step_name, s.on_success_action, s.on_fail_action
FROM msdb.dbo.sysjobsteps s JOIN msdb.dbo.sysjobs j ON j.job_id = s.job_id
WHERE j.name IN (@JobReglement, @JobInstantane) ORDER BY j.name, s.step_id;
SELECT 'PLAN' AS Section, j.name AS Job,
       CASE WHEN EXISTS (SELECT 1 FROM msdb.dbo.sysjobsteps s WHERE s.job_id = j.job_id AND s.step_name = @StepName)
            THEN 'étape de contrôle déjà présente'
            ELSE CONCAT('ajout de l''étape de contrôle en position ', (SELECT MAX(step_id) + 1 FROM msdb.dbo.sysjobsteps s WHERE s.job_id = j.job_id),
                        ' ; étape ', (SELECT MAX(step_id) FROM msdb.dbo.sysjobsteps s WHERE s.job_id = j.job_id), ' : succès -> étape suivante') END AS Action_
FROM msdb.dbo.sysjobs j WHERE j.name IN (@JobReglement, @JobInstantane);
PRINT CONCAT('Historique : ', @HistoMaxRows, ' lignes au total, ', @HistoMaxRowsPerJob, ' par job (TOUS les jobs du serveur). Notification : journal d''événements',
             CASE WHEN @OperatorEmail IS NULL THEN '.' ELSE CONCAT(' + e-mail à ', @OperatorEmail, '.') END);

IF @Apply <> 1 BEGIN PRINT 'Aperçu uniquement (@Apply = 0). Rien n''a été modifié.'; RETURN; END

------------------------------------------------------------------------------------------ APPLICATION
IF OBJECT_ID('GR_GOCOM.dbo.prc_ControleEchecsJob') IS NULL BEGIN RAISERROR('prc_ControleEchecsJob absente de GR_GOCOM.', 16, 1); RETURN; END

-- 1. historique
EXEC msdb.dbo.sp_set_sqlagent_properties @jobhistory_max_rows = @HistoMaxRows, @jobhistory_max_rows_per_job = @HistoMaxRowsPerJob;

-- 2. opérateur (optionnel)
IF @OperatorEmail IS NOT NULL AND NOT EXISTS (SELECT 1 FROM msdb.dbo.sysoperators WHERE name = @OperatorName)
    EXEC msdb.dbo.sp_add_operator @name = @OperatorName, @enabled = 1, @email_address = @OperatorEmail;

-- 3. par job : notification + étape de contrôle
DECLARE @j SYSNAME, @maxStep INT, @cmd NVARCHAR(MAX);
DECLARE c CURSOR LOCAL FAST_FORWARD FOR SELECT name FROM (VALUES (@JobReglement), (@JobInstantane)) v(name);
OPEN c; FETCH NEXT FROM c INTO @j;
WHILE @@FETCH_STATUS = 0
BEGIN
    IF @OperatorEmail IS NULL
        EXEC msdb.dbo.sp_update_job @job_name = @j, @notify_level_eventlog = 2;
    ELSE
        EXEC msdb.dbo.sp_update_job @job_name = @j, @notify_level_eventlog = 2, @notify_level_email = 2, @notify_email_operator_name = @OperatorName;

    IF NOT EXISTS (SELECT 1 FROM msdb.dbo.sysjobsteps s JOIN msdb.dbo.sysjobs x ON x.job_id = s.job_id WHERE x.name = @j AND s.step_name = @StepName)
    BEGIN
        SELECT @maxStep = MAX(s.step_id) FROM msdb.dbo.sysjobsteps s JOIN msdb.dbo.sysjobs x ON x.job_id = s.job_id WHERE x.name = @j;
        -- l'ancienne dernière étape ne « quitte » plus : elle passe à l'étape de contrôle
        EXEC msdb.dbo.sp_update_jobstep @job_name = @j, @step_id = @maxStep, @on_success_action = 3, @on_success_step_id = 0;
        SET @cmd = N'EXEC dbo.prc_ControleEchecsJob @JobName = N''' + REPLACE(@j, '''', '''''') + N''';';
        EXEC msdb.dbo.sp_add_jobstep @job_name = @j, @step_name = @StepName, @step_id = @maxStep + 1, @subsystem = N'TSQL',
             @command = @cmd, @database_name = @BaseGR, @on_success_action = 1, @on_fail_action = 2;
        PRINT CONCAT('[', @j, '] étape de contrôle ajoutée en position ', @maxStep + 1, '.');
    END
    ELSE PRINT CONCAT('[', @j, '] étape de contrôle déjà présente : inchangée.');
    FETCH NEXT FROM c INTO @j;
END
CLOSE c; DEALLOCATE c;
PRINT 'Supervision en place. Vérifier : un passage du job, puis SELECT TOP 20 * FROM msdb.dbo.sysjobhistory ORDER BY instance_id DESC.';

/*
  ANNULATION (remplacer les noms si besoin) :
  EXEC msdb.dbo.sp_delete_jobstep @job_name = N'GR Job Reglement Inwi', @step_id = 15;                                   -- dernier step_id = étape de contrôle
  EXEC msdb.dbo.sp_update_jobstep @job_name = N'GR Job Reglement Inwi', @step_id = 14, @on_success_action = 1;           -- l'ancienne dernière étape quitte à nouveau
  EXEC msdb.dbo.sp_delete_jobstep @job_name = N'GR Job Reglement Inwi (Planification Instantané)', @step_id = 4;
  EXEC msdb.dbo.sp_update_jobstep @job_name = N'GR Job Reglement Inwi (Planification Instantané)', @step_id = 3, @on_success_action = 1;
  EXEC msdb.dbo.sp_update_job @job_name = N'GR Job Reglement Inwi', @notify_level_eventlog = 0;
  EXEC msdb.dbo.sp_update_job @job_name = N'GR Job Reglement Inwi (Planification Instantané)', @notify_level_eventlog = 0;
  EXEC msdb.dbo.sp_set_sqlagent_properties @jobhistory_max_rows = 1000, @jobhistory_max_rows_per_job = 100;
*/
