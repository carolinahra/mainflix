ALTER TABLE rounds ADD COLUMN survey_enabled boolean NOT NULL DEFAULT false;
UPDATE rounds SET survey_enabled = true WHERE winner_id IS NULL;
ALTER TABLE rounds ALTER COLUMN survey_enabled SET DEFAULT true;

CREATE TABLE round_survey_responses (
  group_id integer NOT NULL,
  week_start date NOT NULL,
  user_id integer NOT NULL REFERENCES users(id),
  answers jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(answers) = 'array'),
  completed_at timestamptz,
  PRIMARY KEY (group_id,week_start,user_id),
  FOREIGN KEY (group_id,week_start) REFERENCES rounds(group_id,week_start) ON DELETE CASCADE
);
