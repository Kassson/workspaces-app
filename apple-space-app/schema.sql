CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- 1. Глобальные настройки
-- ============================================================================
CREATE TABLE IF NOT EXISTS system_settings (
    id INT PRIMARY KEY DEFAULT 1,
    remote_mode BOOLEAN DEFAULT FALSE,
    maintenance_mode BOOLEAN DEFAULT FALSE,
    exams_mode BOOLEAN DEFAULT FALSE,
    private_chat_mode BOOLEAN DEFAULT TRUE,
    global_announcement TEXT DEFAULT '',
    CONSTRAINT single_row CHECK (id = 1)
);

INSERT INTO system_settings (id, remote_mode, maintenance_mode, exams_mode, private_chat_mode)
VALUES (1, FALSE, FALSE, FALSE, TRUE)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 2. Пользователи
-- ============================================================================
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(50) UNIQUE NOT NULL,
    full_name VARCHAR(150) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    avatar_url TEXT DEFAULT NULL,
    avatar_emoji VARCHAR(10) DEFAULT '👤',

    is_teacher BOOLEAN DEFAULT FALSE,
    is_teacher_verified BOOLEAN DEFAULT FALSE,
    verification_code VARCHAR(10) UNIQUE,
    verified_by UUID REFERENCES users(id),

    email_verified BOOLEAN DEFAULT TRUE,
    email_verification_token VARCHAR(100),
    password_reset_token VARCHAR(100),
    password_reset_expires TIMESTAMP WITH TIME ZONE,

    failed_login_attempts INT DEFAULT 0,
    locked_until TIMESTAMP WITH TIME ZONE,

    theme VARCHAR(20) DEFAULT 'auto',

    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- 3. Пространства
