CREATE TABLE users (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email text NOT NULL UNIQUE CHECK (email = lower(trim(email))),
  password_hash text NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  is_admin boolean NOT NULL DEFAULT false
);
CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TABLE password_resets (
  token_hash text PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE INDEX password_resets_user ON password_resets(user_id);
CREATE TABLE rate_limits (
  key text PRIMARY KEY,
  attempts integer NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE TABLE movies (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tmdb_id integer UNIQUE CHECK (tmdb_id > 0),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
  release_year integer CHECK (release_year BETWEEN 1870 AND 2200),
  overview text NOT NULL DEFAULT '',
  poster_path text CHECK (poster_path IS NULL OR poster_path ~ '^/[A-Za-z0-9._-]+$'),
  approval_status text NOT NULL DEFAULT 'pending' CHECK (approval_status IN ('pending','approved','rejected')),
  submitted_by integer REFERENCES users(id),
  eligible boolean NOT NULL DEFAULT true,
  eligibility_changed_by integer REFERENCES users(id),
  eligibility_changed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE rounds (
  week_start date PRIMARY KEY CHECK (extract(isodow FROM week_start) = 1),
  winner_id integer REFERENCES movies(id),
  drawn_by integer REFERENCES users(id),
  drawn_at timestamptz,
  CHECK ((winner_id IS NULL AND drawn_by IS NULL AND drawn_at IS NULL)
    OR (winner_id IS NOT NULL AND drawn_by IS NOT NULL AND drawn_at IS NOT NULL))
);
CREATE TABLE round_responses (
  week_start date NOT NULL REFERENCES rounds(week_start),
  user_id integer NOT NULL REFERENCES users(id),
  movie_id integer REFERENCES movies(id),
  PRIMARY KEY (week_start, user_id)
);
CREATE TABLE user_watched_movies (
  user_id integer NOT NULL REFERENCES users(id),
  movie_id integer NOT NULL REFERENCES movies(id),
  watched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id,movie_id)
);
CREATE TABLE reviews (
  user_id integer NOT NULL,
  movie_id integer NOT NULL,
  rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  text text NOT NULL DEFAULT '' CHECK (length(text) <= 10000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id,movie_id),
  FOREIGN KEY (user_id,movie_id) REFERENCES user_watched_movies(user_id,movie_id)
);
