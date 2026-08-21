-- Annkut -- schema for RDS MySQL 8.0
--
-- Generated from annkut_2025/bharuchbaps_annkut_new.sql (a phpMyAdmin dump of
-- the old cPanel MySQL 5.7 host). Structure only: no rows, no DEFINER clauses,
-- no stored routines, views or triggers -- the source had none, which is why
-- this migration needs no SUPER privilege on RDS.
--
-- Changes from the source dump:
--   * receipt_book_logs was ENGINE=MyISAM and is now InnoDB. MyISAM gives no
--     transactions and no crash recovery, and RDS snapshots and point-in-time
--     restore assume InnoDB.
--   * CREATE TABLE -> CREATE TABLE IF NOT EXISTS, so this file is re-runnable.
--
-- Charset is utf8mb4 / utf8mb4_unicode_ci throughout, unchanged from the source
-- and required for the Gujarati text in the sevak and mandal names.
--
-- Usage:
--   mysql -h <rds-endpoint> -u admin -p --ssl-mode=REQUIRED \
--         -e "CREATE DATABASE IF NOT EXISTS bharuchbaps_annkut_new
--             CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
--   mysql -h <rds-endpoint> -u admin -p --ssl-mode=REQUIRED \
--         bharuchbaps_annkut_new < db/schema.sql
--
-- To migrate the existing data as well, load the original dump instead; see
-- docs/DEPLOY.md.

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS `activity_log` (
  `id` bigint(20) NOT NULL,
  `user_id` int(11) DEFAULT NULL,
  `action` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `subject_type` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `subject_id` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `details` json DEFAULT NULL,
  `ip_address` varchar(45) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `mandals` (
  `id` int(11) NOT NULL,
  `xetra_id` int(11) NOT NULL,
  `code` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `mandal_role_assignments` (
  `mandal_id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `role_id` int(11) NOT NULL,
  `start_date` date DEFAULT NULL,
  `end_date` date DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `mandal_targets` (
  `id` int(11) NOT NULL,
  `mandal_id` int(11) NOT NULL,
  `year` year(4) NOT NULL,
  `old_target_forms` int(10) UNSIGNED NOT NULL DEFAULT '0',
  `target_forms` int(10) UNSIGNED NOT NULL DEFAULT '0',
  `target_amount` decimal(12,2) DEFAULT '0.00'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `permissions` (
  `id` int(11) NOT NULL,
  `code` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `receipts` (
  `id` int(11) NOT NULL,
  `mandal_id` int(11) NOT NULL,
  `book_no` int(11) NOT NULL,
  `receipt_no` int(11) NOT NULL,
  `sahyogi_id` int(11) DEFAULT NULL,
  `sahyogi_name` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sahyogi_number` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `prasad_type` enum('annkut_sevak','sahyogi_pote') COLLATE utf8mb4_unicode_ci NOT NULL,
  `seva_amount` int(12) NOT NULL,
  `payment_method` enum('cash','online','other') COLLATE utf8mb4_unicode_ci DEFAULT 'cash',
  `collected_by_id` int(11) NOT NULL,
  `collected_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `notes` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` enum('recorded','void','refunded') COLLATE utf8mb4_unicode_ci DEFAULT 'recorded',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `receipt_books` (
  `id` int(11) NOT NULL,
  `mandal_id` int(11) NOT NULL,
  `issued_to_user_id` int(11) DEFAULT NULL,
  `book_no` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `start_no` int(11) NOT NULL,
  `end_no` int(11) NOT NULL,
  `last_used_no` int(11) DEFAULT NULL,
  `status` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `issued_on` date DEFAULT NULL,
  `submitted_at` datetime DEFAULT NULL,
  `deleted_at` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `receipt_book_logs` (
  `id` int(11) NOT NULL,
  `book_id` int(11) NOT NULL,
  `from_user_id` int(11) DEFAULT NULL,
  `to_user_id` int(11) DEFAULT NULL,
  `to_mandal_id` int(11) DEFAULT NULL,
  `action` enum('ISSUE_TO_MANDAL','ISSUE_TO_SANCHALAK','ISSUE_TO_SEVAK','RECALL','CLOSE') COLLATE utf8mb4_unicode_ci NOT NULL,
  `note` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `roles` (
  `id` int(11) NOT NULL,
  `code` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `role_permissions` (
  `role_id` int(11) NOT NULL,
  `permission_id` int(11) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `sahyogi` (
  `id` int(11) NOT NULL,
  `name` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `phone` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `address` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `city` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `pincode` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `notes` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `sevak_targets` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `user_id` bigint(20) UNSIGNED NOT NULL,
  `year` smallint(6) NOT NULL,
  `target_forms` int(11) NOT NULL DEFAULT '0',
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `users` (
  `id` int(11) NOT NULL,
  `sevak_code` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `phone_number` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `password` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `is_changed` enum('yes','no') COLLATE utf8mb4_unicode_ci DEFAULT 'no',
  `active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `user_mandal_memberships` (
  `user_id` int(11) NOT NULL,
  `mandal_id` int(11) NOT NULL,
  `is_primary` tinyint(1) NOT NULL DEFAULT '1',
  `start_date` date DEFAULT NULL,
  `end_date` date DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `user_roles` (
  `user_id` int(11) NOT NULL,
  `role_id` int(11) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `xetra` (
  `id` int(11) NOT NULL,
  `code` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `sant_nirdeshak` int(11) NOT NULL,
  `active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `activity_log`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_al_user` (`user_id`),
  ADD KEY `idx_al_action` (`action`);

ALTER TABLE `mandals`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_mandal_code` (`code`),
  ADD UNIQUE KEY `uq_mandal_name` (`name`),
  ADD KEY `idx_mandal_xetra` (`xetra_id`);

ALTER TABLE `mandal_role_assignments`
  ADD PRIMARY KEY (`mandal_id`,`user_id`,`role_id`),
  ADD KEY `idx_mra_user` (`user_id`),
  ADD KEY `fk_mra_role` (`role_id`);

ALTER TABLE `mandal_targets`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_mandal_year` (`mandal_id`,`year`),
  ADD KEY `idx_mt_mandal` (`mandal_id`);

ALTER TABLE `permissions`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `code` (`code`);

ALTER TABLE `receipts`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_receipt_per_book` (`book_no`,`receipt_no`),
  ADD KEY `idx_receipts_mandal` (`mandal_id`),
  ADD KEY `idx_receipts_collector` (`collected_by_id`),
  ADD KEY `idx_receipts_prasad` (`prasad_type`),
  ADD KEY `idx_receipts_amount` (`seva_amount`),
  ADD KEY `idx_receipts_collected_at` (`collected_at`),
  ADD KEY `fk_receipt_donor` (`sahyogi_id`);

ALTER TABLE `receipt_books`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_book_per_mandal` (`mandal_id`,`book_no`),
  ADD KEY `idx_rb_user` (`issued_to_user_id`);

ALTER TABLE `receipt_book_logs`
  ADD PRIMARY KEY (`id`);

ALTER TABLE `roles`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `code` (`code`);

ALTER TABLE `role_permissions`
  ADD PRIMARY KEY (`role_id`,`permission_id`),
  ADD KEY `fk_rp_perm` (`permission_id`);

ALTER TABLE `sahyogi`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_donor_phone` (`phone`);

ALTER TABLE `sevak_targets`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_user_year` (`user_id`,`year`) USING BTREE,
  ADD UNIQUE KEY `uniq_user_year` (`user_id`,`year`);

ALTER TABLE `users`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `sevak_code` (`sevak_code`);

ALTER TABLE `user_mandal_memberships`
  ADD PRIMARY KEY (`user_id`,`mandal_id`),
  ADD KEY `idx_umm_mandal` (`mandal_id`);

ALTER TABLE `user_roles`
  ADD PRIMARY KEY (`user_id`,`role_id`),
  ADD KEY `fk_ur_role` (`role_id`);

ALTER TABLE `xetra`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `code` (`code`),
  ADD KEY `sant_nirdeshak` (`sant_nirdeshak`);

ALTER TABLE `activity_log`
  MODIFY `id` bigint(20) NOT NULL AUTO_INCREMENT;

ALTER TABLE `mandals`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=44;

ALTER TABLE `mandal_targets`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=44;

ALTER TABLE `permissions`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=11;

ALTER TABLE `receipts`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=11418;

ALTER TABLE `receipt_books`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=709;

ALTER TABLE `receipt_book_logs`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

ALTER TABLE `roles`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=8;

ALTER TABLE `sahyogi`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=8218;

ALTER TABLE `sevak_targets`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=1027;

ALTER TABLE `users`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=710;

ALTER TABLE `xetra`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=4;

ALTER TABLE `activity_log`
  ADD CONSTRAINT `fk_al_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL;

ALTER TABLE `mandals`
  ADD CONSTRAINT `fk_mandal_xetra` FOREIGN KEY (`xetra_id`) REFERENCES `xetra` (`id`);

ALTER TABLE `mandal_role_assignments`
  ADD CONSTRAINT `fk_mra_mandal` FOREIGN KEY (`mandal_id`) REFERENCES `mandals` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_mra_role` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`),
  ADD CONSTRAINT `fk_mra_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;

ALTER TABLE `mandal_targets`
  ADD CONSTRAINT `fk_mt_mandal` FOREIGN KEY (`mandal_id`) REFERENCES `mandals` (`id`) ON DELETE CASCADE;

ALTER TABLE `receipts`
  ADD CONSTRAINT `fk_receipt_book` FOREIGN KEY (`book_no`) REFERENCES `receipt_books` (`id`),
  ADD CONSTRAINT `fk_receipt_collector` FOREIGN KEY (`collected_by_id`) REFERENCES `users` (`id`),
  ADD CONSTRAINT `fk_receipt_donor` FOREIGN KEY (`sahyogi_id`) REFERENCES `sahyogi` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_receipt_mandal` FOREIGN KEY (`mandal_id`) REFERENCES `mandals` (`id`);

ALTER TABLE `receipt_books`
  ADD CONSTRAINT `fk_rb_mandal` FOREIGN KEY (`mandal_id`) REFERENCES `mandals` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_rb_user` FOREIGN KEY (`issued_to_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL;

ALTER TABLE `role_permissions`
  ADD CONSTRAINT `fk_rp_perm` FOREIGN KEY (`permission_id`) REFERENCES `permissions` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_rp_role` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE CASCADE;

ALTER TABLE `user_mandal_memberships`
  ADD CONSTRAINT `fk_umm_mandal` FOREIGN KEY (`mandal_id`) REFERENCES `mandals` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_umm_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;

ALTER TABLE `user_roles`
  ADD CONSTRAINT `fk_ur_role` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_ur_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;

ALTER TABLE `xetra`
  ADD CONSTRAINT `fk_xetra_sant_nirdeshak` FOREIGN KEY (`sant_nirdeshak`) REFERENCES `users` (`id`) ON UPDATE CASCADE;

SET FOREIGN_KEY_CHECKS = 1;
