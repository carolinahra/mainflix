ALTER TABLE users ADD COLUMN avatar text CHECK (
  avatar IS NULL OR (length(avatar) <= 22000 AND avatar ~ '^data:image/webp;base64,[A-Za-z0-9+/]+={0,2}$')
);
CREATE TABLE favorite_movies (
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  movie_id integer NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, movie_id)
);
