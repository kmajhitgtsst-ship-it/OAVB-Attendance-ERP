CREATE TABLE roles (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE users (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  role_id INTEGER REFERENCES roles(id),
  password_hash TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE students (
  id UUID PRIMARY KEY,
  admission_no TEXT,
  roll TEXT NOT NULL,
  name TEXT NOT NULL,
  class_name TEXT NOT NULL,
  section TEXT NOT NULL,
  guardian TEXT,
  phone TEXT,
  hostel BOOLEAN NOT NULL DEFAULT false,
  category TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (class_name, section, roll)
);

CREATE TABLE teachers (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  phone TEXT,
  assigned_class TEXT,
  active BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE attendance_sessions (
  id UUID PRIMARY KEY,
  attendance_date DATE NOT NULL,
  class_name TEXT NOT NULL,
  section TEXT NOT NULL,
  submitted_by UUID REFERENCES users(id),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (attendance_date, class_name, section)
);

CREATE TABLE student_attendance (
  id UUID PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('Present', 'Absent', 'Leave', 'Holiday', 'Late')),
  time_in TIME,
  remarks TEXT,
  UNIQUE (session_id, student_id)
);

CREATE TABLE staff_attendance (
  id UUID PRIMARY KEY,
  teacher_id UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  attendance_date DATE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Present', 'Absent', 'Leave', 'Duty')),
  remarks TEXT,
  UNIQUE (teacher_id, attendance_date)
);

CREATE TABLE message_logs (
  id UUID PRIMARY KEY,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  target_type TEXT NOT NULL CHECK (target_type IN ('class_group', 'parent')),
  target TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Prepared'
);

CREATE TABLE mdm_daily_entries (
  id UUID PRIMARY KEY,
  entry_date DATE NOT NULL,
  class_name TEXT NOT NULL,
  section TEXT NOT NULL,
  menu TEXT NOT NULL,
  eligible_count INTEGER NOT NULL,
  served_count INTEGER NOT NULL,
  rice_kg NUMERIC(8,2) NOT NULL DEFAULT 0,
  dal_kg NUMERIC(8,2) NOT NULL DEFAULT 0,
  egg_fruit_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (entry_date, class_name, section)
);

CREATE TABLE settings_months (
  month_key TEXT PRIMARY KEY,
  working_days INTEGER NOT NULL CHECK (working_days BETWEEN 1 AND 31),
  holidays JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE audit_logs (
  id UUID PRIMARY KEY,
  actor_id UUID REFERENCES users(id),
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
