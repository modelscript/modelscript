-- ModelScript Co-Simulation Historian Schema
-- Runs automatically on first TimescaleDB container startup.

-- Raw variable telemetry (hypertable)
CREATE TABLE IF NOT EXISTS telemetry (
  time           TIMESTAMPTZ      NOT NULL,
  session_id     TEXT             NOT NULL,
  participant_id TEXT             NOT NULL,
  variable_name  TEXT             NOT NULL,
  value          DOUBLE PRECISION NOT NULL
);

-- Convert to hypertable (idempotent with if_not_exists)
SELECT create_hypertable('telemetry', 'time', if_not_exists => TRUE);

-- Index for participant+variable queries
CREATE INDEX IF NOT EXISTS idx_telemetry_participant_var
  ON telemetry (participant_id, variable_name, time DESC);

-- High-performance composite indexes for session and time-range filtering
CREATE INDEX IF NOT EXISTS idx_telemetry_session_time
  ON telemetry (session_id, time DESC);

CREATE INDEX IF NOT EXISTS idx_telemetry_session_part_var_time
  ON telemetry (session_id, participant_id, variable_name, time DESC);

-- Session metadata
CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  site_id     TEXT NOT NULL DEFAULT 'default',
  area_id     TEXT NOT NULL DEFAULT 'default',
  start_time  TIMESTAMPTZ,
  stop_time   TIMESTAMPTZ,
  step_size   DOUBLE PRECISION,
  state       TEXT NOT NULL DEFAULT 'created',
  metadata    JSONB
);

-- Fast session lookups by hardware instance serial number, start time, and metadata GIN index
CREATE INDEX IF NOT EXISTS idx_sessions_metadata_serial
  ON sessions ((metadata->>'serialNumber'));

CREATE INDEX IF NOT EXISTS idx_sessions_metadata_gin
  ON sessions USING gin (metadata);

CREATE INDEX IF NOT EXISTS idx_sessions_start_time
  ON sessions (start_time DESC);

-- Participant registry (persists beyond MQTT connection)
CREATE TABLE IF NOT EXISTS participants (
  id              TEXT PRIMARY KEY,
  session_id      TEXT REFERENCES sessions(id) ON DELETE CASCADE,
  model_name      TEXT NOT NULL,
  participant_type TEXT NOT NULL,
  class_kind      TEXT,
  description     TEXT,
  variables       JSONB NOT NULL DEFAULT '[]',
  icon_svg        TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  last_seen       TIMESTAMPTZ DEFAULT NOW()
);

-- FMU metadata (uploaded archives)
CREATE TABLE IF NOT EXISTS fmu_metadata (
  id              TEXT PRIMARY KEY,
  filename        TEXT NOT NULL,
  model_name      TEXT NOT NULL,
  guid            TEXT,
  fmi_version     TEXT DEFAULT '2.0',
  supports_cosim  BOOLEAN DEFAULT FALSE,
  variable_count  INTEGER DEFAULT 0,
  size_bytes      BIGINT DEFAULT 0,
  uploaded_at     TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-drop raw telemetry older than 30 days
-- (only if retention policy doesn't already exist)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
    IF NOT EXISTS (
      SELECT 1 FROM timescaledb_information.jobs
      WHERE proc_name = 'policy_retention' AND hypertable_name = 'telemetry'
    ) THEN
      PERFORM add_retention_policy('telemetry', INTERVAL '30 days');
    END IF;
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- Columnar chunk compression policy for TimescaleDB (if extension is loaded)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
    BEGIN
      ALTER TABLE telemetry SET (
        timescaledb.compress,
        timescaledb.compress_segmentby = 'session_id, participant_id',
        timescaledb.compress_orderby = 'time DESC'
      );
      PERFORM add_compression_policy('telemetry', INTERVAL '1 day', if_not_exists => TRUE);
    EXCEPTION WHEN OTHERS THEN
      -- In case compression is already enabled or policy already exists
      NULL;
    END;
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;
