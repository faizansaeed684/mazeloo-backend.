-- MAZELOO DEEP CLEANUP & INITIALIZATION (MariaDB / MySQL)
-- This script uses a Procedural Loop to drop ALL foreign keys first.
-- This is the most reliable way to fix the #1451 error on Hostinger.

-- 1. Disable checks for this session
SET FOREIGN_KEY_CHECKS = 0;

-- 2. CREATE A TEMPORARY PROCEDURE TO DROP ALL CONSTRAINTS
-- This handles legacy tables we might not know the names of.
DELIMITER //

CREATE PROCEDURE DropAllForeignKeys()
BEGIN
    DECLARE done INT DEFAULT FALSE;
    DECLARE alter_stmt VARCHAR(1000);
    DECLARE cur CURSOR FOR 
        SELECT CONCAT('ALTER TABLE `', TABLE_SCHEMA, '`.`', TABLE_NAME, '` DROP FOREIGN KEY `', CONSTRAINT_NAME, '`')
        FROM information_schema.TABLE_CONSTRAINTS
        WHERE CONSTRAINT_TYPE = 'FOREIGN KEY' AND TABLE_SCHEMA = DATABASE();
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;

    OPEN cur;
    read_loop: LOOP
        FETCH cur INTO alter_stmt;
        IF done THEN
            LEAVE read_loop;
        END IF;
        SET @s = alter_stmt;
        PREPARE stmt FROM @s;
        EXECUTE stmt;
        DEALLOCATE PREPARE stmt;
    END LOOP;
    CLOSE cur;
END //

DELIMITER ;

-- 3. Execute the procedure
CALL DropAllForeignKeys();
DROP PROCEDURE IF EXISTS DropAllForeignKeys;

-- 4. NOW DROP ALL TABLES SAFELY
DROP TABLE IF EXISTS 
    daily_task_progress, notifications, verifications, referrals, 
    wallet_transactions, task_submissions, task_completions, 
    fraud_flags, reports, admin_logs, tasks, messages, follows, 
    story_views, stories, post_comments, post_likes, posts, users, profiles;

-- 5. Re-create the schema (The correct MySQL version)

