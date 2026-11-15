ALTER TABLE reviews
  DROP CONSTRAINT reviews_rating_check,
  ALTER COLUMN rating TYPE double precision,
  ADD CONSTRAINT reviews_rating_check CHECK (
    rating BETWEEN 0.5 AND 5 AND rating * 2 = trunc(rating * 2)
  );