-- ============================================================================
CREATE TABLE IF NOT EXISTS spaces (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    invite_code VARCHAR(10) UNIQUE NOT NULL,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- 4. Участники
-- ============================================================================
CREATE TABLE IF NOT EXISTS space_members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    space_id UUID REFERENCES spaces(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(20) DEFAULT 'member',
    muted_until TIMESTAMP WITH TIME ZONE NULL,
    custom_status VARCHAR(50) DEFAULT NULL,
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(space_id, user_id)
);

CREATE TABLE IF NOT EXISTS space_blocked (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    space_id UUID REFERENCES spaces(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    blocked_by UUID REFERENCES users(id) ON DELETE SET NULL,
    reason TEXT,
    blocked_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(space_id, user_id)
);

-- ============================================================================
-- 5. Расписание
-- ============================================================================
CREATE TABLE IF NOT EXISTS schedules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    space_id UUID REFERENCES spaces(id) ON DELETE CASCADE,
    day_of_week INT NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
    subject_name VARCHAR(100) NOT NULL,
    classroom VARCHAR(50),
    teacher_name VARCHAR(100),
    start_time TIME NOT NULL,
    end_time TIME NOT NULL
);

CREATE TABLE IF NOT EXISTS schedule_overrides (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    space_id UUID REFERENCES spaces(id) ON DELETE CASCADE,
    schedule_id UUID REFERENCES schedules(id) ON DELETE CASCADE,
    override_date DATE NOT NULL,
    is_canceled BOOLEAN DEFAULT FALSE,
    replacement_subject VARCHAR(100),
    replacement_classroom VARCHAR(50),
    replacement_teacher VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(schedule_id, override_date)
);

-- ============================================================================
-- 6. Домашние задания
-- ============================================================================
CREATE TABLE IF NOT EXISTS homeworks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    space_id UUID REFERENCES spaces(id) ON DELETE CASCADE,
    subject_name VARCHAR(100) NOT NULL,
    title TEXT NOT NULL,
    due_date DATE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS homework_completions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    homework_id UUID REFERENCES homeworks(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    attachment_url TEXT NULL,
    completed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(homework_id, user_id)
);

-- ============================================================================
-- 7. Чат
-- ============================================================================
CREATE TABLE IF NOT EXISTS chat_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    space_id UUID REFERENCES spaces(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    message TEXT NOT NULL,
    reply_to_id UUID REFERENCES chat_messages(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- 8. Рекорды игр
-- ============================================================================
CREATE TABLE IF NOT EXISTS game_scores (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    space_id UUID REFERENCES spaces(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    game_id VARCHAR(50) NOT NULL,
    score INT NOT NULL DEFAULT 0,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(space_id, user_id, game_id)
);

-- ============================================================================
-- 9. Push
-- ============================================================================
CREATE TABLE IF NOT EXISTS push_subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS chat_mutes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    space_id UUID REFERENCES spaces(id) ON DELETE CASCADE,
    muted_until TIMESTAMP WITH TIME ZONE,
    muted_forever BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, space_id)
);

CREATE TABLE IF NOT EXISTS push_mutes (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    muted_until TIMESTAMP WITH TIME ZONE,
    muted_forever BOOLEAN DEFAULT FALSE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- 10. Файлы
-- ============================================================================
CREATE TABLE IF NOT EXISTS files (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    space_id UUID REFERENCES spaces(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    message_id UUID REFERENCES chat_messages(id) ON DELETE SET NULL,
    key TEXT NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    mime VARCHAR(100) NOT NULL,
    size BIGINT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- 11. Реакции и упоминания
-- ============================================================================
CREATE TABLE IF NOT EXISTS message_reactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    message_id UUID REFERENCES chat_messages(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    emoji VARCHAR(10) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(message_id, user_id)
);

CREATE TABLE IF NOT EXISTS message_mentions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    message_id UUID REFERENCES chat_messages(id) ON DELETE CASCADE,
    mentioned_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(message_id, mentioned_user_id)
);

-- ============================================================================
-- 12. Чтение и присутствие
-- ============================================================================
CREATE TABLE IF NOT EXISTS chat_read_state (
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    space_id UUID REFERENCES spaces(id) ON DELETE CASCADE,
    last_read_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, space_id)
);

CREATE TABLE IF NOT EXISTS user_presence (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT FALSE
);

-- ============================================================================
-- 13. Уведомления
-- ============================================================================
CREATE TABLE IF NOT EXISTS user_notification_prefs (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    all_enabled BOOLEAN DEFAULT TRUE,
    chat_enabled BOOLEAN DEFAULT TRUE,
    schedule_enabled BOOLEAN DEFAULT TRUE,
    lesson_reminder_enabled BOOLEAN DEFAULT TRUE,
    new_homework_enabled BOOLEAN DEFAULT TRUE,
    homework_deadline_enabled BOOLEAN DEFAULT TRUE,
    grades_enabled BOOLEAN DEFAULT TRUE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- 14. Предметы учителя
-- ============================================================================
CREATE TABLE IF NOT EXISTS teacher_subjects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    space_id UUID REFERENCES spaces(id) ON DELETE CASCADE,
    teacher_id UUID REFERENCES users(id) ON DELETE CASCADE,
    subject_name VARCHAR(100) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(space_id, teacher_id, subject_name)
);

-- ============================================================================
-- 15. Журнал оценок
-- ============================================================================
CREATE TABLE IF NOT EXISTS grades (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    space_id UUID REFERENCES spaces(id) ON DELETE CASCADE,
    student_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    student_name VARCHAR(150) NOT NULL,
    subject_name VARCHAR(100) NOT NULL,
    teacher_id UUID REFERENCES users(id) ON DELETE SET NULL,
    grade_value INT CHECK (grade_value BETWEEN 2 AND 5),
    attendance VARCHAR(20) DEFAULT 'present',
    lesson_date DATE NOT NULL,
    homework_id UUID REFERENCES homeworks(id) ON DELETE SET NULL,
    comment TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- 16. Объявления и отложенные уведомления
-- ============================================================================
CREATE TABLE IF NOT EXISTS space_announcements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    space_id UUID REFERENCES spaces(id) ON DELETE CASCADE,
    author_id UUID REFERENCES users(id) ON DELETE SET NULL,
    title VARCHAR(200),
    text TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pending_notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    payload JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    sent_at TIMESTAMP WITH TIME ZONE
);

-- ============================================================================
-- 17. Запросы на восстановление пароля
-- ============================================================================
CREATE TABLE IF NOT EXISTS password_reset_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_type VARCHAR(20) NOT NULL,
    display_name VARCHAR(200) NOT NULL,
    username VARCHAR(100),
    code VARCHAR(10),
    token VARCHAR(100),
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    approved_at TIMESTAMP WITH TIME ZONE,
    resolved_at TIMESTAMP WITH TIME ZONE
);

-- ============================================================================
-- 18. ИНДЕКСЫ (в самом конце, чтобы не ломать создание таблиц)
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_chat_created_at ON chat_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_chat_space ON chat_messages(space_id);
CREATE INDEX IF NOT EXISTS idx_chat_space_created ON chat_messages(space_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_reply ON chat_messages(reply_to_id);
CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_mutes_user_space ON chat_mutes(user_id, space_id);
CREATE INDEX IF NOT EXISTS idx_files_space ON files(space_id);
CREATE INDEX IF NOT EXISTS idx_files_message ON files(message_id);
CREATE INDEX IF NOT EXISTS idx_files_user ON files(user_id);
CREATE INDEX IF NOT EXISTS idx_reactions_message ON message_reactions(message_id);
CREATE INDEX IF NOT EXISTS idx_mentions_user ON message_mentions(mentioned_user_id);
CREATE INDEX IF NOT EXISTS idx_grades_space ON grades(space_id);
CREATE INDEX IF NOT EXISTS idx_grades_student ON grades(space_id, student_user_id);
CREATE INDEX IF NOT EXISTS idx_grades_student_name ON grades(space_id, student_name);
CREATE INDEX IF NOT EXISTS idx_grades_subject ON grades(space_id, subject_name);
CREATE INDEX IF NOT EXISTS idx_grades_date ON grades(lesson_date DESC);
CREATE INDEX IF NOT EXISTS idx_grades_teacher ON grades(teacher_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_grades_unique ON grades(space_id, student_name, subject_name, lesson_date, teacher_id);
CREATE INDEX IF NOT EXISTS idx_teacher_subjects ON teacher_subjects(space_id, teacher_id);
CREATE INDEX IF NOT EXISTS idx_space_announcements ON space_announcements(space_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prr_status ON password_reset_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prr_code ON password_reset_requests(code) WHERE code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_prr_token ON password_reset_requests(token) WHERE token IS NOT NULL;

-- ============================================================================
-- 19. Виртуальные ученики журнала (для тех, кого нет в пространстве)
-- ============================================================================
CREATE TABLE IF NOT EXISTS journal_students (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    space_id UUID REFERENCES spaces(id) ON DELETE CASCADE,
    subject_name VARCHAR(100) NOT NULL,
    student_name VARCHAR(150) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(space_id, subject_name, student_name)
);
CREATE INDEX IF NOT EXISTS idx_journal_students ON journal_students(space_id, subject_name);

ALTER TABLE space_members ADD COLUMN IF NOT EXISTS hidden_from_journal BOOLEAN DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS grade_shares (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    space_id UUID REFERENCES spaces(id) ON DELETE CASCADE,
    owner_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    shared_with_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(space_id, owner_user_id, shared_with_user_id)
);
CREATE INDEX IF NOT EXISTS idx_grade_shares_recipient ON grade_shares(space_id, shared_with_user_id);
CREATE INDEX IF NOT EXISTS idx_grade_shares_owner ON grade_shares(space_id, owner_user_id);