CREATE TABLE users (
  id CHAR(36) NOT NULL,
  username VARCHAR(255) NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  password_hash VARCHAR(255) NOT NULL,
  country VARCHAR(100) NOT NULL,
  whatsapp VARCHAR(50),
  bio TEXT,
  date_of_birth DATE,
  avatar_url VARCHAR(500),
  is_private TINYINT(1) DEFAULT 0,
  email_verified TINYINT(1) DEFAULT 0,
  whatsapp_verified TINYINT(1) DEFAULT 0,
  has_blue_badge TINYINT(1) DEFAULT 0,
  referral_code VARCHAR(100) NOT NULL,
  referred_by CHAR(36),
  role ENUM('user', 'admin') DEFAULT 'user' NOT NULL,
  total_points INT DEFAULT 0 NOT NULL,
  available_points INT DEFAULT 0 NOT NULL,
  pending_points INT DEFAULT 0 NOT NULL,
  total_earned INT DEFAULT 0 NOT NULL,
  total_spent INT DEFAULT 0 NOT NULL,
  last_verification_bonus_at DATETIME,
  is_banned TINYINT(1) DEFAULT 0,
  is_flagged TINYINT(1) DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY idx_username (username),
  UNIQUE KEY idx_referral_code (referral_code),
  CONSTRAINT fk_user_referrer FOREIGN KEY (referred_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE posts (
  id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  image_url VARCHAR(500) NOT NULL,
  caption TEXT,
  likes_count INT DEFAULT 0 NOT NULL,
  comments_count INT DEFAULT 0 NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_post_user (user_id),
  CONSTRAINT fk_post_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE post_likes (
  id CHAR(36) NOT NULL,
  post_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY idx_post_user_like (post_id, user_id),
  CONSTRAINT fk_like_post FOREIGN KEY (post_id) REFERENCES posts (id) ON DELETE CASCADE,
  CONSTRAINT fk_like_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE post_comments (
  id CHAR(36) NOT NULL,
  post_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  comment_text TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_comment_post FOREIGN KEY (post_id) REFERENCES posts (id) ON DELETE CASCADE,
  CONSTRAINT fk_comment_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE stories (
  id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  image_url VARCHAR(500) NOT NULL,
  views_count INT DEFAULT 0 NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_story_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE story_views (
  id CHAR(36) NOT NULL,
  story_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  viewed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY idx_story_user_view (story_id, user_id),
  CONSTRAINT fk_view_story FOREIGN KEY (story_id) REFERENCES stories (id) ON DELETE CASCADE,
  CONSTRAINT fk_view_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE follows (
  id CHAR(36) NOT NULL,
  follower_id CHAR(36) NOT NULL,
  following_id CHAR(36) NOT NULL,
  is_pending TINYINT(1) DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY idx_follower_following (follower_id, following_id),
  CONSTRAINT fk_follow_follower FOREIGN KEY (follower_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_follow_following FOREIGN KEY (following_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE messages (
  id CHAR(36) NOT NULL,
  sender_id CHAR(36) NOT NULL,
  receiver_id CHAR(36) NOT NULL,
  message_text TEXT NOT NULL,
  is_read TINYINT(1) DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_msg_sender FOREIGN KEY (sender_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_msg_receiver FOREIGN KEY (receiver_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tasks (
  id CHAR(36) NOT NULL,
  creator_id CHAR(36) NOT NULL,
  task_type ENUM('engagement', 'cpa', 'sponsored') NOT NULL,
  platform ENUM('youtube', 'tiktok', 'instagram'),
  engagement_type ENUM('view', 'like', 'follow', 'subscribe'),
  url VARCHAR(500),
  external_url VARCHAR(500),
  title VARCHAR(255),
  description TEXT,
  reward_points INT NOT NULL,
  estimated_revenue DECIMAL(10, 2),
  target_count INT,
  current_count INT DEFAULT 0,
  timer_duration INT DEFAULT 30,
  is_active TINYINT(1) DEFAULT 1,
  expires_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_task_creator FOREIGN KEY (creator_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE task_submissions (
  id CHAR(36) NOT NULL,
  task_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  submission_data JSON,
  ip_address VARCHAR(45),
  device_fingerprint VARCHAR(255),
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME,
  is_verified TINYINT(1) DEFAULT 0,
  points_earned INT DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY idx_task_user_submission (task_id, user_id),
  CONSTRAINT fk_sub_task FOREIGN KEY (task_id) REFERENCES tasks (id) ON DELETE CASCADE,
  CONSTRAINT fk_sub_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE wallet_transactions (
  id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  transaction_type ENUM('task_earning', 'cpa_earning', 'referral_bonus', 'verification_bonus', 'daily_bonus', 'points_spent') NOT NULL,
  amount INT NOT NULL,
  description TEXT,
  task_id CHAR(36),
  referral_id CHAR(36),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_wallet_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE referrals (
  id CHAR(36) NOT NULL,
  referrer_id CHAR(36) NOT NULL,
  referred_id CHAR(36) NOT NULL,
  referral_level INT NOT NULL,
  total_earned INT DEFAULT 0 NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY idx_referrer_referred (referrer_id, referred_id),
  CONSTRAINT fk_referral_referrer FOREIGN KEY (referrer_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_referral_referred FOREIGN KEY (referred_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE verifications (
  id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  verification_type ENUM('email', 'whatsapp') NOT NULL,
  verification_value VARCHAR(255) NOT NULL,
  is_approved TINYINT(1) DEFAULT 0,
  approved_by CHAR(36),
  approved_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_verification_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE notifications (
  id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  notification_type ENUM('like', 'comment', 'follow', 'follow_request', 'task_complete', 'points_earned', 'referral_signup', 'verification_approved', 'daily_bonus', 'message') NOT NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  related_user_id CHAR(36),
  related_post_id CHAR(36),
  related_task_id CHAR(36),
  is_read TINYINT(1) DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE daily_task_progress (
  id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  date DATE NOT NULL,
  tasks_completed INT DEFAULT 0 NOT NULL,
  bonus_claimed TINYINT(1) DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY idx_user_date (user_id, date),
  CONSTRAINT fk_progress_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. Re-enable checks
SET FOREIGN_KEY_CHECKS = 1;

-- 7. Final Indexes
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_posts_created ON posts(created_at);
CREATE INDEX idx_tasks_active ON tasks(is_active);
CREATE INDEX idx_notifications_unread ON notifications(user_id, is_read);
