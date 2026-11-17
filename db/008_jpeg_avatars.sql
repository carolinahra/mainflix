ALTER TABLE users DROP CONSTRAINT users_avatar_check;
ALTER TABLE users ADD CONSTRAINT users_avatar_check CHECK (
  avatar IS NULL OR (length(avatar) <= 22000 AND avatar ~ '^data:image/(webp|jpeg);base64,[A-Za-z0-9+/]+={0,2}$')
);
