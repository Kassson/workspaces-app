CREATE EXTENSION IF NOT EXISTS «uuid-ossp»;

-- 1. Глобальные настройки системы (Root Teacher)
CREATE TABLE system_settings (
    Id INT PRIMARY KEY DEFAULT 1,
    Remote_mode BOOLEAN DEFAULT FALSE,         -- Тумблер «Удаленка» (фото ДЗ)
    Maintenance_mode BOOLEAN DEFAULT FALSE,    -- Тумблер «Технические работы»
    Exams_mode BOOLEAN DEFAULT FALSE,          -- Тумблер «Экзамены» (блокировка чата)
    Private_chat_mode BOOLEAN DEFAULT TRUE,    -- Тумблер «Закрытый чат» (скрывает чат от учителей)
    Global_announcement TEXT DEFAULT '',       -- Объявление колледжа
    CONSTRAINT single_row CHECK (id = 1)
);

INSERT INTO system_settings (id, remote_mode, maintenance_mode, exams_mode, private_chat_mode) 
VALUES (1, FALSE, FALSE, FALSE, TRUE) 
ON CONFLICT (id) DO NOTHING;

-- 2. Пользователи
CREATE TABLE users (
    Id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    Username VARCHAR(50) UNIQUE NOT NULL,
    Full_name VARCHAR(150) NOT NULL,
    Email VARCHAR(100) UNIQUE NOT NULL,
    Password_hash VARCHAR(255) NOT NULL,
    Avatar_url TEXT DEFAULT 'default_avatar.png',
    
    -- Учительский профиль
    Is_teacher BOOLEAN DEFAULT FALSE,
    Is_teacher_verified BOOLEAN DEFAULT FALSE,
    Verification_code VARCHAR(10) UNIQUE,
    Verified_by UUID REFERENCES users(id),
    
    Created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Группы (Пространства)
CREATE TABLE spaces (
    Id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    Name VARCHAR(100) NOT NULL,
    Invite_code VARCHAR(10) UNIQUE NOT NULL,
    Created_by UUID REFERENCES users(id) ON DELETE CASCADE,
    Created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. Участники пространств
CREATE TABLE space_members (
    Id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    Space_id UUID REFERENCES spaces(id) ON DELETE CASCADE,
    User_id UUID REFERENCES users(id) ON DELETE CASCADE,
    Role VARCHAR(20) DEFAULT 'member',
    Muted_until TIMESTAMP WITH TIME ZONE NULL,
    Joined_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(space_id, user_id)
);

-- 5. Еженедельное расписание
CREATE TABLE schedules (
    Id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    Space_id UUID REFERENCES spaces(id) ON DELETE CASCADE,
    Day_of_week INT NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
    Subject_name VARCHAR(100) NOT NULL,
    Classroom VARCHAR(50),
    Teacher_name VARCHAR(100),
    Start_time TIME NOT NULL,
    End_time TIME NOT NULL
);

-- 6. Замены (Красная карточка) и Отмены (Черная карточка)
CREATE TABLE schedule_overrides (
    Id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    Space_id UUID REFERENCES spaces(id) ON DELETE CASCADE,
    Schedule_id UUID REFERENCES schedules(id) ON DELETE CASCADE,
    Override_date DATE NOT NULL,
    Is_canceled BOOLEAN DEFAULT FALSE,
    Replacement_subject VARCHAR(100),
    Replacement_classroom VARCHAR(50),
    Replacement_teacher VARCHAR(100),
    Created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(schedule_id, override_date)
);

-- 7. Домашние задания
CREATE TABLE homeworks (
    Id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    Space_id UUID REFERENCES spaces(id) ON DELETE CASCADE,
    Subject_name VARCHAR(100) NOT NULL,
    Title TEXT NOT NULL,
    Due_date DATE NOT NULL,
    Created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 8. Отметки сдачи ДЗ + Фото решения
CREATE TABLE homework_completions (
    Id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    Homework_id UUID REFERENCES homeworks(id) ON DELETE CASCADE,
    User_id UUID REFERENCES users(id) ON DELETE CASCADE,
    Attachment_url TEXT NULL,
    Completed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(homework_id, user_id)
);

-- 9. Сообщения чата
CREATE TABLE chat_messages (
    Id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    Space_id UUID REFERENCES spaces(id) ON DELETE CASCADE,
    User_id UUID REFERENCES users(id) ON DELETE CASCADE,
    Message TEXT NOT NULL,
    Created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_chat_created_at ON chat_messages(created_at);

-- 10. Рекорды Игр
CREATE TABLE game_scores (
    Id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    Space_id UUID REFERENCES spaces(id) ON DELETE CASCADE,
    User_id UUID REFERENCES users(id) ON DELETE CASCADE,
    Game_id VARCHAR(50) NOT NULL,
    Score INT NOT NULL DEFAULT 0,
    Updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(space_id, user_id, game_id)
);

-- СОЗДАНИЕ ROOT TEACHER (Пароль: RootTeacher2026!)
INSERT INTO users (username, full_name, email, password_hash, is_teacher, is_teacher_verified, verification_code)
VALUES (
    'root_teacher',
    'Главный Администратор Колледжа',
    'root@college.edu',
    '$2a$10$wB9L1yF/J5rG6E0I9G8kNuY/3mKqC5D4sE1aF2bC3dE4f5g6h7i8j',
    TRUE,
    TRUE,
    'ROOT-001'
) ON CONFLICT (username) DO NOTHING;
