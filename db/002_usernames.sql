ALTER TABLE users ADD COLUMN username text;
UPDATE users SET username = 'user' || id;
ALTER TABLE users ALTER COLUMN username SET NOT NULL;
ALTER TABLE users ADD CONSTRAINT users_username_unique UNIQUE (username);
ALTER TABLE users ADD CONSTRAINT users_username_format CHECK (username ~ '^[a-z0-9_]{3,32}$');
